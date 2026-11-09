import { describe, it, expect, vi, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { accodaGiroMessaggiSistema, inviaDestinatarioMessaggiSistema } from './codaInviiMassivi'
import { AUDIENCE_MESSAGGI_SISTEMA, riepilogoCodaMessaggio, filtriGiroMessaggiSistema } from '../../../src/utils/campagneFrequenza'

// Finto Supabase in memoria: solo i metodi usati da accodaGiroMessaggiSistema.
type Riga = Record<string, unknown>
function finto(opts: { falliscaInsertDestinatariDopo?: number } = {}) {
  const tabelle: Record<string, Riga[]> = { system_message_send_log: [], marketing_campaigns: [], marketing_campaign_recipients: [] }
  let seq = 0
  let insertDestinatari = 0
  const valore = (r: Riga, col: string) => {
    const m = col.match(/^(\w+)->>(\w+)$/)
    if (m) return (r[m[1]] as Riga | null)?.[m[2]]
    return r[col]
  }
  function builder(tab: string) {
    const filtri: Array<(r: Riga) => boolean> = []
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select'
    let payload: Riga[] = []
    let patch: Riga = {}
    let range: [number, number] | null = null
    const esegui = () => {
      const t = tabelle[tab]
      if (op === 'insert') {
        if (tab === 'marketing_campaign_recipients') {
          insertDestinatari++
          if (opts.falliscaInsertDestinatariDopo != null && insertDestinatari > opts.falliscaInsertDestinatariDopo) {
            return { data: null, error: { message: 'insert KO' } }
          }
        }
        if (tab === 'system_message_send_log') {
          for (const p of payload) {
            if (t.some(r => r.system_message_id === p.system_message_id && r.booking_id === p.booking_id)) {
              return { data: null, error: { code: '23505', message: 'duplicate key' } }
            }
          }
        }
        const nuove = payload.map(p => ({ id: `id-${++seq}`, created_at: new Date(Date.now() + seq).toISOString(), ...p }))
        t.push(...nuove)
        return { data: nuove, error: null }
      }
      let righe = t.filter(r => filtri.every(f => f(r)))
      if (op === 'update') { righe.forEach(r => Object.assign(r, patch)); return { data: righe, error: null } }
      if (op === 'delete') { tabelle[tab] = t.filter(r => !righe.includes(r)); return { data: righe, error: null } }
      if (range) righe = righe.slice(range[0], range[1] + 1)
      return { data: righe, error: null }
    }
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (rows: Riga | Riga[]) => { op = 'insert'; payload = Array.isArray(rows) ? rows : [rows]; return b },
      update: (p: Riga) => { op = 'update'; patch = p; return b },
      delete: () => { op = 'delete'; return b },
      eq: (c: string, v: unknown) => { filtri.push(r => valore(r, c) === v); return b },
      in: (c: string, vs: unknown[]) => { filtri.push(r => vs.includes(valore(r, c))); return b },
      order: () => b,
      range: (a: number, z: number) => { range = [a, z]; return b },
      maybeSingle: async () => { const r = esegui(); return { data: r.data?.[0] ?? null, error: r.error } },
      single: async () => { const r = esegui(); return { data: r.data?.[0] ?? null, error: r.error } },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(esegui()).then(ok, ko),
    }
    return b
  }
  const sb = { from: (t: string) => builder(t) } as unknown as SupabaseClient
  return { sb, tabelle }
}

const tpl = { id: 'tpl-1', message_key: 'pro_custom_promo', label: 'Promo sabato' }
const clienti = (n: number, da = 0) => Array.from({ length: n }, (_, i) => ({ nome: `Cliente ${da + i}`, phone: `39333${String(da + i).padStart(7, '0')}` }))

describe('accodaGiroMessaggiSistema', () => {
  it('accoda tutti i destinatari in un giro della coda condivisa', async () => {
    const { sb, tabelle } = finto()
    const r = await accodaGiroMessaggiSistema(sb, { tpl, chiaveGiro: 'g1', logKey: 'k1', destinatari: clienti(1200), modo: 'template' })
    expect(r).toMatchObject({ esito: 'accodato', accodati: 1200, giaInCoda: 0 })
    expect(tabelle.marketing_campaigns).toHaveLength(1)
    const giro = tabelle.marketing_campaigns[0]
    expect(giro.audience).toBe(AUDIENCE_MESSAGGI_SISTEMA)
    expect(giro.status).toBe('pending')
    expect(filtriGiroMessaggiSistema(giro as never)?.system_message_id).toBe('tpl-1')
    expect(tabelle.marketing_campaign_recipients).toHaveLength(1200)
    expect(tabelle.system_message_send_log[0].status).toBe('sent')
  })

  it('stesso giro due volte (due giri del cron): accodato una volta sola', async () => {
    const { sb, tabelle } = finto()
    await accodaGiroMessaggiSistema(sb, { tpl, chiaveGiro: 'g1', logKey: 'k1', destinatari: clienti(10), modo: 'template' })
    const r2 = await accodaGiroMessaggiSistema(sb, { tpl, chiaveGiro: 'g1', logKey: 'k1', destinatari: clienti(10), modo: 'template' })
    expect(r2.esito).toBe('gia_accodato')
    expect(tabelle.marketing_campaign_recipients).toHaveLength(10)
  })

  it('il giorno dopo: chi e\' ancora in coda da ieri non viene accodato di nuovo', async () => {
    const { sb, tabelle } = finto()
    await accodaGiroMessaggiSistema(sb, { tpl, chiaveGiro: 'ieri', logKey: 'k-ieri', destinatari: clienti(10), modo: 'template' })
    // 4 di ieri sono partiti, 6 ancora in coda.
    tabelle.marketing_campaign_recipients.slice(0, 4).forEach(r => { r.status = 'sent' })
    const r = await accodaGiroMessaggiSistema(sb, { tpl, chiaveGiro: 'oggi', logKey: 'k-oggi', destinatari: clienti(12), modo: 'template' })
    expect(r).toMatchObject({ esito: 'accodato', accodati: 6, giaInCoda: 6 })
    const pendenti = tabelle.marketing_campaign_recipients.filter(x => x.status === 'pending').map(x => x.phone)
    expect(new Set(pendenti).size).toBe(pendenti.length)
    expect(pendenti).toHaveLength(12)
  })

  it('un altro messaggio con gli stessi clienti NON viene saltato', async () => {
    const { sb, tabelle } = finto()
    await accodaGiroMessaggiSistema(sb, { tpl, chiaveGiro: 'g', logKey: 'k', destinatari: clienti(5), modo: 'template' })
    const r = await accodaGiroMessaggiSistema(sb, { tpl: { ...tpl, id: 'tpl-2' }, chiaveGiro: 'g', logKey: 'k', destinatari: clienti(5), modo: 'template' })
    expect(r.accodati).toBe(5)
    expect(tabelle.marketing_campaign_recipients).toHaveLength(10)
  })

  it('numeri doppi o non validi: uno per numero, i non validi fuori', async () => {
    const { sb, tabelle } = finto()
    const r = await accodaGiroMessaggiSistema(sb, {
      tpl, chiaveGiro: 'g', logKey: 'k', modo: 'template',
      destinatari: [{ nome: 'A', phone: '+39 333 0000001' }, { nome: 'A bis', phone: '0039 3330000001' }, { nome: 'B', phone: '12' }],
    })
    expect(r.accodati).toBe(1)
    expect(tabelle.marketing_campaign_recipients[0].phone).toBe('393330000001')
  })

  it('insert a meta\' fallito: il posto si libera e il giro dopo completa senza doppioni', async () => {
    const f = finto({ falliscaInsertDestinatariDopo: 1 })
    const r1 = await accodaGiroMessaggiSistema(f.sb, { tpl, chiaveGiro: 'g', logKey: 'k', destinatari: clienti(1200), modo: 'template' })
    expect(r1).toMatchObject({ esito: 'errore', accodati: 500 })
    expect(f.tabelle.system_message_send_log).toHaveLength(0)
    expect(f.tabelle.marketing_campaigns[0].total_recipients).toBe(500)
    // Ritenta con un database sano (stesse tabelle).
    const sano = finto()
    sano.tabelle.marketing_campaigns.push(...f.tabelle.marketing_campaigns)
    sano.tabelle.marketing_campaign_recipients.push(...f.tabelle.marketing_campaign_recipients)
    const r2 = await accodaGiroMessaggiSistema(sano.sb, { tpl, chiaveGiro: 'g', logKey: 'k', destinatari: clienti(1200), modo: 'template' })
    expect(r2).toMatchObject({ esito: 'accodato', accodati: 700, giaInCoda: 500 })
    const numeri = sano.tabelle.marketing_campaign_recipients.map(x => x.phone)
    expect(numeri).toHaveLength(1200)
    expect(new Set(numeri).size).toBe(1200)
  })
})

describe('inviaDestinatarioMessaggiSistema', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  const filtri = { system_message_id: 'tpl-1', message_key: 'pro_custom_promo', modo: 'template' as const, variabili: { targa: 'AB123CD' } }
  const r = { id: 'rec-1', customer_name: 'Mario Rossi', email: 'm@x.it' }
  const rispondi = (status: number, json: unknown) => vi.fn(async () => new Response(JSON.stringify(json), { status }))

  it('usa il template del messaggio, solo verso quel numero e fuori dalla ripresa del System Control', async () => {
    const f = rispondi(200, { success: true })
    vi.stubGlobal('fetch', f)
    expect(await inviaDestinatarioMessaggiSistema(filtri, '', r, '393330000001')).toEqual({ tipo: 'inviato' })
    const corpo = JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body)
    expect(corpo).toMatchObject({ messageKey: 'pro_custom_promo', customPhone: '393330000001', soloQuestoNumero: true, codaInviiMassivi: true })
    expect(corpo.booking).toMatchObject({ customer_name: 'Mario Rossi', targa: 'AB123CD' })
  })
  it('modo testo: {nome} e {cognome} per destinatario', async () => {
    const f = rispondi(200, { success: true })
    vi.stubGlobal('fetch', f)
    await inviaDestinatarioMessaggiSistema({ ...filtri, modo: 'testo' }, 'Ciao {nome} {cognome}', r, '393330000001')
    const corpo = JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body)
    expect(corpo.customMessage).toBe('Ciao Mario Rossi')
  })
  it('WhatsApp spento o bot non disponibile: torna in coda (sicuramente non partito)', async () => {
    vi.stubGlobal('fetch', rispondi(200, { skipped: true, reason: 'invio_whatsapp_off' }))
    expect((await inviaDestinatarioMessaggiSistema(filtri, '', r, '39333')).tipo).toBe('rimetti_in_coda')
    vi.stubGlobal('fetch', rispondi(500, { error: 'quota', esito: 'istanza_non_disponibile' }))
    expect((await inviaDestinatarioMessaggiSistema(filtri, '', r, '39333')).tipo).toBe('rimetti_in_coda')
  })
  it('template scartato = saltato; errore incerto = fallito (mai rimandato da solo)', async () => {
    vi.stubGlobal('fetch', rispondi(200, { skipped: true, reason: 'template_disabled' }))
    expect((await inviaDestinatarioMessaggiSistema(filtri, '', r, '39333')).tipo).toBe('saltato')
    vi.stubGlobal('fetch', rispondi(500, { error: 'timeout', esito: 'errore' }))
    expect((await inviaDestinatarioMessaggiSistema(filtri, '', r, '39333')).tipo).toBe('fallito')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rete') }))
    expect((await inviaDestinatarioMessaggiSistema(filtri, '', r, '39333')).tipo).toBe('fallito')
  })
})

describe('riepilogoCodaMessaggio (coda condivisa)', () => {
  const giro = (id: string, created_at: string, tot: number, inviati: number, sistema?: string) => ({
    id, created_at, status: 'sending', total_recipients: tot, sent_count: inviati, failed_count: 0,
    audience: sistema ? AUDIENCE_MESSAGGI_SISTEMA : 'drip',
    audience_filters: sistema ? { system_message_id: sistema, message_key: 'k' } : {},
  })
  it('conta il proprio giro e quello che c\'e\' davanti; la fine stimata include gli altri', () => {
    const adesso = new Date('2026-12-10T08:00:00Z') // 09:00 Roma
    const attive = [
      giro('c1', '2026-12-10T07:00:00Z', 100, 0),            // campagna prima
      giro('s1', '2026-12-10T07:30:00Z', 60, 10, 'tpl-1'),   // il nostro
      giro('c2', '2026-12-10T07:45:00Z', 500, 0),            // campagna dopo: non conta
    ]
    const r = riepilogoCodaMessaggio(attive, 'tpl-1', adesso)
    expect(r).toMatchObject({ inCoda: 50, inviati: 10, davanti: 100 })
    // 150 messaggi a 50/ora dalle 9: 12 ore di fascia → finisce oggi alle 11:58 Roma circa.
    expect(r.fineStimata!.getTime()).toBeLessThan(new Date('2026-12-10T11:00:00Z').getTime())
    expect(r.fineStimata!.getTime()).toBeGreaterThan(new Date('2026-12-10T10:50:00Z').getTime())
  })
  it('niente in coda per il messaggio: nessuna stima', () => {
    expect(riepilogoCodaMessaggio([giro('c1', '2026-12-10T07:00:00Z', 100, 0)], 'tpl-1').fineStimata).toBeNull()
  })
})
