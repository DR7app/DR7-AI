/**
 * Giro automatico e riconciliazione SDI con Aruba e database finti:
 * nessuna chiamata vera ad Aruba o a Supabase.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const stato = vi.hoisted(() => ({
  // Risposte del database per (tabella, filtro di stato).
  inAttesa: [] as any[],
  accettate: [] as any[],
  tutte: [] as any[],
  aggiornamenti: [] as { id: string; patch: Record<string, unknown> }[],
  storico: [] as any[],
  arubaPerFile: {} as Record<string, any>,
  listaAruba: [] as any[],
  chiamateAruba: 0,
}))

vi.mock('../aruba-utils', () => ({
  checkArubaStatus: vi.fn(async (filename: string) => {
    stato.chiamateAruba++
    const r = stato.arubaPerFile[filename]
    if (!r) throw new Error('Aruba Status Check Failed: 404')
    return r
  }),
  searchOutgoingInvoices: vi.fn(async ({ page }: { page: number }) => {
    stato.chiamateAruba++
    // Pagine da 1: page=0 ripete il primo blocco, come su Aruba.
    const p = Math.max(page, 1)
    return { content: p === 1 ? stato.listaAruba : [], totalPages: 1, last: true }
  }),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (tabella: string) => {
      const q: any = { tabella, filtri: {} as Record<string, unknown>, op: 'select' }
      const catena = new Proxy(q, {
        get(target, prop) {
          if (prop === 'then') {
            return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(risolvi(target)).then(ok, ko)
          }
          if (prop === 'update') return (patch: Record<string, unknown>) => { target.op = 'update'; target.patch = patch; return catena }
          if (prop === 'insert') return (riga: unknown) => { target.op = 'insert'; target.riga = riga; return catena }
          if (prop === 'eq') return (c: string, v: unknown) => { target.filtri[c] = v; return catena }
          if (prop === 'in') return (c: string, v: unknown) => { target.filtri[c] = v; return catena }
          return () => catena
        },
      })
      return catena
    },
  }),
}))

function risolvi(q: any) {
  if (q.tabella === 'invoice_status_logs') { stato.storico.push(q.riga); return { error: null } }
  if (q.op === 'update') { stato.aggiornamenti.push({ id: q.filtri.id, patch: q.patch }); return { error: null } }
  if (q.filtri.sdi_status === 'accepted') return { data: stato.accettate, error: null }
  if (Array.isArray(q.filtri.sdi_status)) return { data: stato.inAttesa, error: null }
  return { data: stato.tutte, error: null }
}

const scartata = { id: 'a1', filename: 'IT01879020517_aaa01.xml.p7m', invoices: [{ number: 'DR7-2026-0100', status: 'Scartata', statusDescription: '00404 Fattura duplicata' }] }
const consegnata = { id: 'a2', filename: 'IT01879020517_aaa02.xml.p7m', invoices: [{ number: 'DR7-2026-0101', status: 'Consegnata', statusDescription: '' }] }

beforeEach(() => {
  stato.inAttesa = []
  stato.accettate = []
  stato.tutte = []
  stato.aggiornamenti = []
  stato.storico = []
  stato.arubaPerFile = {}
  stato.listaAruba = []
  stato.chiamateAruba = 0
  vi.resetModules()
})

describe('giro automatico (pollAllPendingSdi)', () => {
  it('riverifica le accettate quando non ci sono fatture in attesa: Accettata -> Scartata', async () => {
    stato.accettate = [{ id: 'f1', numero_fattura: 'DR7-2026-0100', sdi_status: 'accepted', xml_filename: 'IT04104640927_100ab.xml', aruba_upload_filename: scartata.filename }]
    stato.arubaPerFile[scartata.filename] = scartata
    const { pollAllPendingSdi } = await import('../_check-sdi-statuses')
    const r = await pollAllPendingSdi()
    expect(r.updated).toBe(1)
    expect(r.transitions[0]).toMatchObject({ numero: 'DR7-2026-0100', from: 'accepted', to: 'rejected' })
    const agg = stato.aggiornamenti.find(a => a.id === 'f1')!
    expect(agg.patch.sdi_status).toBe('rejected')
    expect(agg.patch.sdi_notification_seen).toBe(false)
    expect((agg.patch.sdi_response as any).motivo_scarto).toBe('00404 Fattura duplicata')
    expect(stato.storico).toHaveLength(1)
  })

  it('accettata confermata: nessun cambio, solo ora della verifica', async () => {
    stato.accettate = [{ id: 'f2', numero_fattura: 'DR7-2026-0101', sdi_status: 'accepted', xml_filename: 'x.xml', aruba_upload_filename: consegnata.filename }]
    stato.arubaPerFile[consegnata.filename] = consegnata
    const { pollAllPendingSdi } = await import('../_check-sdi-statuses')
    const r = await pollAllPendingSdi()
    expect(r.updated).toBe(0)
    expect(r.checked).toBe(1)
    expect(stato.aggiornamenti[0].patch.sdi_status).toBeUndefined()
    expect((stato.aggiornamenti[0].patch.sdi_response as any).verificato_il).toBeTruthy()
    expect(stato.storico).toHaveLength(0)
  })
})

describe('riconciliazione in blocco (reconcile-sdi-statuses)', () => {
  it('legge la lista in `content` e lo stato in invoices[0]: Accettata -> Scartata', async () => {
    stato.tutte = [
      { id: 'f1', numero_fattura: 'DR7-2026-0100', sdi_status: 'accepted', xml_filename: 'IT04104640927_100ab.xml', aruba_upload_filename: scartata.filename },
      { id: 'f2', numero_fattura: 'DR7-2026-0101', sdi_status: 'accepted', xml_filename: 'IT04104640927_101ab.xml', aruba_upload_filename: consegnata.filename },
    ]
    stato.listaAruba = [scartata, consegnata]
    const { handler } = await import('../reconcile-sdi-statuses')
    const res: any = await handler({} as any, {} as any)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body.totalRemote).toBe(2)
    expect(body.abbinate).toBe(2)
    expect(body.updated).toBe(1)
    expect(body.transitions[0]).toMatchObject({ id: 'f1', from: 'accepted', to: 'rejected', remoteStatus: 'Scartata' })
    expect(stato.aggiornamenti.map(a => a.id)).toEqual(['f1'])
  })

  it('le bozze (riportate in bozza per il reinvio) non si toccano', async () => {
    stato.tutte = [{ id: 'f3', numero_fattura: 'DR7-2026-0200', sdi_status: 'draft', xml_filename: 'v.xml', aruba_upload_filename: scartata.filename }]
    stato.listaAruba = [scartata]
    const { handler } = await import('../reconcile-sdi-statuses')
    const res: any = await handler({} as any, {} as any)
    expect(JSON.parse(res.body).updated).toBe(0)
    expect(stato.aggiornamenti).toHaveLength(0)
  })
})
