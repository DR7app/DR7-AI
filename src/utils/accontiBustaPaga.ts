// ──────────────────────────────────────────────────────────────────────────
// Acconti collegati alla busta paga (09/09/2026, richiesta direzione).
//
// Gli acconti registrati nella tab Acconti sono gli anticipi consegnati al
// collaboratore: vanno SOTTRATTI da quello che gli si paga a fine periodo.
// Esempio: paga del periodo 1.000 €, acconto gia' consegnato 300 € => a busta
// paga restano 700 €.
//
// Perche' un file a parte: la stessa somma serve in due punti (Buste Paga del
// Periodo e Calcola Paga nella scheda operatore) e i due schermi DEVONO dare
// lo stesso numero.
//
// Attenzione all'incrocio delle tabelle: `acconti_giornalieri.operatore_id` e'
// un `admins.id`, mentre le buste paga lavorano su `operatori_persone.id`. Il
// ponte e' `admins.user_id`/`admins.email`; quando l'acconto non ha
// `operatore_id` (riga vecchia) resta il nome denormalizzato.
//
// Visibilita': l'acconto e' un anticipo sul salario, quindi chi calcola le
// paghe deve vederlo per forza. La lettura passa dalla funzione
// `dr7_acconti_busta_paga` (migrazione 20260909_acconti_busta_paga): stesso
// gate delle buste paga — direzione / developer / stipendio-editor — senza
// allargare la tab Acconti, che resta sulla sua RLS piu' stretta
// (`acconti-tutti`). Finche' la migrazione non e' applicata si ripiega sulla
// lettura diretta della tabella: in quel caso gli acconti altrui non si
// vedono, e `fonte === 'tabella'` serve agli schermi per dirlo invece di far
// passare per netto un totale che non ha scalato niente.
// ──────────────────────────────────────────────────────────────────────────
import { supabase } from '../supabaseClient'
import type { AdminRoleTag } from '../hooks/useAdminRole'

/** Stessa lista del failsafe di `dr7_can_see_all_acconti()` in database. */
export const ACCONTI_FAILSAFE = ['valerio@dr7.app', 'ilenia@dr7.app']

/** Vede gli acconti di TUTTI gli operatori: spunta `acconti-tutti` o failsafe. */
export function vedeTuttiGliAcconti(
  hasRole: (tag: AdminRoleTag) => boolean,
  adminEmail: string | null | undefined
): boolean {
  return hasRole('acconti-tutti')
    || ACCONTI_FAILSAFE.includes((adminEmail || '').toLowerCase())
}

export interface AccontoBustaPaga {
  id: string
  operatore_id: string | null
  operatore_nome: string | null
  data: string
  importo_cents: number
  causale: string | null
  metodo_pagamento: string | null
}

/** Anagrafica minima di un operatore delle buste paga (`operatori_persone`). */
export interface OperatorePerAcconti {
  id: string
  email: string | null
  nome: string | null
  cognome?: string | null
  user_id?: string | null
}

/**
 * Da dove arrivano gli acconti letti:
 *   'rpc'     — funzione dedicata alle buste paga: elenco completo.
 *   'tabella' — ripiego sulla RLS della tab Acconti: puo' essere parziale.
 */
export type FonteAcconti = 'rpc' | 'tabella'

export interface AccontiPeriodo {
  /** chiave = operatori_persone.id */
  perOperatore: Map<string, AccontoBustaPaga[]>
  /** Acconti del periodo che non corrispondono a nessun operatore in elenco. */
  nonAbbinati: AccontoBustaPaga[]
  /** Messaggio di errore della lettura: se c'e', i totali NON sono affidabili. */
  errore: string | null
  fonte: FonteAcconti
}

const PAGINA = 1000

const CAMPI = 'id, operatore_id, operatore_nome, data, importo_cents, causale, metodo_pagamento'

/**
 * Legge le righe acconti del periodo. Prima la funzione delle buste paga
 * (elenco completo), poi — solo se quella funzione non esiste ancora sul
 * database — la tabella con la sua RLS.
 * PostgREST taglia a 1000 righe per richiesta: entrambe le strade paginano,
 * altrimenti in un mese pieno mancherebbero acconti e la busta paga tornerebbe
 * piu' alta del dovuto.
 */
async function leggiAcconti(
  from: string,
  to: string
): Promise<{ righe: AccontoBustaPaga[]; errore: string | null; fonte: FonteAcconti }> {
  const righe: AccontoBustaPaga[] = []
  for (let da = 0; ; da += PAGINA) {
    const { data, error } = await supabase
      .rpc('dr7_acconti_busta_paga', { p_da: from, p_a: to })
      .range(da, da + PAGINA - 1)
    if (error) {
      // Migrazione non ancora applicata: si ripiega, non si lascia la pagina
      // senza acconti.
      const mancante = error.code === 'PGRST202'
        || /does not exist|schema cache|could not find the function/i.test(error.message || '')
      if (!mancante) return { righe: [], errore: error.message, fonte: 'rpc' }
      return leggiAccontiDaTabella(from, to)
    }
    const blocco = (data as AccontoBustaPaga[] | null) || []
    righe.push(...blocco)
    if (blocco.length < PAGINA) break
  }
  return { righe, errore: null, fonte: 'rpc' }
}

async function leggiAccontiDaTabella(
  from: string,
  to: string
): Promise<{ righe: AccontoBustaPaga[]; errore: string | null; fonte: FonteAcconti }> {
  const righe: AccontoBustaPaga[] = []
  for (let da = 0; ; da += PAGINA) {
    const { data, error } = await supabase
      .from('acconti_giornalieri')
      .select(CAMPI)
      .gte('data', from)
      .lte('data', to)
      .order('data', { ascending: true })
      .order('id', { ascending: true })
      .range(da, da + PAGINA - 1)
    if (error) return { righe: [], errore: error.message, fonte: 'tabella' }
    const blocco = (data as AccontoBustaPaga[] | null) || []
    righe.push(...blocco)
    if (blocco.length < PAGINA) break
  }
  return { righe, errore: null, fonte: 'tabella' }
}

function chiave(s: string | null | undefined): string {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Somma in euro degli acconti passati. */
export function totaleAcconti(righe: AccontoBustaPaga[] | undefined): number {
  return (righe || []).reduce((s, r) => s + (Number(r.importo_cents) || 0), 0) / 100
}

/**
 * Legge gli acconti del periodo e li abbina agli operatori delle buste paga.
 * `from`/`to` sono date ISO (YYYY-MM-DD) comprese.
 */
export async function caricaAccontiPeriodo(
  operatori: OperatorePerAcconti[],
  from: string,
  to: string
): Promise<AccontiPeriodo> {
  const vuoto: AccontiPeriodo = { perOperatore: new Map(), nonAbbinati: [], errore: null, fonte: 'rpc' }
  if (!operatori.length || !from || !to) return vuoto

  // 1. Righe acconti del periodo.
  const { righe, errore, fonte } = await leggiAcconti(from, to)
  if (errore) return { ...vuoto, errore, fonte }
  if (!righe.length) return { ...vuoto, fonte }

  // 2. Ponte admins.id -> operatori_persone.id. Se la RLS di `admins` blocca la
  //    lettura non si molla tutto: resta l'abbinamento per nome.
  const perAdminId = new Map<string, string>()
  const { data: admins } = await supabase
    .from('admins')
    .select('id, user_id, nome, email')
  const perUserId = new Map<string, string>()
  const perEmail = new Map<string, string>()
  for (const o of operatori) {
    if (o.user_id) perUserId.set(o.user_id, o.id)
    if (o.email) perEmail.set(chiave(o.email), o.id)
  }
  for (const a of ((admins as Array<{ id: string; user_id: string | null; email: string | null }> | null) || [])) {
    const opId = (a.user_id && perUserId.get(a.user_id)) || perEmail.get(chiave(a.email))
    if (opId) perAdminId.set(a.id, opId)
  }

  // 3. Ripiego sul nome (acconti vecchi senza operatore_id). Un nome ambiguo —
  //    due operatori che si chiamano uguale — viene scartato invece di
  //    scalare l'acconto alla persona sbagliata.
  const perNome = new Map<string, string | null>()
  const registraNome = (n: string, opId: string) => {
    const k = chiave(n)
    if (!k) return
    if (perNome.has(k) && perNome.get(k) !== opId) perNome.set(k, null)
    else perNome.set(k, opId)
  }
  for (const o of operatori) {
    registraNome(`${o.nome || ''} ${o.cognome || ''}`, o.id)
    if (o.nome) registraNome(o.nome, o.id)
    if (o.email) registraNome((o.email.split('@')[0] || ''), o.id)
  }

  const perOperatore = new Map<string, AccontoBustaPaga[]>()
  const nonAbbinati: AccontoBustaPaga[] = []
  for (const r of righe) {
    const opId = (r.operatore_id ? perAdminId.get(r.operatore_id) : undefined)
      ?? (r.operatore_nome ? (perNome.get(chiave(r.operatore_nome)) || undefined) : undefined)
    if (!opId) { nonAbbinati.push(r); continue }
    const lista = perOperatore.get(opId)
    if (lista) lista.push(r)
    else perOperatore.set(opId, [r])
  }

  return { perOperatore, nonAbbinati, errore: null, fonte }
}
