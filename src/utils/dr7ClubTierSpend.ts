/**
 * Spesa annua DR7 Club — regola UNICA lato gestionale (solo VISUALIZZAZIONE).
 *
 * 01/09/2026 — La scheda cliente mostrava una spesa CONGELATA mentre sul sito
 * la stessa persona vedeva la cifra vera che sale (caso Runchina: gestionale
 * fermo a €3.155,20, sito in progressione). La fiche calcolava a modo suo e
 * divergeva su tre punti:
 *
 *   1. l'override "grandfathered" era una SOSTITUZIONE secca del valore
 *      calcolato -> la barra restava inchiodata per sempre. Sul sito e nel
 *      motore del cashback lo stesso override e' un PAVIMENTO (`Math.max`):
 *      il cliente non scende mai sotto la cifra congelata, ma quando la spesa
 *      reale la supera il numero AVANZA.
 *   2. contava solo i pagamenti a carta (whitelist nexi|card|stripe|pos):
 *      bonifici e contanti — denaro nuovo a tutti gli effetti — sparivano.
 *   3. sommava anche le ricariche registrate DUE VOLTE, gonfiando il totale
 *      rispetto a quello che il cliente vede.
 *
 * Questo file NON tocca il wallet ne' il cashback versato: calcola solo il
 * numero mostrato. La regola e' quella canonica, identica a
 * `netlify/functions/utils/dr7ClubCashback.ts` (che versa il cashback) e a
 * `Sito/utils/dr7club.ts::getAnnualSpend` (quello che il cliente legge nel suo
 * account). Le tre copie DEVONO restare allineate: se cambia una, cambiano
 * tutte — la divergenza frontend/backend e' gia' costata un cashback versato
 * al 4% a chi vedeva 3%.
 *
 * Vedi memoria: tier_annual_spend_rule, wallet_credito_bonus_classification.
 */

/** Stati prenotazione che contano come spesa. */
export const BOOKING_COUNTED_STATUSES = ['completed', 'completata', 'confirmed', 'active']

/** payment_status che valgono "incassato". */
export const PAID_STATUSES = ['paid', 'completed', 'succeeded']

/**
 * Ricariche registrate DUE VOLTE in `credit_wallet_purchases` (pagate una sola
 * volta dal cliente). Riserva statica per i database dove la colonna
 * `excluded_from_tier` (migrazione 20260808000000) non c'e' ancora.
 */
export const DUPLICATE_PURCHASE_IDS = new Set<string>([
  '39a4c9cd-5670-465c-977d-cce805514c38', // Runchina 26/02 €1.000 — doppione
  '4e6364d9-8707-4f12-897d-e02d63e0682d', // Runchina 05/05 €2.000 — doppione
])

/**
 * Spesa "congelata" pre-fix per i clienti grandfathered. E' un PAVIMENTO, mai
 * una sostituzione. Mirror di `Sito/utils/dr7club.ts::TIER_SPEND_OVERRIDES` e
 * di `netlify/functions/utils/dr7ClubCashback.ts`.
 */
export const TIER_SPEND_OVERRIDES: Record<string, number> = {
  '3b896d05-3d65-4819-a46a-ea9894343935': 3155.20, // Massimo Runchina
}

/** true se il metodo di pagamento e' wallet/gift card (credito riciclato). */
export function isWalletOrGiftMethod(pm: unknown): boolean {
  const m = String(pm || '').toLowerCase().trim()
  if (!m) return false
  return m === 'credit' || m === 'credito' || m.includes('wallet') || m.includes('gift')
}

export interface TierSpendBooking {
  price_total?: number | null
  payment_method?: string | null
  payment_status?: string | null
  status?: string | null
  created_at?: string | null
}

export interface TierSpendRecharge {
  id?: string | null
  recharge_amount?: number | string | null
  /** Fallback storico: alcune righe vecchie hanno solo `amount`. */
  amount?: number | string | null
  payment_status?: string | null
  created_at?: string | null
  excluded_from_tier?: boolean | null
}

export interface TierSpend {
  /** Cifra da mostrare: il calcolato, mai sotto l'eventuale pavimento. */
  annualSpend: number
  /** Prenotazioni pagate con denaro nuovo (carta, bonifico, contanti...). */
  bookingSpend: number
  /** Ricariche wallet valide (doppioni esclusi). */
  rechargeSpend: number
  rechargeCount: number
  /** Spesa reale calcolata, senza pavimento. */
  computed: number
  /** true quando il pavimento grandfathered sta ancora reggendo la cifra. */
  floorApplied: boolean
}

const toNumber = (raw: unknown): number => {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? 0))
  return Number.isFinite(n) ? n : 0
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * Spesa annua degli ultimi 12 mesi.
 *
 * `bookings` e `recharges` sono le righe gia' caricate dalla scheda: il filtro
 * (stato, pagamento, data) e' rifatto qui, cosi' la cifra non dipende da come
 * ha interrogato il database chi chiama.
 */
export function computeAnnualSpend(
  bookings: TierSpendBooking[] | null | undefined,
  recharges: TierSpendRecharge[] | null | undefined,
  userId?: string | null,
  now: Date = new Date()
): TierSpend {
  const cutoff = new Date(now)
  cutoff.setFullYear(cutoff.getFullYear() - 1)

  const entroUnAnno = (when: string | null | undefined): boolean => {
    if (!when) return false
    const d = new Date(when)
    return !Number.isNaN(d.getTime()) && d >= cutoff
  }

  // 1. Prenotazioni: conta OGNI metodo che porta denaro nuovo (carta, Nexi,
  //    bonifico, contanti) ed esclude solo wallet/gift card. La data e'
  //    `created_at`: `booked_at` e' nullo su troppe righe.
  let bookingCents = 0
  for (const b of bookings || []) {
    if (!PAID_STATUSES.includes(String(b.payment_status || ''))) continue
    if (!BOOKING_COUNTED_STATUSES.includes(String(b.status || ''))) continue
    if (isWalletOrGiftMethod(b.payment_method)) continue
    if (!entroUnAnno(b.created_at)) continue
    bookingCents += toNumber(b.price_total) // in CENTESIMI
  }
  const bookingSpend = round2(bookingCents / 100)

  // 2. Ricariche wallet pagate: `recharge_amount` e' quanto ha pagato il
  //    cliente (`received_amount` includerebbe il bonus pacchetto, che e' un
  //    regalo, non spesa). I doppioni non contano.
  let rechargeSpend = 0
  let rechargeCount = 0
  for (const r of recharges || []) {
    if (String(r.payment_status || '') !== 'succeeded') continue
    if (!entroUnAnno(r.created_at)) continue
    if (r.excluded_from_tier === true) continue
    if (r.id && DUPLICATE_PURCHASE_IDS.has(String(r.id))) continue
    const amount = toNumber(r.recharge_amount ?? r.amount)
    if (amount <= 0) continue
    rechargeSpend += amount
    rechargeCount += 1
  }
  rechargeSpend = round2(rechargeSpend)

  const computed = round2(bookingSpend + rechargeSpend)
  const override = userId ? TIER_SPEND_OVERRIDES[userId] : undefined
  const floorApplied = typeof override === 'number' && override > computed
  const annualSpend = floorApplied ? (override as number) : computed

  return { annualSpend, bookingSpend, rechargeSpend, rechargeCount, computed, floorApplied }
}
