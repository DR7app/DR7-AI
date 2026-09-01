// ═══════════════════════════════════════════════════════════════════════════
// DR7 A.I SYSTEM CONTROL — motore lato server
//
// Tutto quello che il resto del gestionale usa per farsi vedere dal System
// Control: registrare un errore, mettere in coda un'operazione da ritentare,
// misurare la salute di un'integrazione, tenere l'audit.
//
// TRE REGOLE INDEROGABILI:
//  1. Niente qui dentro puo' far fallire il chiamante. Ogni funzione e'
//     avvolta in try/catch: se le tabelle non esistono ancora (migrazione
//     manuale non eseguita) il gestionale continua a funzionare come prima.
//  2. Nessuna credenziale viene mai scritta. `sanifica()` gira su tutto.
//  3. Nessun ritentativo puo' duplicare un'operazione critica: si passa
//     sempre da una chiave di idempotenza.
// ═══════════════════════════════════════════════════════════════════════════
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { traduciErrore, INTEGRAZIONE_BY_CHIAVE, type Severita, type ClasseRisoluzione } from './systemControlCatalog'

let client: SupabaseClient | null = null
function db(): SupabaseClient | null {
  if (client) return client
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  client = createClient(url, key, { auth: { persistSession: false } })
  return client
}

export const AMBIENTE = process.env.CONTEXT === 'production' ? 'production'
  : process.env.CONTEXT ? String(process.env.CONTEXT) : 'development'
export const VERSIONE = process.env.COMMIT_REF ? String(process.env.COMMIT_REF).slice(0, 8) : 'sconosciuta'

// ── Sanificazione ──────────────────────────────────────────────────────────
// Chiavi che non devono MAI finire nel database del System Control.
const CHIAVI_SEGRETE = /(pass(word)?|secret|token|api[_-]?key|apikey|authorization|auth|bearer|credential|cookie|session|pan|cvv|iban|service[_-]?role|jwt|signature|otp|codice_?otp)/i
// Valori che sembrano una chiave anche se il nome del campo e' innocuo.
const VALORE_SEGRETO = /(eyJ[A-Za-z0-9_-]{10,}|sk_[A-Za-z0-9]{10,}|Bearer\s+\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----)/

export function mascheraTesto(testo: string): string {
  if (!testo) return testo
  return testo
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, '[token nascosto]')
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer [nascosto]')
    .replace(/(api[_-]?key|token|password|secret)("?\s*[:=]\s*"?)([^"'\s,&}]{4,})/gi, '$1$2[nascosto]')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[chiave privata nascosta]')
}

/** Ripulisce ricorsivamente un oggetto da credenziali e dati sensibili. */
export function sanifica(valore: unknown, profondita = 0): unknown {
  if (valore === null || valore === undefined) return valore
  if (profondita > 6) return '[troppo profondo]'
  if (typeof valore === 'string') {
    if (VALORE_SEGRETO.test(valore)) return '[nascosto]'
    return mascheraTesto(valore.length > 4000 ? `${valore.slice(0, 4000)}…` : valore)
  }
  if (typeof valore === 'number' || typeof valore === 'boolean') return valore
  if (Array.isArray(valore)) return valore.slice(0, 50).map(v => sanifica(v, profondita + 1))
  if (typeof valore === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(valore as Record<string, unknown>).slice(0, 60)) {
      out[k] = CHIAVI_SEGRETE.test(k) ? '[nascosto]' : sanifica(v, profondita + 1)
    }
    return out
  }
  return String(valore)
}

// ── Impronta di un errore (raggruppamento) ─────────────────────────────────
// Normalizza numeri, uuid, date e virgolette cosi' mille occorrenze dello
// stesso problema cadono in un solo gruppo.
export function normalizzaMessaggio(m: string): string {
  return (m || '')
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '{id}')
    .replace(/\d{4}-\d{2}-\d{2}[t ]?[\d:.]*z?/g, '{data}')
    .replace(/\b\d+([.,]\d+)?\b/g, '{n}')
    .replace(/["'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

function hash(s: string): string {
  // FNV-1a a 32 bit: basta per raggruppare, non serve crittografia.
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export function impronta(parti: (string | null | undefined)[]): string {
  return hash(parti.filter(Boolean).join('|'))
}

// ── Registrazione di un evento ─────────────────────────────────────────────
export interface EventoTecnico {
  messaggio: string
  status?: number | null
  categoria?: string
  modulo?: string
  funzione?: string
  integrazione?: string
  business?: string
  sede?: string
  utenteEmail?: string
  origine?: 'server' | 'client' | 'cron' | 'webhook' | 'database'
  stack?: string
  contesto?: Record<string, unknown>
  requestId?: string
  correlationId?: string
  durataMs?: number
  /** Forza severita'/classe quando il chiamante sa gia' di cosa si tratta. */
  severita?: Severita
  classe?: ClasseRisoluzione
  titolo?: string
}

export interface EsitoRegistrazione {
  gruppoId: string | null
  titolo: string
  severita: Severita
  classe: ClasseRisoluzione
  occorrenze: number
}

/**
 * Registra un errore tecnico e lo raggruppa. Non lancia mai.
 * Ritorna il gruppo, cosi' il chiamante puo' collegarci un'operazione.
 */
export async function registraEvento(e: EventoTecnico): Promise<EsitoRegistrazione> {
  const tradotto = traduciErrore(e.messaggio, e.status)
  const titolo = e.titolo || tradotto.titolo
  const severita = e.severita || tradotto.severita
  const classe = e.classe || tradotto.classe
  const vuoto: EsitoRegistrazione = { gruppoId: null, titolo, severita, classe, occorrenze: 0 }

  const sb = db()
  if (!sb) return vuoto

  try {
    const fp = impronta([
      e.categoria || 'altro', e.modulo || '', e.integrazione || '',
      normalizzaMessaggio(titolo), normalizzaMessaggio(e.messaggio),
    ])
    const ora = new Date().toISOString()
    const messaggioPulito = mascheraTesto(String(e.messaggio || '')).slice(0, 2000)

    const { data: esistente } = await sb
      .from('sc_error_groups')
      .select('id, occorrenze, aziende_coinvolte, utenti_coinvolti, stato')
      .eq('impronta', fp)
      .maybeSingle()

    let gruppoId: string | null = (esistente as { id?: string } | null)?.id || null
    let occorrenze = 1

    if (gruppoId) {
      const g = esistente as { occorrenze: number; aziende_coinvolte: string[]; utenti_coinvolti: string[]; stato: string }
      occorrenze = (g.occorrenze || 0) + 1
      const aziende = new Set([...(g.aziende_coinvolte || []), ...(e.business ? [e.business] : [])])
      const utenti = new Set([...(g.utenti_coinvolti || []), ...(e.utenteEmail ? [e.utenteEmail] : [])])
      await sb.from('sc_error_groups').update({
        ultima_comparsa: ora,
        occorrenze,
        messaggio_tecnico: messaggioPulito,
        aziende_coinvolte: Array.from(aziende).slice(0, 50),
        utenti_coinvolti: Array.from(utenti).slice(0, 50),
        // un problema richiuso che si ripresenta torna aperto: non si nasconde
        stato: g.stato === 'risolto' ? 'aperto' : g.stato,
        severita,
      }).eq('id', gruppoId)
    } else {
      const { data: creato } = await sb.from('sc_error_groups').insert({
        impronta: fp,
        titolo,
        messaggio_tecnico: messaggioPulito,
        causa_probabile: tradotto.causa,
        severita,
        categoria: e.categoria || 'altro',
        classe_risoluzione: classe,
        modulo: e.modulo || null,
        funzione: e.funzione || null,
        integrazione: e.integrazione || null,
        business: e.business || null,
        azioni_suggerite: tradotto.azioni,
        prima_comparsa: ora,
        ultima_comparsa: ora,
        occorrenze: 1,
        aziende_coinvolte: e.business ? [e.business] : [],
        utenti_coinvolti: e.utenteEmail ? [e.utenteEmail] : [],
      }).select('id').single()
      gruppoId = (creato as { id?: string } | null)?.id || null
      // corsa fra due esecuzioni: se l'impronta esiste gia', riprendila
      if (!gruppoId) {
        const { data: riletto } = await sb.from('sc_error_groups').select('id, occorrenze').eq('impronta', fp).maybeSingle()
        gruppoId = (riletto as { id?: string } | null)?.id || null
        occorrenze = (riletto as { occorrenze?: number } | null)?.occorrenze || 1
      }
    }

    if (gruppoId) {
      await sb.from('sc_error_events').insert({
        gruppo_id: gruppoId,
        severita,
        messaggio_tecnico: messaggioPulito,
        stack: e.stack ? mascheraTesto(e.stack).slice(0, 6000) : null,
        contesto: sanifica(e.contesto || {}) as Record<string, unknown>,
        origine: e.origine || 'server',
        modulo: e.modulo || null,
        funzione: e.funzione || null,
        integrazione: e.integrazione || null,
        business: e.business || null,
        sede: e.sede || null,
        utente_email: e.utenteEmail || null,
        request_id: e.requestId || null,
        correlation_id: e.correlationId || null,
        ambiente: AMBIENTE,
        versione: VERSIONE,
        durata_ms: e.durataMs ?? null,
      })
    }

    return { gruppoId, titolo, severita, classe, occorrenze }
  } catch (err) {
    // Il System Control non deve MAI rompere il flusso che lo chiama.
    console.warn('[systemControl] registraEvento non riuscita:', (err as Error)?.message)
    return vuoto
  }
}

// ── Coda delle operazioni da ritentare ─────────────────────────────────────
export interface OperazioneDaAccodare {
  tipo: string
  chiaveIdempotenza: string
  descrizione: string
  integrazione?: string
  business?: string
  entitaTipo?: string
  entitaId?: string
  endpoint?: string
  payload?: Record<string, unknown>
  errore?: string
  maxTentativi?: number
  gruppoId?: string | null
  /** false = non la ritenta il worker, la rilancia solo l'amministratore. */
  automatica?: boolean
}

/**
 * Mette in coda (o aggiorna) un'operazione non riuscita.
 * La chiave di idempotenza e' UNIQUE: due chiamate per la stessa operazione
 * NON creano due righe, quindi un ritentativo non puo' duplicare una fattura,
 * un pagamento, un contratto o una prenotazione.
 */
export async function accodaOperazione(op: OperazioneDaAccodare): Promise<string | null> {
  const sb = db()
  if (!sb) return null
  try {
    const { data: esistente } = await sb
      .from('sc_operations')
      .select('id, tentativi, stato')
      .eq('chiave_idempotenza', op.chiaveIdempotenza)
      .maybeSingle()

    const errore = op.errore ? mascheraTesto(op.errore).slice(0, 1500) : null

    if (esistente) {
      const e = esistente as { id: string; tentativi: number; stato: string }
      // Un'operazione gia' riuscita non torna mai in coda: e' la barriera
      // anti-doppione lato worker.
      if (e.stato === 'riuscita') return e.id
      await sb.from('sc_operations').update({
        stato: 'in_coda',
        ultimo_errore: errore,
        ultimo_errore_at: new Date().toISOString(),
        prossimo_tentativo_at: prossimoTentativo(e.tentativi || 0),
        gruppo_id: op.gruppoId || null,
        updated_at: new Date().toISOString(),
      }).eq('id', e.id)
      return e.id
    }

    const { data } = await sb.from('sc_operations').insert({
      tipo: op.tipo,
      chiave_idempotenza: op.chiaveIdempotenza,
      descrizione: op.descrizione.slice(0, 300),
      integrazione: op.integrazione || null,
      business: op.business || null,
      entita_tipo: op.entitaTipo || null,
      entita_id: op.entitaId || null,
      endpoint: op.endpoint || null,
      payload: sanifica(op.payload || {}) as Record<string, unknown>,
      ultimo_errore: errore,
      ultimo_errore_at: errore ? new Date().toISOString() : null,
      max_tentativi: op.maxTentativi ?? 5,
      prossimo_tentativo_at: prossimoTentativo(0),
      gruppo_id: op.gruppoId || null,
      automatica: op.automatica !== false,
    }).select('id').single()
    return (data as { id?: string } | null)?.id || null
  } catch (err) {
    console.warn('[systemControl] accodaOperazione non riuscita:', (err as Error)?.message)
    return null
  }
}

/** Ritardo crescente: 1, 5, 15, 60, 180 minuti. Poi si smette di insistere. */
export function prossimoTentativo(tentativiFatti: number): string {
  const minuti = [1, 5, 15, 60, 180][Math.min(tentativiFatti, 4)]
  return new Date(Date.now() + minuti * 60_000).toISOString()
}

/** Segna un'operazione come riuscita (idempotente). */
export async function chiudiOperazione(chiaveIdempotenza: string, da?: string): Promise<void> {
  const sb = db()
  if (!sb) return
  try {
    await sb.from('sc_operations').update({
      stato: 'riuscita',
      risolta_at: new Date().toISOString(),
      risolta_da: da || 'automatico',
      updated_at: new Date().toISOString(),
    }).eq('chiave_idempotenza', chiaveIdempotenza)
  } catch { /* mai bloccante */ }
}

/** true se questa operazione risulta gia' completata: da chiamare PRIMA di rifarla. */
export async function giaCompletata(chiaveIdempotenza: string): Promise<boolean> {
  const sb = db()
  if (!sb) return false
  try {
    const { data } = await sb.from('sc_operations')
      .select('stato').eq('chiave_idempotenza', chiaveIdempotenza).maybeSingle()
    return (data as { stato?: string } | null)?.stato === 'riuscita'
  } catch { return false }
}

// ── Salute delle integrazioni + interruttore automatico ────────────────────
const SOGLIA_CIRCUITO = 5          // fallimenti consecutivi prima di fermarsi
const PAUSA_CIRCUITO_MIN = 10      // minuti di stop prima di riprovare

/** Registra l'esito di una chiamata a un servizio esterno. Non lancia mai. */
export async function segnaChiamata(
  integrazione: string,
  ok: boolean,
  opts: { durataMs?: number; errore?: string; status?: number | null } = {}
): Promise<void> {
  const sb = db()
  if (!sb) return
  try {
    const { data } = await sb.from('sc_integrations')
      .select('chiamate_ok, chiamate_ko, latenza_media_ms, fallimenti_consecutivi, circuito')
      .eq('chiave', integrazione).maybeSingle()
    const r = (data || {}) as { chiamate_ok?: number; chiamate_ko?: number; latenza_media_ms?: number; fallimenti_consecutivi?: number; circuito?: string }
    const ora = new Date().toISOString()
    const totale = (r.chiamate_ok || 0) + (r.chiamate_ko || 0)
    const latenza = opts.durataMs != null
      ? Math.round((((r.latenza_media_ms || 0) * totale) + opts.durataMs) / (totale + 1))
      : (r.latenza_media_ms || 0)

    if (ok) {
      await sb.from('sc_integrations').upsert({
        chiave: integrazione,
        etichetta: INTEGRAZIONE_BY_CHIAVE[integrazione]?.etichetta || integrazione,
        categoria: INTEGRAZIONE_BY_CHIAVE[integrazione]?.categoria || 'altro',
        chiamate_ok: (r.chiamate_ok || 0) + 1,
        latenza_media_ms: latenza,
        fallimenti_consecutivi: 0,
        circuito: 'chiuso',
        circuito_fino_a: null,
        stato: 'collegato',
        ultima_chiamata_ok_at: ora,
        updated_at: ora,
      }, { onConflict: 'chiave' })
      return
    }

    const falliti = (r.fallimenti_consecutivi || 0) + 1
    const apri = falliti >= SOGLIA_CIRCUITO
    const tradotto = traduciErrore(opts.errore || '', opts.status)
    await sb.from('sc_integrations').upsert({
      chiave: integrazione,
      etichetta: INTEGRAZIONE_BY_CHIAVE[integrazione]?.etichetta || integrazione,
      categoria: INTEGRAZIONE_BY_CHIAVE[integrazione]?.categoria || 'altro',
      chiamate_ko: (r.chiamate_ko || 0) + 1,
      latenza_media_ms: latenza,
      fallimenti_consecutivi: falliti,
      circuito: apri ? 'aperto' : (r.circuito || 'chiuso'),
      circuito_fino_a: apri ? new Date(Date.now() + PAUSA_CIRCUITO_MIN * 60_000).toISOString() : null,
      stato: tradotto.titolo === 'Credenziali non valide' ? 'credenziali_scadute'
        : tradotto.titolo === 'Token scaduto' ? 'credenziali_scadute'
        : tradotto.titolo === 'Servizio momentaneamente non disponibile' ? 'servizio_non_disponibile'
        : 'errore',
      ultimo_errore: mascheraTesto(opts.errore || '').slice(0, 800),
      ultimo_errore_at: ora,
      updated_at: ora,
    }, { onConflict: 'chiave' })
  } catch { /* mai bloccante */ }
}

/**
 * L'integrazione e' utilizzabile adesso?
 * false quando e' spenta a mano o quando l'interruttore automatico e' aperto
 * (troppi fallimenti di fila): in quel caso l'operazione va messa in coda, MAI
 * persa, e ritentata dopo la pausa.
 */
export async function integrazioneUtilizzabile(integrazione: string): Promise<{ ok: boolean; motivo?: string }> {
  const sb = db()
  if (!sb) return { ok: true }
  try {
    const { data } = await sb.from('sc_integrations')
      .select('abilitata, circuito, circuito_fino_a').eq('chiave', integrazione).maybeSingle()
    const r = data as { abilitata?: boolean; circuito?: string; circuito_fino_a?: string | null } | null
    if (!r) return { ok: true }
    if (r.abilitata === false) return { ok: false, motivo: 'Integrazione disattivata dal System Control.' }
    if (r.circuito === 'aperto') {
      const fino = r.circuito_fino_a ? new Date(r.circuito_fino_a).getTime() : 0
      if (fino > Date.now()) return { ok: false, motivo: 'Troppi errori di fila: le chiamate sono in pausa, l operazione resta in coda.' }
      await sb.from('sc_integrations').update({ circuito: 'semiaperto' }).eq('chiave', integrazione)
    }
    return { ok: true }
  } catch { return { ok: true } }
}

/**
 * Esegue una chiamata a un servizio esterno con misura, ritentativi e
 * interruttore automatico. Se il servizio e' in pausa non chiama: ritorna
 * `inPausa` e sta al chiamante accodare l'operazione.
 */
export async function chiamataEsterna<T>(
  integrazione: string,
  esegui: () => Promise<T>,
  opts: { tentativi?: number; modulo?: string; business?: string } = {}
): Promise<{ ok: true; dato: T } | { ok: false; errore: string; inPausa?: boolean }> {
  const usabile = await integrazioneUtilizzabile(integrazione)
  if (!usabile.ok) return { ok: false, errore: usabile.motivo || 'Integrazione non disponibile', inPausa: true }

  const tentativi = Math.max(1, opts.tentativi ?? 3)
  let ultimoErrore = ''
  for (let i = 0; i < tentativi; i++) {
    const t0 = Date.now()
    try {
      const dato = await esegui()
      await segnaChiamata(integrazione, true, { durataMs: Date.now() - t0 })
      return { ok: true, dato }
    } catch (err) {
      ultimoErrore = (err as Error)?.message || String(err)
      await segnaChiamata(integrazione, false, { durataMs: Date.now() - t0, errore: ultimoErrore })
      const recuperabile = /timeout|econnreset|econnrefused|enotfound|fetch failed|network|502|503|504|429/i.test(ultimoErrore)
      if (!recuperabile || i === tentativi - 1) break
      // attesa crescente: 0.5s, 2s, 8s
      await new Promise(r => setTimeout(r, 500 * Math.pow(4, i)))
    }
  }
  await registraEvento({
    messaggio: ultimoErrore, integrazione, modulo: opts.modulo,
    business: opts.business, categoria: 'integrazione',
  })
  return { ok: false, errore: ultimoErrore }
}

// ── Audit di ogni intervento ───────────────────────────────────────────────
export async function registraAzione(a: {
  azione: string
  attoreEmail?: string | null
  attoreNome?: string | null
  automatico?: boolean
  bersaglioTipo?: string
  bersaglioId?: string
  business?: string
  problema?: string
  parametri?: Record<string, unknown>
  esito?: 'ok' | 'errore' | 'rifiutata'
  messaggio?: string
  durataMs?: number
}): Promise<void> {
  const sb = db()
  if (!sb) return
  try {
    await sb.from('sc_actions_log').insert({
      azione: a.azione,
      attore_email: a.attoreEmail || null,
      attore_nome: a.attoreNome || null,
      automatico: a.automatico === true,
      bersaglio_tipo: a.bersaglioTipo || null,
      bersaglio_id: a.bersaglioId || null,
      business: a.business || null,
      problema: a.problema || null,
      parametri: sanifica(a.parametri || {}) as Record<string, unknown>,
      esito: a.esito || 'ok',
      messaggio: a.messaggio ? mascheraTesto(a.messaggio).slice(0, 1000) : null,
      durata_ms: a.durataMs ?? null,
    })
  } catch { /* mai bloccante */ }
}

// ── Storico configurazioni ─────────────────────────────────────────────────
export async function registraConfig(c: {
  tabella: string
  rigaId: string
  etichetta?: string
  prima?: unknown
  dopo?: unknown
  modificatoDa?: string | null
}): Promise<void> {
  const sb = db()
  if (!sb) return
  try {
    await sb.from('sc_config_history').insert({
      tabella: c.tabella,
      riga_id: c.rigaId,
      etichetta: c.etichetta || null,
      prima: sanifica(c.prima ?? null),
      dopo: sanifica(c.dopo ?? null),
      modificato_da: c.modificatoDa || null,
    })
  } catch { /* mai bloccante */ }
}

// ── Interruttori funzione / manutenzione ───────────────────────────────────
export interface StatoFunzione { attiva: boolean; manutenzione: boolean; messaggio?: string | null }

/** Legge un interruttore. In caso di dubbio la funzione resta ACCESA. */
export async function statoFunzione(chiave: string, business = '*'): Promise<StatoFunzione> {
  const sb = db()
  if (!sb) return { attiva: true, manutenzione: false }
  try {
    const { data } = await sb.from('sc_flags')
      .select('chiave, business, attiva, manutenzione, messaggio')
      .eq('chiave', chiave).in('business', [business, '*'])
    const righe = (data || []) as { business: string; attiva: boolean; manutenzione: boolean; messaggio: string | null }[]
    if (!righe.length) return { attiva: true, manutenzione: false }
    // Lo spegnimento vince sempre: globale o del singolo business.
    const spenta = righe.find(r => r.attiva === false)
    const inManutenzione = righe.find(r => r.manutenzione === true)
    return {
      attiva: !spenta,
      manutenzione: !!inManutenzione,
      messaggio: (spenta || inManutenzione)?.messaggio || null,
    }
  } catch { return { attiva: true, manutenzione: false } }
}

// ── Prestazioni ────────────────────────────────────────────────────────────
export async function registraMetrica(
  tipo: 'funzione' | 'query' | 'pagina' | 'integrazione' | 'job',
  nome: string,
  durataMs: number,
  opts: { errore?: boolean; business?: string } = {}
): Promise<void> {
  const sb = db()
  if (!sb) return
  try {
    const ora = new Date()
    ora.setMinutes(0, 0, 0)
    const oraIso = ora.toISOString()
    const business = opts.business || '*'
    const { data } = await sb.from('sc_metrics')
      .select('id, chiamate, errori, durata_totale_ms, durata_max_ms')
      .eq('tipo', tipo).eq('nome', nome).eq('business', business).eq('ora', oraIso).maybeSingle()
    if (data) {
      const r = data as { id: string; chiamate: number; errori: number; durata_totale_ms: number; durata_max_ms: number }
      await sb.from('sc_metrics').update({
        chiamate: r.chiamate + 1,
        errori: r.errori + (opts.errore ? 1 : 0),
        durata_totale_ms: Number(r.durata_totale_ms) + durataMs,
        durata_max_ms: Math.max(r.durata_max_ms, durataMs),
      }).eq('id', r.id)
    } else {
      await sb.from('sc_metrics').insert({
        tipo, nome: nome.slice(0, 120), business, ora: oraIso,
        chiamate: 1, errori: opts.errore ? 1 : 0,
        durata_totale_ms: durataMs, durata_max_ms: durataMs,
      })
    }
  } catch { /* mai bloccante */ }
}

/**
 * Avvolge una Netlify function: misura, cattura l'errore, lo registra e lo
 * rilancia. Da usare cosi':
 *   export const handler = conSystemControl('nome-funzione', handlerVero)
 */
export function conSystemControl<F extends (...args: never[]) => unknown>(
  nome: string,
  handler: F,
): F {
  const avvolto = async (...args: Parameters<F>): Promise<unknown> => {
    const t0 = Date.now()
    try {
      const res = await (handler as unknown as (...a: unknown[]) => unknown)(...args)
      const status = (res as { statusCode?: number })?.statusCode
      const errore = typeof status === 'number' && status >= 500
      const durata = Date.now() - t0
      // Si registra solo cio' che serve al pannello Prestazioni: le chiamate
      // lente e quelle in errore. Cronometrare anche le chiamate veloci
      // aggiungerebbe una scrittura inutile su ogni richiesta.
      if (errore || durata > 1000) await registraMetrica('funzione', nome, durata, { errore })
      if (errore) {
        let corpo = ''
        try { corpo = String((res as { body?: string }).body || '').slice(0, 500) } catch { /* ignora */ }
        await registraEvento({
          messaggio: corpo || `HTTP ${status}`, status, categoria: 'api',
          modulo: nome, funzione: nome, durataMs: durata,
        })
      }
      return res
    } catch (err) {
      await registraMetrica('funzione', nome, Date.now() - t0, { errore: true })
      await registraEvento({
        messaggio: (err as Error)?.message || String(err),
        stack: (err as Error)?.stack,
        categoria: 'api', modulo: nome, funzione: nome,
        severita: 'alto', durataMs: Date.now() - t0,
      })
      throw err
    }
  }
  return avvolto as unknown as F
}
