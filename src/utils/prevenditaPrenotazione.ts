import { supabase } from '../supabaseClient'

/**
 * PREVENDITE NELLE PRENOTAZIONI DEL GESTIONALE — 04/11/2026
 *
 * L'utilizzo di una prevendita lo scala SOLO il trigger
 * `trg_prevendita_scala_da_prenotazione` su `bookings`, leggendo
 * `booking_details.prevendita_cliente_id`. Il sito scriveva quel campo, il
 * gestionale no: una prenotazione fatta allo sportello per un cliente con una
 * prevendita non scalava niente (caso Runchina, "Macan gts Runchina" ancora a
 * 2 utilizzi).
 *
 * Qui stanno le stesse regole del sito (~/Sito/utils/prevendite.ts e
 * CarBookingWizard): quali pacchetti valgono, come si confrontano veicolo e
 * assicurazione, e cosa vale zero nel prezzo. I vincoli veri li decide il
 * database (`prevendita_verifica`): il browser serve solo a mostrare subito
 * la risposta.
 */

export interface VeicoloPrevendita {
  id: string
  nome: string
  targa?: string | null
}

export interface PrevenditaCliente {
  id: string
  user_id: string | null
  customer_email: string | null
  nome: string
  utilizzi_iniziali: number
  utilizzi_usati: number
  veicoli: VeicoloPrevendita[]
  km_inclusi: number
  assicurazione_inclusa: string | null
  max_utilizzi_mese: number | null
  max_giorni_consecutivi: number | null
  data_scadenza: string | null
  stato: string
  payment_status: string
}

export interface EsitoVerificaPrevendita {
  ok: boolean
  errore?: string
  utilizzi_residui?: number
}

const PAGATO = ['paid', 'completed', 'succeeded']

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizzaPacchetto(r: any): PrevenditaCliente {
  let veicoli: VeicoloPrevendita[] = []
  if (Array.isArray(r?.veicoli)) veicoli = r.veicoli
  else if (typeof r?.veicoli === 'string') {
    try { const v = JSON.parse(r.veicoli); if (Array.isArray(v)) veicoli = v } catch { /* resta vuoto */ }
  }
  return {
    id: String(r.id),
    user_id: r.user_id ?? null,
    customer_email: r.customer_email ?? null,
    nome: String(r.nome || 'Prevendita'),
    utilizzi_iniziali: Number(r.utilizzi_iniziali) || 0,
    utilizzi_usati: Number(r.utilizzi_usati) || 0,
    veicoli,
    km_inclusi: Number(r.km_inclusi) || 0,
    assicurazione_inclusa: r.assicurazione_inclusa || null,
    max_utilizzi_mese: r.max_utilizzi_mese ?? null,
    max_giorni_consecutivi: r.max_giorni_consecutivi ?? null,
    data_scadenza: r.data_scadenza ?? null,
    stato: String(r.stato || ''),
    payment_status: String(r.payment_status || ''),
  }
}

/** Stessa formula di prevendita_stato_reale() nel database. */
export function statoPrevendita(pc: PrevenditaCliente, adesso: Date = new Date()): 'attiva' | 'terminata' | 'scaduta' | 'bloccata' {
  if (pc.stato === 'bloccata') return 'bloccata'
  if (!PAGATO.includes(String(pc.payment_status).toLowerCase())) return 'bloccata'
  if (pc.data_scadenza && new Date(pc.data_scadenza) < adesso) return 'scaduta'
  if (pc.utilizzi_usati >= pc.utilizzi_iniziali) return 'terminata'
  return 'attiva'
}

export function utilizziResidui(pc: PrevenditaCliente): number {
  return Math.max(0, pc.utilizzi_iniziali - pc.utilizzi_usati)
}

/** Stessa normalizzazione del database: regexp_replace('[^a-zA-Z0-9]+', ' ') + lower. */
function normalizzaNomeVeicolo(v: string | null | undefined): string {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** La prevendita vale per questo veicolo? Per vehicles.id OPPURE per nome, come il database. */
export function valePerVeicolo(pc: PrevenditaCliente, vehicleId: string | null | undefined, vehicleName: string | null | undefined): boolean {
  const veicoli = Array.isArray(pc.veicoli) ? pc.veicoli : []
  if (veicoli.length === 0) return false
  if (vehicleId && veicoli.some(v => v?.id && String(v.id) === String(vehicleId))) return true
  const nome = normalizzaNomeVeicolo(vehicleName)
  if (!nome) return false
  return veicoli.some(v => normalizzaNomeVeicolo(v?.nome) === nome)
}

/** Pagate, attive, non scadute, con utilizzi residui e valide per questo veicolo. */
export function prevenditeSpendibili(pacchetti: PrevenditaCliente[], vehicleId: string | null | undefined, vehicleName: string | null | undefined): PrevenditaCliente[] {
  return pacchetti.filter(pc =>
    statoPrevendita(pc) === 'attiva' && utilizziResidui(pc) > 0 && valePerVeicolo(pc, vehicleId, vehicleName),
  )
}

/**
 * La prevendita salva il NOME dell'assicurazione compresa. Stesso confronto
 * del sito: "RCA Compresa (no Kasko)" e "RCA" sono la stessa cosa.
 */
function nomeAssicurazioneNormalizzato(n: string | null | undefined): string {
  return String(n ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/kasko|compresa|inclusa/g, ' ')
    .replace(/[^a-z0-9]/g, '')
}
export function stessaAssicurazione(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = nomeAssicurazioneNormalizzato(a)
  const y = nomeAssicurazioneNormalizzato(b)
  return x !== '' && x === y
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, c => `\\${c}`)
}

/**
 * Le prevendite di un cliente. Si cerca per id (user_id del pacchetto contro
 * id e user_id della scheda) e per email ESATTA (maiuscole a parte). Mai per
 * nome. L'ilike serve solo a non perdere le email scritte con maiuscole
 * diverse: il risultato viene poi filtrato per uguaglianza esatta.
 */
export async function caricaPrevenditeCliente(cliente: { ids: Array<string | null | undefined>; email?: string | null }): Promise<PrevenditaCliente[]> {
  const ids = [...new Set(cliente.ids.filter((x): x is string => !!x && /^[0-9a-f-]{36}$/i.test(x)))]
  const email = String(cliente.email || '').trim().toLowerCase()
  const richieste = []
  if (ids.length > 0) {
    richieste.push(supabase.from('prevendite_clienti').select('*').in('user_id', ids))
  }
  if (email) {
    richieste.push(supabase.from('prevendite_clienti').select('*').ilike('customer_email', escapeLike(email)))
  }
  if (richieste.length === 0) return []
  const risposte = await Promise.all(richieste)
  const perId = new Map<string, PrevenditaCliente>()
  for (const r of risposte) {
    if (r.error) {
      console.error('[prevendite] pacchetti del cliente non caricati:', r.error.message)
      continue
    }
    for (const riga of r.data || []) {
      const pc = normalizzaPacchetto(riga)
      const perUtente = !!pc.user_id && ids.includes(pc.user_id)
      const perEmail = !!email && String(pc.customer_email || '').trim().toLowerCase() === email
      if (perUtente || perEmail) perId.set(pc.id, pc)
    }
  }
  return [...perId.values()]
}

export async function caricaPrevendita(id: string): Promise<PrevenditaCliente | null> {
  const { data, error } = await supabase.from('prevendite_clienti').select('*').eq('id', id).maybeSingle()
  if (error || !data) return null
  return normalizzaPacchetto(data)
}

/** La prenotazione ha gia' scalato un utilizzo (movimento 'scalo' non annullato)? */
export async function prenotazioneGiaScalata(bookingId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('prevendite_movimenti')
    .select('id')
    .eq('booking_id', bookingId)
    .eq('tipo', 'scalo')
    .eq('annullato', false)
    .limit(1)
  if (error) return false
  return (data || []).length > 0
}

/** Il verdetto del database. Date in giorni (YYYY-MM-DD), come il trigger. */
export async function verificaPrevendita(params: {
  prevenditaClienteId: string
  dataInizio: string
  dataFine: string
  vehicleId?: string | null
  veicoloNome?: string | null
}): Promise<EsitoVerificaPrevendita> {
  const { data, error } = await supabase.rpc('prevendita_verifica', {
    p_prevendita_cliente_id: params.prevenditaClienteId,
    p_data_inizio: params.dataInizio,
    p_data_fine: params.dataFine,
    p_vehicle_id: params.vehicleId || null,
    p_veicolo_nome: params.veicoloNome || null,
  })
  if (error) {
    console.error('[prevendite] verifica non riuscita:', error.message)
    return { ok: false, errore: `Controllo della prevendita non riuscito: ${error.message}` }
  }
  return (data || { ok: false, errore: 'Risposta vuota dal controllo prevendita' }) as EsitoVerificaPrevendita
}

/** Le voci del prezzo che la prevendita puo' coprire, a listino. */
export interface VociPrezzoPrevendita {
  noleggio: number
  lavaggio: number
  assicurazione: number
  /** Prezzo giornaliero dell'assicurazione compresa nel pacchetto (0 se non c'e'). */
  assicurazioneInclusaGiorno: number
  giorni: number
  kmIllimitati: number
  pacchettiKm: number
}

export interface EsitoPrezzoPrevendita extends VociPrezzoPrevendita {
  copertura: number
  /** Con una prevendita il min/max giornaliero di Centralina Pro non si applica. */
  saltaClamp: boolean
}

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * Cio' che il cliente ha gia' pagato col pacchetto vale zero. Copia di
 * CarBookingWizard (sito), blocco "PREVENDITA":
 *  - noleggio a zero;
 *  - lavaggio (pulizia finale) a zero;
 *  - assicurazione: si copre al massimo il prezzo di QUELLA compresa nel
 *    pacchetto x giorni (se se ne sceglie una piu' cara si paga la differenza);
 *  - km: pacchetto con km illimitati (>= 9999) = km illimitati e pacchetti km
 *    scelti adesso a zero; altrimenti i km si pagano normalmente;
 *  - tutto il resto (secondo guidatore, consegna, experience, cauzione...)
 *    si paga normalmente;
 *  - clamp min/max di Centralina Pro disattivato.
 */
export function applicaPrevenditaAlPrezzo(pc: PrevenditaCliente | null, voci: VociPrezzoPrevendita): EsitoPrezzoPrevendita {
  if (!pc) return { ...voci, copertura: 0, saltaClamp: false }
  let copertura = 0
  const out = { ...voci }
  copertura += out.noleggio
  out.noleggio = 0
  copertura += out.lavaggio
  out.lavaggio = 0
  if (pc.assicurazione_inclusa) {
    const coperta = Math.min(out.assicurazione, r2((voci.assicurazioneInclusaGiorno || 0) * Math.max(1, voci.giorni || 1)))
    copertura += coperta
    out.assicurazione = r2(out.assicurazione - coperta)
  }
  if ((Number(pc.km_inclusi) || 0) >= 9999) {
    copertura += out.kmIllimitati + out.pacchettiKm
    out.kmIllimitati = 0
    out.pacchettiKm = 0
  }
  return { ...out, copertura: r2(copertura), saltaClamp: true }
}

/**
 * Km del contratto con una prevendita: quelli del pacchetto piu' i pacchetti
 * km comprati adesso. null = la prevendita non cambia i km (0 km nel pacchetto),
 * 'illimitati' = pacchetto con km illimitati.
 */
export function kmConPrevendita(pc: PrevenditaCliente | null, kmDaPacchetti: number): number | 'illimitati' | null {
  if (!pc) return null
  const km = Number(pc.km_inclusi) || 0
  if (km >= 9999) return 'illimitati'
  if (km > 0) return km + (Number(kmDaPacchetti) || 0)
  return null
}
