/**
 * 09/11/2026 (direzione): "Tutti i clienti" di Messaggi Sistema Pro in coda.
 *
 * Prima il broadcast "Tutti i clienti" partiva dal cron dei messaggi di
 * sistema a tutti di fila, senza tetto: con le campagne marketing gia' in coda
 * a 50/ora, lo stesso numero WhatsApp poteva ricevere centinaia di invii in
 * pochi minuti e farsi bloccare.
 *
 * Ora ogni giro del broadcast entra nella STESSA coda delle campagne
 * (marketing_campaigns + marketing_campaign_recipients, audience
 * AUDIENCE_MESSAGGI_SISTEMA) e lo smaltisce process-scheduled-campaigns-cron
 * con la stessa presa atomica (campagne_prenota_destinatario): tetto di 50
 * l'ora per le due strade INSIEME, solo 9-21 ora di Roma, il resto il giorno
 * dopo. Nessuna tabella ne' funzione SQL nuova.
 *
 * Qui: mettere in coda un giro (accodaGiroMessaggiSistema) e mandare UN
 * destinatario di un giro (inviaDestinatarioMessaggiSistema), con lo stesso
 * testo di prima: send-whatsapp-notification con il template del messaggio.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { AUDIENCE_MESSAGGI_SISTEMA, type FiltriGiroMessaggiSistema } from '../../../src/utils/campagneFrequenza'

export interface DestinatarioCoda {
  nome: string
  phone: string
  email?: string | null
  customerId?: string | null
}

export interface EsitoAccodamento {
  esito: 'accodato' | 'gia_accodato' | 'nessuno' | 'errore'
  accodati: number
  /** Destinatari saltati perche' ancora in coda da un giro precedente dello stesso messaggio. */
  giaInCoda: number
  motivo?: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BLOCCO_INSERT = 500

/** Solo cifre, senza 00 iniziale: chiave di confronto dei numeri. */
export function cifreNumero(raw: string | null | undefined): string {
  return String(raw || '').replace(/\D/g, '').replace(/^00/, '')
}

/** Numeri ancora in coda (pending/sending) in giri precedenti dello stesso messaggio. */
async function numeriGiaInCoda(sb: SupabaseClient, systemMessageId: string): Promise<Set<string>> {
  const out = new Set<string>()
  const { data: giri, error } = await sb
    .from('marketing_campaigns')
    .select('id')
    .eq('audience', AUDIENCE_MESSAGGI_SISTEMA)
    .in('status', ['pending', 'sending'])
    .eq('audience_filters->>system_message_id', systemMessageId)
  if (error) throw new Error(`lettura giri in coda: ${error.message}`)
  const ids = ((giri || []) as Array<{ id: string }>).map(g => g.id)
  if (ids.length === 0) return out
  for (let page = 0; page < 200; page++) {
    const { data, error: recErr } = await sb
      .from('marketing_campaign_recipients')
      .select('id, phone')
      .in('campaign_id', ids)
      .in('status', ['pending', 'sending'])
      .order('id', { ascending: true })
      .range(page * 1000, page * 1000 + 999)
    if (recErr) throw new Error(`lettura destinatari in coda: ${recErr.message}`)
    const righe = (data || []) as Array<{ phone: string | null }>
    for (const r of righe) {
      const c = cifreNumero(r.phone)
      if (c) out.add(c)
    }
    if (righe.length < 1000) break
  }
  return out
}

/**
 * Mette in coda UN giro di broadcast di un messaggio di sistema.
 *
 * - Una sola volta per `logKey`: il "posto" si prende con una riga in
 *   system_message_send_log (UNIQUE system_message_id + booking_id), come
 *   faceva l'invio diretto per ogni destinatario. Due giri del cron nella
 *   stessa finestra non accodano due volte.
 * - Nessun doppione: chi e' ancora in coda da un giro precedente dello stesso
 *   messaggio (es. gli avanzi di ieri) non viene accodato di nuovo.
 * - Nessuna perdita: se qualcosa va storto a meta' il posto si libera e il
 *   giro dopo del cron riprova; chi e' gia' stato accodato viene saltato
 *   (regola sopra), quindi si completa senza doppioni.
 */
export async function accodaGiroMessaggiSistema(sb: SupabaseClient, opts: {
  tpl: { id: string; message_key: string; label?: string | null }
  chiaveGiro: string
  logKey: string
  destinatari: DestinatarioCoda[]
  modo: 'template' | 'testo'
  /** Solo modo 'testo': testo gia' composto ({nome} e {cognome} si sostituiscono per destinatario). */
  testo?: string
  variabili?: Record<string, string>
}): Promise<EsitoAccodamento> {
  const { tpl, chiaveGiro, logKey, modo } = opts
  const etichetta = String(tpl.label || tpl.message_key)

  // Destinatari unici per numero.
  const unici = new Map<string, DestinatarioCoda>()
  for (const d of opts.destinatari) {
    const c = cifreNumero(d.phone)
    if (c.length >= 8 && !unici.has(c)) unici.set(c, { ...d, phone: c })
  }
  if (unici.size === 0) return { esito: 'nessuno', accodati: 0, giaInCoda: 0 }

  // 1. Il posto del giro.
  const { data: posto, error: postoErr } = await sb
    .from('system_message_send_log')
    .insert({ system_message_id: tpl.id, booking_id: logKey, customer_phone: [...unici.keys()][0], status: 'sending' })
    .select('id')
    .maybeSingle()
  if (postoErr || !posto?.id) {
    const duplicato = (postoErr as { code?: string } | null)?.code === '23505'
    if (duplicato || !postoErr) return { esito: 'gia_accodato', accodati: 0, giaInCoda: 0 }
    // Log non scrivibile: non si accoda (fail-closed, come l'invio diretto).
    return { esito: 'errore', accodati: 0, giaInCoda: 0, motivo: postoErr.message }
  }
  const liberaPosto = async () => {
    await sb.from('system_message_send_log').delete().eq('id', posto.id)
  }

  // 2. Chi e' ancora in coda da un giro precedente non si accoda di nuovo.
  let giaInCodaSet: Set<string>
  try {
    giaInCodaSet = await numeriGiaInCoda(sb, tpl.id)
  } catch (e) {
    await liberaPosto()
    return { esito: 'errore', accodati: 0, giaInCoda: 0, motivo: e instanceof Error ? e.message : String(e) }
  }
  const daAccodare = [...unici.values()].filter(d => !giaInCodaSet.has(d.phone))
  const giaInCoda = unici.size - daAccodare.length
  if (daAccodare.length === 0) {
    await sb.from('system_message_send_log')
      .update({ status: 'skipped', error: `Tutti i ${giaInCoda} destinatari sono ancora in coda da un giro precedente.` })
      .eq('id', posto.id)
    return { esito: 'nessuno', accodati: 0, giaInCoda }
  }

  // 3. Il giro (una riga di marketing_campaigns, letta dal cron delle campagne).
  const filtri: FiltriGiroMessaggiSistema = {
    system_message_id: tpl.id,
    message_key: tpl.message_key,
    modo,
    chiave_giro: chiaveGiro,
    etichetta,
    ...(opts.variabili && Object.keys(opts.variabili).length > 0 ? { variabili: opts.variabili } : {}),
  }
  const { data: giro, error: giroErr } = await sb
    .from('marketing_campaigns')
    .insert({
      title: `Messaggi Sistema Pro: ${etichetta}`,
      message_text: modo === 'testo' ? String(opts.testo || '') : `Testo del messaggio di sistema "${etichetta}" (${tpl.message_key})`,
      channel: 'whatsapp',
      audience: AUDIENCE_MESSAGGI_SISTEMA,
      audience_filters: filtri,
      total_recipients: daAccodare.length,
      status: 'pending',
      recurrence_type: 'none',
    })
    .select('id')
    .single()
  if (giroErr || !giro) {
    await liberaPosto()
    return { esito: 'errore', accodati: 0, giaInCoda, motivo: giroErr?.message || 'giro non creato' }
  }
  const giroId = (giro as { id: string }).id

  // 4. I destinatari, a blocchi (un tentativo in piu' per blocco).
  let accodati = 0
  let motivoErrore: string | null = null
  for (let i = 0; i < daAccodare.length; i += BLOCCO_INSERT) {
    const righe = daAccodare.slice(i, i + BLOCCO_INSERT).map(d => ({
      campaign_id: giroId,
      customer_id: d.customerId && UUID_RE.test(d.customerId) ? d.customerId : null,
      customer_name: d.nome || 'Cliente',
      phone: d.phone,
      email: d.email || null,
      status: 'pending',
    }))
    let { error } = await sb.from('marketing_campaign_recipients').insert(righe)
    if (error) ({ error } = await sb.from('marketing_campaign_recipients').insert(righe))
    if (error) { motivoErrore = error.message; break }
    accodati += righe.length
  }

  if (motivoErrore) {
    // Il giro tiene solo chi e' entrato davvero; il posto si libera e il
    // prossimo giro del cron accoda i mancanti (gli altri sono "gia' in coda").
    if (accodati === 0) await sb.from('marketing_campaigns').delete().eq('id', giroId)
    else await sb.from('marketing_campaigns').update({ total_recipients: accodati }).eq('id', giroId)
    await liberaPosto()
    return { esito: 'errore', accodati, giaInCoda, motivo: motivoErrore }
  }

  await sb.from('system_message_send_log')
    .update({ status: 'sent', error: null })
    .eq('id', posto.id)
  return { esito: 'accodato', accodati, giaInCoda }
}

export type EsitoInvioCoda =
  | { tipo: 'inviato' }
  /** Non partito per una regola (template spento, testo vuoto...): non si rimanda. */
  | { tipo: 'saltato'; motivo: string }
  /** Sicuramente non partito (WhatsApp spento, bot non disponibile): torna in coda. */
  | { tipo: 'rimetti_in_coda'; motivo: string }
  /** Esito incerto: non si rimanda da solo (niente doppioni). */
  | { tipo: 'fallito'; motivo: string }

/**
 * Manda UN destinatario di un giro di Messaggi Sistema Pro, con lo stesso
 * percorso dell'invio diretto di prima (send-whatsapp-notification: template,
 * intestazione, variabili, lingua del prefisso, eventuale email).
 */
export async function inviaDestinatarioMessaggiSistema(
  filtri: FiltriGiroMessaggiSistema,
  testoGiro: string,
  r: { id: string; customer_name: string | null; email: string | null },
  phone: string,
): Promise<EsitoInvioCoda> {
  const baseUrl = process.env.URL || 'https://platform.dr7ai.com'
  const fullName = String(r.customer_name || '').trim()
  const nome = fullName.split(/\s+/)[0] || 'Cliente'
  const cognome = fullName.split(/\s+/).slice(1).join(' ')
  const comune = {
    customPhone: phone,
    customerEmail: r.email || '',
    // Il messaggio va SOLO a questo numero (niente copie a 2° guidatore ecc.).
    soloQuestoNumero: true,
    codaInviiMassivi: true,
  }
  const corpo = filtri.modo === 'testo'
    ? {
        ...comune,
        customMessage: testoGiro.split('{nome}').join(nome).split('{cognome}').join(cognome),
        type: filtri.etichetta || filtri.message_key,
      }
    : {
        ...comune,
        messageKey: filtri.message_key,
        booking: {
          id: `coda-${r.id}`,
          customer_name: fullName || 'Cliente',
          customer_email: r.email || '',
          customer_phone: phone,
          ...(filtri.variabili || {}),
        },
      }
  let res: Response
  try {
    res = await fetch(`${baseUrl}/.netlify/functions/send-whatsapp-notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    })
  } catch (e) {
    return { tipo: 'fallito', motivo: `Esito incerto (rete): ${e instanceof Error ? e.message : String(e)}` }
  }
  const json = await res.json().catch(() => ({})) as { skipped?: boolean; reason?: string; message?: string; error?: string; esito?: string }
  if (res.ok && !json.skipped) return { tipo: 'inviato' }
  if (res.ok) {
    const motivo = String(json.reason || json.message || 'saltato')
    if (json.reason === 'invio_whatsapp_off') return { tipo: 'rimetti_in_coda', motivo }
    return { tipo: 'saltato', motivo }
  }
  if (json.esito === 'istanza_non_disponibile') {
    return { tipo: 'rimetti_in_coda', motivo: String(json.error || 'Istanza WhatsApp non disponibile') }
  }
  return { tipo: 'fallito', motivo: String(json.error || json.message || `HTTP ${res.status}`) }
}
