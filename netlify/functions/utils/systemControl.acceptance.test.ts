import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

// Criteri di accettazione della verifica funzionale del 25/09/2026
// (VERIFICATION-SYSTEM-CONTROL.md). Database e rete sono simulati: nessun
// servizio reale viene contattato.
const sim = vi.hoisted(() => {
  process.env.VITE_SUPABASE_URL = 'https://local-audit.invalid'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'local-audit-fake-key'
  process.env.ADMIN_API_TOKEN = 'local-audit-internal-token'
  process.env.URL = 'https://local-audit.invalid'
  return {
    tables: {} as Record<string, any[]>,
    errors: {} as Record<string, any>,
    queries: [] as any[],
    user: { id: 'audit-user', email: 'reviewer@example.invalid' } as any,
    seq: 0,
  }
})

vi.mock('@supabase/supabase-js', () => {
  function from(table: string) {
    let mode = 'select', payload: any, single = false, max = Infinity, options: any = {}, conflict = ''
    let sort: any = null
    const filters: ((r: any) => boolean)[] = []
    const q: any = {
      select: (_cols?: string, o?: any) => { options = o || options; return q },
      eq: (k: string, v: any) => { filters.push(r => r[k] === v); return q },
      neq: (k: string, v: any) => { filters.push(r => r[k] !== v); return q },
      in: (k: string, v: any[]) => { filters.push(r => v.includes(r[k])); return q },
      lt: (k: string, v: any) => { filters.push(r => r[k] != null && r[k] < v); return q },
      lte: (k: string, v: any) => { filters.push(r => r[k] != null && r[k] <= v); return q },
      gte: (k: string, v: any) => { filters.push(r => r[k] != null && r[k] >= v); return q },
      ilike: (k: string, v: string) => { filters.push(r => String(r[k]).toLowerCase() === v.toLowerCase()); return q },
      like: (k: string, v: string) => { filters.push(r => String(r[k]).startsWith(v.replace(/%$/, ''))); return q },
      order: (k: string, o?: any) => { sort = { k, asc: o?.ascending !== false }; return q },
      limit: (n: number) => { max = n; return q },
      maybeSingle: () => { single = true; return q },
      single: () => { single = true; return q },
      insert: (p: any) => { mode = 'insert'; payload = p; return q },
      upsert: (p: any, o?: any) => { mode = 'upsert'; payload = p; conflict = o?.onConflict || 'id'; return q },
      update: (p: any) => { mode = 'update'; payload = p; return q },
      delete: () => { mode = 'delete'; return q },
      then: (resolve: any, reject: any) => {
        try {
          sim.queries.push({ table, mode, payload: structuredClone(payload), options })
          const error = sim.errors[`${table}:${mode}`] || sim.errors[table]
          if (error) return Promise.resolve({ data: null, error, count: null }).then(resolve, reject)
          const all = sim.tables[table] ||= []
          let rows = all.filter(r => filters.every(f => f(r)))
          if (mode === 'insert' || mode === 'upsert') {
            rows = (Array.isArray(payload) ? payload : [payload]).map(p => {
              const old = mode === 'upsert' && all.find(r => conflict.split(',').every(k => r[k] === p[k]))
              if (old) { Object.assign(old, structuredClone(p)); return old }
              const r = {
                id: `audit-${++sim.seq}`, created_at: new Date().toISOString(),
                inviato_at: new Date().toISOString(), stato: 'in_coda', tentativi: 0,
                ...structuredClone(p),
              }
              all.push(r); return r
            })
          } else if (mode === 'update') rows.forEach(r => Object.assign(r, structuredClone(payload)))
          else if (mode === 'delete') sim.tables[table] = all.filter(r => !rows.includes(r))
          if (sort) rows.sort((a, b) => (a[sort.k] < b[sort.k] ? -1 : a[sort.k] > b[sort.k] ? 1 : 0) * (sort.asc ? 1 : -1))
          const count = rows.length
          rows = rows.slice(0, max)
          return Promise.resolve({
            data: options.head ? null : structuredClone(single ? rows[0] || null : rows), error: null, count,
          }).then(resolve, reject)
        } catch (e) { return Promise.reject(e).then(resolve, reject) }
      },
    }
    return q
  }
  const client = {
    from,
    auth: {
      getUser: async () => ({ data: { user: sim.user }, error: sim.user ? null : { message: 'Invalid token' } }),
      admin: { listUsers: async () => ({ data: { users: [] }, error: null }), updateUserById: vi.fn() },
    },
    storage: { listBuckets: async () => ({ data: [], error: null }) },
  }
  return { createClient: () => client }
})

import { createClient } from '@supabase/supabase-js'
import { handler as overview } from '../system-control-overview'
import { handler as flags } from '../system-control-flags'
import { handler as integrations } from '../system-control-integrations'
import { handler as operations } from '../system-control-operations'
import { handler as worker } from '../system-control-worker'
import { handler as metrics } from '../system-control-metrics'
import { accodaOperazione, conSystemControl, funzioneFerma, registraEvento, statoFunzione } from './systemControl'
import { eseguiRitentativo } from './systemControlRetry'
import { eseguiControlloOrario } from './systemControlControllo'
import { INTEGRAZIONI } from './systemControlCatalog'

const sb = createClient('https://local-audit.invalid', 'fake')
const request = (body?: any, authenticated = true) => ({
  httpMethod: body ? 'POST' : 'GET', headers: authenticated ? { authorization: 'Bearer local-audit-user' } : {},
  body: body ? JSON.stringify(body) : null, queryStringParameters: {},
})
async function call(handler: any, event = request()) {
  const res = await handler(event, {})
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') }
}
function operation(patch: any = {}) {
  const r = {
    id: 'op-1', tipo: 'cargos_invio', stato: 'in_coda', endpoint: 'cargos-auto-send',
    payload: { bookingId: 'booking-1' }, chiave_idempotenza: 'cargos:booking-1',
    descrizione: 'Local audit only', tentativi: 0, max_tentativi: 5,
    automatica: true, integrazione: 'cargos', business: '*',
    prossimo_tentativo_at: '2026-09-24T00:00:00Z', created_at: '2026-09-24T00:00:00Z',
    ...patch,
  }
  sim.tables.sc_operations = [r]
  return r
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-25T12:00:00Z'))
  sim.tables = { admins: [{ id: 'a1', email: 'reviewer@example.invalid', permissions: ['role:direzione'], archived_at: null }] }
  sim.errors = {}; sim.queries = []; sim.seq = 0
  sim.user = { id: 'audit-user', email: 'reviewer@example.invalid' }
  vi.stubEnv('SYSTEM_CONTROL_ALERT_PHONES', '')
  vi.stubEnv('CONTEXT', 'development')
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('NETWORK BLOCKED: no live service permitted in this suite') }))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('Access and existing protections', () => {
  it('rejects an anonymous request', async () => {
    expect((await call(overview, request(undefined, false))).status).toBe(401)
  })
  it('rejects an authenticated user without a technical role', async () => {
    sim.tables.admins[0].permissions = []
    expect((await call(flags, request({ chiave: 'auto_riparazione', attiva: false }))).status).toBe(403)
    expect(sim.tables.sc_flags).toBeUndefined()
  })
  it('allows an active direction user to view overview', async () => {
    expect((await call(overview)).status).toBe(200)
  })
  it('requires confirmation before a global critical switch', async () => {
    const res = await call(flags, request({ chiave: 'fatturazione_elettronica', attiva: false }))
    expect(res.body.richiedeConferma).toBe(true)
    expect(sim.tables.sc_flags).toBeUndefined()
  })
  it('saves a confirmed switch and gives global off precedence', async () => {
    const res = await call(flags, request({ chiave: 'fatturazione_elettronica', attiva: false, conferma: true }))
    expect(res.body.ok).toBe(true)
    sim.tables.sc_flags.push({ chiave: 'fatturazione_elettronica', business: 'terra', attiva: true })
    expect((await statoFunzione('fatturazione_elettronica', 'terra')).attiva).toBe(false)
    expect(sim.tables.sc_config_history).toHaveLength(1)
  })
  it('reports that the System Control schema is missing', async () => {
    sim.errors.sc_error_groups = { code: '42P01', message: 'relation does not exist' }
    expect((await call(overview)).body.migrazioneEseguita).toBe(false)
  })
  it('groups repeated events and masks credential fields', async () => {
    const a = await registraEvento({ messaggio: 'network error 1', contesto: { password: 'fake-local-secret' } })
    const b = await registraEvento({ messaggio: 'network error 2' })
    expect(b.gruppoId).toBe(a.gruppoId)
    expect(sim.tables.sc_error_groups).toHaveLength(1)
    expect(sim.tables.sc_error_events).toHaveLength(2)
    expect(sim.tables.sc_error_events[0].contesto.password).toBe('[nascosto]')
  })
  it('does not repeat an already completed operation', async () => {
    operation({ stato: 'riuscita' })
    expect((await eseguiRitentativo(sb, 'op-1')).saltata).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('does not call an endpoint outside the allowlist', async () => {
    operation({ endpoint: 'https://other.invalid' })
    expect((await eseguiRitentativo(sb, 'op-1')).ok).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('allows only one simultaneous claim for an operation', async () => {
    operation()
    vi.mocked(fetch).mockResolvedValue(new Response('{"success":true}', { status: 200 }))
    const results = await Promise.all([eseguiRitentativo(sb, 'op-1'), eseguiRitentativo(sb, 'op-1')])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(results.filter(r => r.saltata)).toHaveLength(1)
  })
  it.each([0, 4])('backs off or abandons after a real HTTP failure with %i prior attempts', async prior => {
    const op = operation({ tentativi: prior })
    vi.mocked(fetch).mockResolvedValue(new Response('{"error":"failure"}', { status: 500 }))
    expect((await eseguiRitentativo(sb, op.id)).ok).toBe(false)
    expect(op.stato).toBe(prior === 4 ? 'abbandonata' : 'in_coda')
    expect(op.tentativi).toBe(prior + 1)
  })
  it('honors the automatic repair off switch', async () => {
    sim.tables.sc_flags = [{ chiave: 'auto_riparazione', business: '*', attiva: false }]
    operation()
    expect((await call(worker)).body.saltato).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('Functional acceptance checks — failures identify defects', () => {
  it('rejects an archived operator even if its old role tag remains', async () => {
    sim.tables.admins[0].archived_at = '2026-09-24T00:00:00Z'
    expect((await call(overview)).status).toBe(403)
  })
  it('does not declare untested integrations operational', async () => {
    sim.tables.sc_integrations = INTEGRAZIONI.map(i => ({ ...i, abilitata: true, stato: 'non_collegato' }))
    const res = await call(overview)
    expect(res.body.servizi.find((s: any) => s.chiave === 'integrazioni').stato).not.toBe('operativo')
  })
  it('does not declare integrations operational when their database query fails', async () => {
    sim.errors.sc_integrations = { code: 'XX000', message: 'simulated database query failure' }
    const res = await call(overview)
    expect(res.body.servizi.find((s: any) => s.chiave === 'integrazioni').stato).not.toBe('operativo')
  })
  it('does not confirm a disable action when its write failed', async () => {
    sim.errors['sc_integrations:upsert'] = { code: 'XX000', message: 'simulated write failure' }
    const res = await call(integrations, request({ azione: 'disabilita_integrazione', chiave: 'cargos' }))
    expect(res.body.ok).toBe(false)
  })
  it('does not mark an HTTP 200 business failure as completed', async () => {
    operation({ endpoint: 'send-invoice-to-sdi', tipo: 'fattura_sdi' })
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ success: false, skipped: true, reason: 'test_vehicle' }), { status: 200 }))
    const result = await eseguiRitentativo(sb, 'op-1')
    expect(result.ok).toBe(false)
    expect(sim.tables.sc_operations[0].stato).not.toBe('riuscita')
  })
  it('does not reopen the lock when a running operation reports its failure', async () => {
    operation({ stato: 'in_corso' })
    await accodaOperazione({ tipo: 'cargos_invio', chiaveIdempotenza: 'cargos:booking-1', descrizione: 'Failure inside the claimed request', errore: 'HTTP 503' })
    expect(sim.tables.sc_operations[0].stato).toBe('in_corso')
  })
  it('keeps a stranded in-progress operation visible in overview', async () => {
    operation({ stato: 'in_corso', updated_at: '2026-09-24T00:00:00Z' })
    expect((await call(overview)).body.operazioni.totale).toBe(1)
  })
  it('does not silently exclude manual-only operations from Retry all', async () => {
    operation({ stato: 'abbandonata', automatica: false, endpoint: 'send-invoice-to-sdi', tipo: 'fattura_sdi' })
    const res = await call(operations, request({ azione: 'riprova_tutte' }))
    await call(worker)
    // Either perform the explicitly requested retry, or explain that manual action remains necessary.
    const honestlyReported = !res.body.ok || /manual|esclus|non.*automatic/i.test(res.body.messaggio)
    expect(vi.mocked(fetch).mock.calls.length > 0 || honestlyReported).toBe(true)
  })
  it('respects a disabled integration during a manual retry', async () => {
    operation()
    sim.tables.sc_integrations = [{ chiave: 'cargos', abilitata: false, circuito: 'chiuso' }]
    vi.mocked(fetch).mockResolvedValue(new Response('{"success":true}', { status: 200 }))
    await eseguiRitentativo(sb, 'op-1')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('keeps a problem open while its linked operation remains abandoned', async () => {
    sim.tables.sc_error_groups = [{ id: 'g1', titolo: 'Unresolved local failure', classe_risoluzione: 1, stato: 'aperto', ultima_comparsa: '2026-09-25T08:00:00Z' }]
    operation({ stato: 'abbandonata', automatica: false, gruppo_id: 'g1' })
    await call(worker)
    expect(sim.tables.sc_error_groups[0].stato).toBe('aperto')
  })
  it('counts fast successful calls in the displayed error-rate denominator', async () => {
    const good = conSystemControl('audit-api', async () => ({ statusCode: 200, body: '{}' }))
    const bad = conSystemControl('audit-api', async () => ({ statusCode: 500, body: '{"error":"local failure"}' }))
    for (let i = 0; i < 10; i++) await good()
    await bad()
    const res = await call(metrics)
    const actual = res.body.piuChiamate.find((r: any) => r.nome === 'audit-api')
    expect(actual.chiamate).toBe(11)
    expect(actual.tassoErrore).toBeCloseTo(9.1, 1)
  })
  it('checks stale in-progress operations in the hourly report', async () => {
    operation({ stato: 'in_corso', updated_at: '2026-09-24T00:00:00Z' })
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 200 }))
    const report = await eseguiControlloOrario()
    const queue = report.voci.find(v => v.area === 'operazioni')!
    expect(queue.titolo).not.toBe('Nessuna operazione in sospeso')
  })
})

describe('Correzioni del 26/09/2026', () => {
  it('refuses to switch off a switch that no code reads', async () => {
    const res = await call(flags, request({ chiave: 'pagamenti_online', attiva: false, conferma: true }))
    expect(res.body.ok).toBe(false)
    expect(res.body.messaggio).toMatch(/non e ancora collegato/)
    expect(sim.tables.sc_flags).toBeUndefined()
  })
  it('funzioneFerma stops a wired function, also through the global gestionale switch', async () => {
    expect(await funzioneFerma('cargos', 'terra')).toBeNull()
    sim.tables.sc_flags = [{ chiave: 'gestionale', business: '*', attiva: true, manutenzione: true, messaggio: 'Manutenzione in corso' }]
    expect(await funzioneFerma('cargos', 'terra')).toBe('Manutenzione in corso')
  })
  it('does not retry an operation whose switch is off', async () => {
    operation()
    sim.tables.sc_flags = [{ chiave: 'cargos', business: '*', attiva: false }]
    const r = await eseguiRitentativo(sb, 'op-1')
    expect(r.ok).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    expect(sim.tables.sc_operations[0].stato).toBe('in_coda')
  })
  it('worker turns a stranded in-progress operation into a manual one, without calling it', async () => {
    operation({ stato: 'in_corso', updated_at: '2026-09-24T00:00:00Z' })
    await call(worker)
    expect(fetch).not.toHaveBeenCalled()
    expect(sim.tables.sc_operations[0].stato).toBe('abbandonata')
    expect(sim.tables.sc_operations[0].automatica).toBe(false)
  })
  it('keeps a fresh in-progress operation alone', async () => {
    operation({ stato: 'in_corso', updated_at: '2026-09-25T11:55:00Z' })
    await call(worker)
    expect(sim.tables.sc_operations[0].stato).toBe('in_corso')
  })
  it('Retry all requeues automatic operations and reports manual ones', async () => {
    sim.tables.sc_operations = [
      { ...operation({ id: 'a', chiave_idempotenza: 'a', stato: 'abbandonata' }) },
      { ...operation({ id: 'm', chiave_idempotenza: 'm', stato: 'abbandonata', automatica: false }) },
    ]
    const res = await call(operations, request({ azione: 'riprova_tutte' }))
    expect(res.body.rimesse).toBe(1)
    expect(res.body.escluseManuali).toBe(1)
    expect(sim.tables.sc_operations.find((o: any) => o.id === 'm').stato).toBe('abbandonata')
  })
  it('does not report an operational overview when the first read fails', async () => {
    sim.errors.sc_operations = { code: 'XX000', message: 'simulated failure' }
    const res = await call(overview)
    expect(res.body.statoGenerale).not.toBe('operativo')
    expect(res.body.lettureFallite).toContain('coda operazioni')
  })
  it('the retry owner closes the operation even if the endpoint re-reported a failure meanwhile', async () => {
    operation()
    vi.mocked(fetch).mockImplementation(async () => {
      await accodaOperazione({ tipo: 'cargos_invio', chiaveIdempotenza: 'cargos:booking-1', descrizione: 'x', errore: 'HTTP 503' })
      return new Response('{"success":false,"error":"CARGOS down"}', { status: 500 })
    })
    await eseguiRitentativo(sb, 'op-1')
    expect(sim.tables.sc_operations[0].stato).toBe('in_coda')
    expect(sim.tables.sc_operations[0].tentativi).toBe(1)
  })
  it('keeps an operation queued when the endpoint answers that its switch is off', async () => {
    operation({ endpoint: 'send-invoice-to-sdi', tipo: 'fattura_sdi', tentativi: 2 })
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ success: false, skipped: true, reason: 'fatturazione_elettronica_off', message: 'Spenta' }), { status: 200 }))
    const r = await eseguiRitentativo(sb, 'op-1')
    expect(r.ok).toBe(false)
    expect(sim.tables.sc_operations[0].stato).toBe('in_coda')
    expect(sim.tables.sc_operations[0].tentativi).toBe(2)
  })
})
