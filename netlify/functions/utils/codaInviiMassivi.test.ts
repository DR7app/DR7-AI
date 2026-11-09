import { describe, it, expect, vi, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  accodaGiroMessaggiSistema, inviaDestinatarioMessaggiSistema,
  accodaGiroPromo, inviaDestinatarioPromo, promoInviabile, registraInvioPromo,
  filtriPromoIncassi, filtriMaxiPromoGap, PREFISSO_POSTO_PROMO,
} from './codaInviiMassivi'
import {
  AUDIENCE_MESSAGGI_SISTEMA, riepilogoCodaMessaggio, filtriGiroMessaggiSistema,
  AUDIENCE_PROMO_AUTOMATICHE, filtriGiroPromo, promoScaduta, riepilogoCodaPromo, giornoRoma,
} from '../../../src/utils/campagneFrequenza'

vi.mock('./messageTemplates', () => ({
  resolveKeyForContext: vi.fn(async (k: string) => (k === 'promo_incassi_whatsapp' ? 'pro_promo_incassi' : null)),
}))

// Finto Supabase in memoria: solo i metodi usati da accodaGiroMessaggiSistema.
type Riga = Record<string, unknown>
function finto(opts: { falliscaInsertDestinatariDopo?: number } = {}) {
  const tabelle: Record<string, Riga[]> = {
    system_message_send_log: [], marketing_campaigns: [], marketing_campaign_recipients: [],
    promo_incassi_sent_log: [], maxi_promo_sent_log: [],
  }
  // Indici unici dei registri delle promo (come nel database).
  const UNICI: Record<string, string[]> = {
    promo_incassi_sent_log: ['vehicle_id', 'year_month', 'recipient'],
    maxi_promo_sent_log: ['vehicle_id', 'gap_signature', 'recipient'],
  }
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
      const t = (tabelle[tab] ||= [])
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
        const unico = UNICI[tab]
        if (unico) {
          for (const p of payload) {
            if (t.some(r => unico.every(c => r[c] === p[c]))) {
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

// ── 09/11/2026: broadcast di Promo Incassi / Maxi Promo Gap in coda ─────────
const veicolo = { id: 'veh-1', display_name: 'Porsche Macan GTS' }
const varsIncassi = { vehicle: 'Porsche Macan GTS', coefficiente: '0.7', incasso_attuale: '1200', year_month: '2026-11' }
const filtriIncassi = () => filtriPromoIncassi(veicolo, '2026-11', 2026, 11, 0.7, varsIncassi)

describe('accodaGiroPromo', () => {
  it('accoda tutta la base clienti in un giro della coda condivisa, con testo e variabili del cron', async () => {
    const { sb, tabelle } = finto()
    const r = await accodaGiroPromo(sb, { filtri: filtriIncassi(), giorno: '2026-11-09', destinatari: clienti(1330) })
    expect(r).toMatchObject({ esito: 'accodato', accodati: 1330, giaInCoda: 0 })
    expect(tabelle.marketing_campaigns).toHaveLength(1)
    const g = tabelle.marketing_campaigns[0]
    expect(g.audience).toBe(AUDIENCE_PROMO_AUTOMATICHE)
    expect(g.status).toBe('pending')
    const f = filtriGiroPromo(g as never)!
    expect(f).toMatchObject({ promo: 'promo_incassi', template_key: 'promo_incassi_whatsapp', chiave_unita: 'veh-1|2026-11' })
    expect(f.template_vars).toEqual(varsIncassi)
    expect(tabelle.marketing_campaign_recipients).toHaveLength(1330)
    // Il registro contiene solo il posto del giro: i destinatari ci entrano quando ricevono.
    expect(tabelle.promo_incassi_sent_log).toHaveLength(1)
    expect(String(tabelle.promo_incassi_sent_log[0].recipient)).toBe(`${PREFISSO_POSTO_PROMO}2026-11-09`)
  })

  it('un solo giro al giorno per promo (cron delle 9 e delle 17, rilancio a mano)', async () => {
    const { sb, tabelle } = finto()
    await accodaGiroPromo(sb, { filtri: filtriIncassi(), giorno: '2026-11-09', destinatari: clienti(10) })
    const r2 = await accodaGiroPromo(sb, { filtri: filtriIncassi(), giorno: '2026-11-09', destinatari: clienti(12) })
    expect(r2.esito).toBe('gia_accodato')
    expect(tabelle.marketing_campaigns).toHaveLength(1)
    expect(tabelle.marketing_campaign_recipients).toHaveLength(10)
  })

  it('il giorno dopo: nessuno gia\' passato dalla coda (in coda, inviato, fallito) o gia\' nel registro viene riaccodato', async () => {
    const { sb, tabelle } = finto()
    await accodaGiroPromo(sb, { filtri: filtriIncassi(), giorno: '2026-11-09', destinatari: clienti(10) })
    const recs = tabelle.marketing_campaign_recipients
    recs[0].status = 'sent'
    recs[1].status = 'failed' // esito incerto: mai rimandato da solo
    recs[2].status = 'skipped'
    // Un cliente nuovo aveva gia' ricevuto la promo (es. invio pilota).
    tabelle.promo_incassi_sent_log.push({ vehicle_id: 'veh-1', year_month: '2026-11', recipient: clienti(1, 10)[0].phone })
    const r = await accodaGiroPromo(sb, { filtri: filtriIncassi(), giorno: '2026-11-10', destinatari: clienti(13) })
    expect(r).toMatchObject({ esito: 'accodato', accodati: 2, giaInCoda: 11 })
    const numeri = tabelle.marketing_campaign_recipients.map(x => x.phone)
    expect(new Set(numeri).size).toBe(numeri.length)
    expect(numeri).toHaveLength(12)
  })

  it('un altro veicolo (altra promo) con gli stessi clienti NON viene saltato', async () => {
    const { sb, tabelle } = finto()
    await accodaGiroPromo(sb, { filtri: filtriIncassi(), giorno: '2026-11-09', destinatari: clienti(5) })
    const altro = filtriPromoIncassi({ id: 'veh-2', display_name: 'Audi RS3' }, '2026-11', 2026, 11, 0.8, varsIncassi)
    const r = await accodaGiroPromo(sb, { filtri: altro, giorno: '2026-11-09', destinatari: clienti(5) })
    expect(r.accodati).toBe(5)
    expect(tabelle.marketing_campaign_recipients).toHaveLength(10)
  })

  it('Maxi Promo Gap: posto nel suo registro, scade a fine buco', async () => {
    const { sb, tabelle } = finto()
    const fine = new Date('2026-11-11T09:30:00Z')
    const f = filtriMaxiPromoGap(veicolo, '2026-11-11', '1762850000000|1762853400000', fine, { vehicle_specs: 'Porsche Macan GTS', gap_hours: '24' })
    const r = await accodaGiroPromo(sb, { filtri: f, giorno: '2026-11-09', destinatari: clienti(3) })
    expect(r.esito).toBe('accodato')
    expect(tabelle.maxi_promo_sent_log).toHaveLength(1)
    expect(tabelle.maxi_promo_sent_log[0]).toMatchObject({ gap_signature: f.registro.gap_signature, gap_date: '2026-11-11', template_key: 'pro_maxi_promo_gap_1gg' })
    expect(promoScaduta(f, new Date('2026-11-11T09:29:00Z'))).toBe(false)
    expect(promoScaduta(f, new Date('2026-11-11T09:30:00Z'))).toBe(true)
  })

  it('insert a meta\' fallito: il posto si libera e il giro dopo completa senza doppioni', async () => {
    const f1 = finto({ falliscaInsertDestinatariDopo: 1 })
    const r1 = await accodaGiroPromo(f1.sb, { filtri: filtriIncassi(), giorno: '2026-11-09', destinatari: clienti(1200) })
    expect(r1).toMatchObject({ esito: 'errore', accodati: 500 })
    expect(f1.tabelle.promo_incassi_sent_log).toHaveLength(0)
    const sano = finto()
    sano.tabelle.marketing_campaigns.push(...f1.tabelle.marketing_campaigns)
    sano.tabelle.marketing_campaign_recipients.push(...f1.tabelle.marketing_campaign_recipients)
    const r2 = await accodaGiroPromo(sano.sb, { filtri: filtriIncassi(), giorno: '2026-11-09', destinatari: clienti(1200) })
    expect(r2).toMatchObject({ esito: 'accodato', accodati: 700, giaInCoda: 500 })
    const numeri = sano.tabelle.marketing_campaign_recipients.map(x => x.phone)
    expect(numeri).toHaveLength(1200)
    expect(new Set(numeri).size).toBe(1200)
  })
})

describe('Promo Incassi: scadenza a fine mese (ora di Roma)', () => {
  it('scade alla mezzanotte di Roma del primo giorno del mese dopo', () => {
    const f = filtriIncassi()
    expect(f.scade_il).toBe('2026-11-30T23:00:00.000Z')
    expect(filtriPromoIncassi(veicolo, '2026-12', 2026, 12, 0.7, varsIncassi).scade_il).toBe('2026-12-31T23:00:00.000Z')
    expect(giornoRoma(new Date('2026-11-09T23:30:00Z'))).toBe('2026-11-10')
  })
})

describe('inviaDestinatarioPromo', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  const rispondi = (status: number, json: unknown) => vi.fn(async () => new Response(JSON.stringify(json), { status }))

  it('stessa chiamata del cron di prima (templateKey, booking, templateVars), solo verso quel numero, fuori dalla ripresa', async () => {
    const f = rispondi(200, { success: true })
    vi.stubGlobal('fetch', f)
    expect(await inviaDestinatarioPromo(filtriIncassi(), '393330000001')).toEqual({ tipo: 'inviato' })
    const corpo = JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body)
    expect(corpo).toEqual({
      templateKey: 'promo_incassi_whatsapp',
      booking: { service_type: 'rental' },
      templateVars: varsIncassi,
      customPhone: '393330000001',
      soloQuestoNumero: true,
      codaInviiMassivi: true,
    })
  })
  it('template spento, WhatsApp spento, bot non disponibile: torna in coda', async () => {
    for (const reason of ['template_disabled', 'pro_template_unavailable', 'invio_whatsapp_off']) {
      vi.stubGlobal('fetch', rispondi(200, { skipped: true, reason }))
      expect((await inviaDestinatarioPromo(filtriIncassi(), '39333')).tipo).toBe('rimetti_in_coda')
    }
    vi.stubGlobal('fetch', rispondi(500, { error: 'quota', esito: 'istanza_non_disponibile' }))
    expect((await inviaDestinatarioPromo(filtriIncassi(), '39333')).tipo).toBe('rimetti_in_coda')
  })
  it('esito incerto = fallito; regola del template = saltato', async () => {
    vi.stubGlobal('fetch', rispondi(500, { error: 'timeout', esito: 'errore' }))
    expect((await inviaDestinatarioPromo(filtriIncassi(), '39333')).tipo).toBe('fallito')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rete') }))
    expect((await inviaDestinatarioPromo(filtriIncassi(), '39333')).tipo).toBe('fallito')
    vi.stubGlobal('fetch', rispondi(200, { skipped: true, reason: 'service_type_mismatch' }))
    expect((await inviaDestinatarioPromo(filtriIncassi(), '39333')).tipo).toBe('saltato')
  })
})

describe('promoInviabile / registraInvioPromo', () => {
  it('solo in modo broadcast e con il template assegnato e acceso', async () => {
    const { sb, tabelle } = finto()
    tabelle.promo_incassi_settings = [{ id: 1, mode: 'pilot' }]
    expect((await promoInviabile(sb, filtriIncassi())).ok).toBe(false)
    tabelle.promo_incassi_settings[0].mode = 'broadcast'
    tabelle.system_messages = [{ message_key: 'pro_promo_incassi', is_enabled: true }]
    expect((await promoInviabile(sb, filtriIncassi())).ok).toBe(true)
    tabelle.system_messages[0].is_enabled = false
    expect((await promoInviabile(sb, filtriIncassi())).ok).toBe(false)
    // Maxi Promo Gap senza template assegnato (il resolver finto torna null).
    tabelle.maxi_promo_settings = [{ id: 1, mode: 'broadcast' }]
    const maxi = filtriMaxiPromoGap(veicolo, '2026-11-11', 'a|b', new Date('2026-11-11T09:30:00Z'), {})
    expect(await promoInviabile(sb, maxi)).toMatchObject({ ok: false, motivo: 'template della promo non assegnato' })
  })
  it('dopo l\'invio il destinatario entra nel registro della promo, una volta sola', async () => {
    const { sb, tabelle } = finto()
    await registraInvioPromo(sb, filtriIncassi(), '393330000001')
    await registraInvioPromo(sb, filtriIncassi(), '393330000001')
    expect(tabelle.promo_incassi_sent_log).toHaveLength(1)
    expect(tabelle.promo_incassi_sent_log[0]).toMatchObject({ vehicle_id: 'veh-1', year_month: '2026-11', threshold_coeff: 0.7, recipient: '393330000001', template_key: 'pro_promo_incassi' })
  })
})

describe('riepilogoCodaPromo', () => {
  it('conta solo i giri della promo e quello che c\'e\' davanti', () => {
    const adesso = new Date('2026-12-10T08:00:00Z')
    const attive = [
      { id: 'c1', created_at: '2026-12-10T07:00:00Z', status: 'sending', total_recipients: 100, sent_count: 0, failed_count: 0, audience: 'drip', audience_filters: {} },
      { id: 'p1', created_at: '2026-12-10T07:30:00Z', status: 'pending', total_recipients: 30, sent_count: 0, failed_count: 0, audience: AUDIENCE_PROMO_AUTOMATICHE, audience_filters: filtriIncassi() },
    ]
    expect(riepilogoCodaPromo(attive, 'promo_incassi', adesso)).toMatchObject({ inCoda: 30, davanti: 100 })
    expect(riepilogoCodaPromo(attive, 'maxi_promo_gap', adesso).inCoda).toBe(0)
  })
})
