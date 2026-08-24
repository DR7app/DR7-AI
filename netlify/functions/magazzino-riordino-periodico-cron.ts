import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

/**
 * Riordino PERIODICO del magazzino (24/08/2026).
 *
 * Fino a oggi il magazzino riordinava solo al raggiungimento della soglia
 * minima: non c'era modo di dire "il caffe' si ordina ogni 30 giorni". Qui si
 * guarda `inv_articoli.frequenza_giorni` e, se e' passato quel tempo
 * dall'ultimo riordino periodico, si crea l'ordine e lo si invia al contatto
 * memorizzato sull'articolo (WhatsApp o email).
 *
 * Il testo arriva da Messaggi di Sistema Pro (evento
 * `magazzino_ordine_fornitore`), come per gli ordini fatti a mano.
 * Solo articoli in modalita' AUTOMATICO: in manuale si crea la bozza e basta.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const BASE = process.env.URL || 'https://platform.dr7ai.com'

interface Articolo {
  id: string; codice: string; nome: string; unita: string | null
  quantita_riordino: number | null; soglia_minima: number | null
  fornitore_id: string | null; canale_riordino: string | null
  contatto_ordine: string | null; contatto_tipo: string | null
  frequenza_giorni: number | null; riordino_automatico: boolean
  ultimo_riordino_periodico: string | null
}

function giorniTra(a: string, b: Date): number {
  const d = new Date(a + 'T00:00:00')
  return Math.floor((b.getTime() - d.getTime()) / 86400000)
}

const handler: Handler = async () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, body: 'Missing Supabase config' }
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const oggi = new Date()
  const oggiIso = oggi.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })

  const { data: articoli, error } = await supabase
    .from('inv_articoli')
    .select('id, codice, nome, unita, quantita_riordino, soglia_minima, fornitore_id, canale_riordino, contatto_ordine, contatto_tipo, frequenza_giorni, riordino_automatico, ultimo_riordino_periodico')
    .eq('attivo', true)
    .not('frequenza_giorni', 'is', null)
    .gt('frequenza_giorni', 0)

  if (error) {
    console.error('[riordino-periodico] query fallita:', error.message)
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) }
  }

  // Testo da Messaggi di Sistema Pro; se manca si usa quello storico.
  let template: string | null = null
  try {
    const { data } = await supabase
      .from('system_messages').select('message_body, is_enabled')
      .contains('handled_events', ['magazzino_ordine_fornitore']).limit(5)
    const row = (data || []).find((r: { is_enabled?: boolean; message_body?: string }) =>
      r.is_enabled !== false && !!r.message_body)
    if (row?.message_body) template = row.message_body as string
  } catch { /* testo storico */ }

  const esiti: Record<string, unknown>[] = []

  for (const a of ((articoli || []) as unknown as Articolo[])) {
    const freq = Number(a.frequenza_giorni || 0)
    if (freq < 1) continue
    if (a.ultimo_riordino_periodico && giorniTra(a.ultimo_riordino_periodico, oggi) < freq) continue

    // Un ordine gia' aperto per l'articolo blocca il periodico: non si
    // sovrappongono due richieste allo stesso fornitore.
    const { data: aperti } = await supabase.from('inv_ordini')
      .select('id').eq('articolo_id', a.id).in('stato', ['bozza', 'inviato', 'confermato']).limit(1)
    if (aperti && aperti.length) { esiti.push({ articolo: a.nome, esito: 'ordine_gia_aperto' }); continue }

    const quantita = a.quantita_riordino || a.soglia_minima || 1
    const canale = a.contatto_tipo === 'email' ? 'email' : (a.canale_riordino || 'whatsapp')

    const { data: ord, error: ordErr } = await supabase.from('inv_ordini').insert({
      articolo_id: a.id, fornitore_id: a.fornitore_id, canale, quantita,
      stato: 'bozza', auto: true,
    }).select('id').single()
    if (ordErr) { esiti.push({ articolo: a.nome, esito: 'insert_fallito', errore: ordErr.message }); continue }

    const unita = a.unita || 'pz'
    const testo = template
      ? template
          .replace(/\{\{\s*articolo\s*\}\}/gi, a.nome)
          .replace(/\{\{\s*codice\s*\}\}/gi, a.codice || '')
          .replace(/\{\{\s*quantita\s*\}\}/gi, `${quantita} ${unita}`)
          .replace(/\{\{\s*unita\s*\}\}/gi, unita)
          .replace(/\{\{\s*fornitore\s*\}\}/gi, '')
      : `Ordine DR7 — Magazzino\n\nArticolo: ${a.nome}\n`
        + (a.codice ? `Codice: ${a.codice}\n` : '')
        + `Quantita: ${quantita} ${unita}\n`
        + `\nConsegna presso: DR7 — Viale Marconi 229, 09131 Cagliari (CA)`

    // In manuale ci si ferma alla bozza: la invia lo staff dalla tab.
    if (a.riordino_automatico === false || !a.contatto_ordine) {
      await supabase.from('inv_articoli')
        .update({ ultimo_riordino_periodico: oggiIso }).eq('id', a.id)
      esiti.push({ articolo: a.nome, esito: a.contatto_ordine ? 'bozza_manuale' : 'bozza_senza_contatto' })
      continue
    }

    try {
      if (a.contatto_tipo === 'email') {
        const r = await fetch(`${BASE}/.netlify/functions/send-magazzino-ordine-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.ADMIN_API_TOKEN || ''}` },
          body: JSON.stringify({ to: a.contatto_ordine, oggetto: `Ordine DR7 — ${a.nome}`, testo }),
        })
        if (!r.ok) throw new Error(`email HTTP ${r.status}`)
      } else {
        const r = await fetch(`${BASE}/.netlify/functions/send-whatsapp-notification`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customPhone: String(a.contatto_ordine).replace(/\D/g, ''),
            customMessage: testo, type: 'Ordine Magazzino',
          }),
        })
        if (!r.ok) throw new Error(`whatsapp HTTP ${r.status}`)
      }
      await supabase.from('inv_ordini')
        .update({ stato: 'inviato', sent_at: new Date().toISOString() }).eq('id', ord.id)
      await supabase.from('inv_articoli')
        .update({ ultimo_riordino_periodico: oggiIso }).eq('id', a.id)
      esiti.push({ articolo: a.nome, esito: 'inviato', canale: a.contatto_tipo || 'whatsapp' })
    } catch (e) {
      // Resta bozza: lo staff la vede nella tab e la manda a mano.
      esiti.push({ articolo: a.nome, esito: 'invio_fallito', errore: e instanceof Error ? e.message : String(e) })
    }
  }

  console.log('[riordino-periodico]', JSON.stringify(esiti))
  return { statusCode: 200, body: JSON.stringify({ controllati: (articoli || []).length, esiti }) }
}

export { handler }
