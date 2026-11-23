/**
 * Auto di cortesia durante il lavaggio — quali auto, da che ora, per quante ore.
 *
 * Richiesta direzione 23/11/2026 (video di Valerio): dopo data e ora del
 * lavaggio non si scelgono piu' le categorie (Utilitaria / Supercar / Exotic /
 * Hypercar) ma le AUTO VERE. Per ogni auto si mostra da che ora e' libera e per
 * quante ore (1h..7h); le ore che non ci stanno sono barrate. Il noleggio parte
 * quando l'auto e' libera: all'ora del lavaggio, o piu' tardi se e' ancora
 * fuori.
 *
 * Nessun import, nessuna I/O: lo stesso file vive nel gestionale
 * (DR7-staging/src/utils) e nel sito (Sito/utils). Si passano i dati gia'
 * letti. Tutti gli istanti sono millisecondi assoluti (Date.getTime()).
 *
 * ── Regole ───────────────────────────────────────────────────────────────
 * - Quale scheda (prezzi 1h..7h) vale per un'auto: conta l'ETICHETTA della
 *   categoria in Centralina Pro, mai l'id (stessa regola del sito,
 *   esperienzaFlotta.ts). Auto di categorie senza scheda = non proposte.
 * - Prima i nomi venivano cercati con /prime courtesy|supercar experience/:
 *   rinominate le schede in "DR7 Utilitaria di cortesia", "DR7 Supercar"...
 *   nessuna auto veniva piu' bloccata e arrivavano le doppie prenotazioni.
 * - Libera da: l'ora del lavaggio, spostata alla fine (+ buffer) di ogni
 *   prenotazione che la copre. Il buffer si aggiunge solo DOPO una
 *   prenotazione, mai prima (availability_system_rules).
 * - Ore massime: fino alla prossima prenotazione dell'auto o all'ultimo
 *   orario di riconsegna del giorno (Centralina > Orari Noleggio), al massimo
 *   ORE_MASSIME.
 */

export const ORE_MASSIME = 7

export interface CategoriaFlotta {
  id: string
  label: string
}

export interface SchedaEsperienza {
  id: string
  name?: string | null
  name_en?: string | null
  nameEn?: string | null
}

/** Parole che non distinguono una categoria dall'altra. */
const PAROLE_NEUTRE = new Set([
  'dr7', 'car', 'auto', 'di', 'da', 'del', 'della', 'the', 'drive',
  'courtesy', 'cortesia', 'experience', 'esperienza',
])

/** Stessa parola in italiano e in inglese. */
const SINONIMI: Record<string, string> = {
  utilitaria: 'urban',
  utilitarie: 'urban',
  cittadina: 'urban',
}

function parole(testo: string | null | undefined): string[] {
  if (!testo) return []
  return testo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(p => (p.length > 3 && p.endsWith('s') ? p.slice(0, -1) : p))
    .map(p => SINONIMI[p] || p)
    .filter(p => !PAROLE_NEUTRE.has(p))
}

/**
 * La categoria della flotta che corrisponde alla scheda, o null se
 * l'abbinamento non e' certo (nessuna o due a pari merito).
 */
export function categoriaPerEsperienza(
  scheda: SchedaEsperienza | null | undefined,
  categorie: CategoriaFlotta[],
): CategoriaFlotta | null {
  if (!scheda) return null
  const nome = new Set([...parole(scheda.name), ...parole(scheda.name_en ?? scheda.nameEn)])
  if (nome.size === 0) return null
  let migliore: CategoriaFlotta | null = null
  let punteggio = 0
  let pari = false
  for (const c of categorie) {
    const p = [...new Set(parole(c.label))]
    if (p.length === 0 || !p.every(w => nome.has(w))) continue
    if (p.length > punteggio) {
      migliore = c
      punteggio = p.length
      pari = false
    } else if (p.length === punteggio) {
      pari = true
    }
  }
  return pari ? null : migliore
}

/** Id equivalenti della stessa categoria (Pro "supercars" = DB "exotic"). */
export function idsCategoria(id: string): string[] {
  const k = (id || '').toLowerCase()
  if (k === 'supercars' || k === 'exotic') return ['supercars', 'exotic']
  return [id]
}

export interface VeicoloCortesia {
  id: string
  display_name: string | null
  plate?: string | null
  category: string | null
  status: string | null
  metadata?: Record<string, unknown> | null
}

/**
 * Il veicolo puo' essere dato al cliente? Stessa regola del sito:
 * 'available', oppure 'unavailable' con `metadata.unavailable_until` passato.
 */
export function veicoloUtilizzabile(v: VeicoloCortesia, adesso: Date = new Date()): boolean {
  if (v.status === 'available') return true
  if (v.status !== 'unavailable') return false
  const until = v.metadata?.unavailable_until
  if (typeof until !== 'string' || !until) return false
  const d = new Date(until)
  return !isNaN(d.getTime()) && d < adesso
}

/** Prenotazione minima per capire quando un'auto e' occupata. */
export interface PrenotazioneFlotta {
  id?: string
  vehicle_id?: string | null
  vehicle_plate?: string | null
  service_type?: string | null
  status?: string | null
  pickup_date?: string | null
  dropoff_date?: string | null
}

const STATI_CHIUSI = new Set(['cancelled', 'annullata', 'completed', 'completata', 'expired', 'rejected'])

function targa(t: string | null | undefined): string {
  return (t || '').replace(/[^a-z0-9]/gi, '').toUpperCase()
}

export interface Intervallo { inizio: number; fine: number }

/**
 * Periodi in cui l'auto e' fuori. I lavaggi non contano: su un lavaggio
 * `vehicle_plate` e' la targa del CLIENTE, non un'auto della flotta.
 */
export function intervalliOccupati(
  veicolo: VeicoloCortesia,
  prenotazioni: PrenotazioneFlotta[],
  escludiIds: string[] = [],
): Intervallo[] {
  const t = targa(veicolo.plate)
  const out: Intervallo[] = []
  for (const b of prenotazioni) {
    if (b.id && escludiIds.includes(b.id)) continue
    if (b.service_type === 'car_wash') continue
    if (STATI_CHIUSI.has(String(b.status || '').toLowerCase())) continue
    const stessa = (b.vehicle_id && b.vehicle_id === veicolo.id) || (!!t && targa(b.vehicle_plate) === t)
    if (!stessa) continue
    const inizio = b.pickup_date ? new Date(b.pickup_date).getTime() : NaN
    const fine = b.dropoff_date ? new Date(b.dropoff_date).getTime() : NaN
    if (isNaN(inizio) || isNaN(fine) || fine <= inizio) continue
    out.push({ inizio, fine })
  }
  return out.sort((a, b) => a.inizio - b.inizio)
}

export interface Disponibilita {
  /** Istante da cui l'auto e' libera, null = non disponibile oggi. */
  liberaDa: number | null
  /** Ore prenotabili da `liberaDa` (0 = nessuna). */
  oreMax: number
}

const ORA = 60 * 60 * 1000
const QUARTO = 15 * 60 * 1000

/**
 * Da che ora e per quante ore l'auto e' libera a partire dall'ora del
 * lavaggio, entro `chiusura` (ultima riconsegna del giorno).
 */
export function disponibilitaCortesia(opts: {
  inizioLavaggio: number
  chiusura: number
  occupati: Intervallo[]
  bufferMin: number
  oreMassime?: number
}): Disponibilita {
  const { inizioLavaggio, chiusura, occupati } = opts
  const buffer = Math.max(0, opts.bufferMin) * 60 * 1000
  const oreMassime = opts.oreMassime ?? ORE_MASSIME
  let t = inizioLavaggio
  // Sposta t oltre ogni prenotazione (+ buffer) che lo copre. Le prenotazioni
  // possono accavallarsi: si ripete finche' t non cade in un buco.
  for (let giro = 0; giro < 50; giro++) {
    const copre = occupati.find(i => i.inizio <= t && t < i.fine + buffer)
    if (!copre) break
    t = copre.fine + buffer
  }
  // Se l'auto si libera dopo l'ora del lavaggio, si parte dal quarto d'ora
  // successivo (gli orari del noleggio vanno a quarti d'ora).
  if (t > inizioLavaggio) t = Math.ceil(t / QUARTO) * QUARTO
  if (t >= chiusura) return { liberaDa: null, oreMax: 0 }
  const prossima = occupati.filter(i => i.inizio >= t).reduce((m, i) => Math.min(m, i.inizio), Infinity)
  const limite = Math.min(prossima, chiusura)
  const ore = Math.min(oreMassime, Math.floor((limite - t) / ORA))
  if (ore < 1) return { liberaDa: null, oreMax: 0 }
  return { liberaDa: t, oreMax: ore }
}

/** "3h", "3 h", "3 ore" -> 3; null se l'etichetta non e' in ore. */
export function oreDaEtichetta(label: string): number | null {
  const m = (label || '').toLowerCase().match(/(\d+)\s*(h|ora|ore)\b/)
  return m ? parseInt(m[1], 10) : null
}

export interface AutoProposta {
  veicolo: VeicoloCortesia
  scheda: SchedaEsperienza & { price_options?: { label: string; price: number }[] | null }
  categoria: CategoriaFlotta
  disponibilita: Disponibilita
}

/**
 * Elenco delle auto proposte: solo veicoli utilizzabili di categorie che
 * hanno una scheda esperienza. Prima le disponibili (prima libere, poi per
 * nome), in fondo quelle non disponibili oggi.
 */
export function autoProposte<S extends SchedaEsperienza & { price_options?: { label: string; price: number }[] | null }>(opts: {
  schede: S[]
  categorie: CategoriaFlotta[]
  veicoli: VeicoloCortesia[]
  prenotazioni: PrenotazioneFlotta[]
  inizioLavaggio: number
  chiusura: number
  bufferMin: number
  escludiPrenotazioni?: string[]
  adesso?: Date
}): (AutoProposta & { scheda: S })[] {
  const perCategoria = new Map<string, { scheda: S; categoria: CategoriaFlotta }>()
  for (const s of opts.schede) {
    const c = categoriaPerEsperienza(s, opts.categorie)
    if (!c) continue
    for (const id of idsCategoria(c.id)) if (!perCategoria.has(id)) perCategoria.set(id, { scheda: s, categoria: c })
  }
  const out: (AutoProposta & { scheda: S })[] = []
  for (const v of opts.veicoli) {
    const abb = perCategoria.get(String(v.category || ''))
    if (!abb) continue
    if (!veicoloUtilizzabile(v, opts.adesso)) continue
    const disponibilita = disponibilitaCortesia({
      inizioLavaggio: opts.inizioLavaggio,
      chiusura: opts.chiusura,
      occupati: intervalliOccupati(v, opts.prenotazioni, opts.escludiPrenotazioni),
      bufferMin: opts.bufferMin,
    })
    out.push({ veicolo: v, scheda: abb.scheda, categoria: abb.categoria, disponibilita })
  }
  return out.sort((a, b) => {
    const la = a.disponibilita.liberaDa ?? Infinity
    const lb = b.disponibilita.liberaDa ?? Infinity
    if (la !== lb) return la - lb
    return String(a.veicolo.display_name || '').localeCompare(String(b.veicolo.display_name || ''))
  })
}
