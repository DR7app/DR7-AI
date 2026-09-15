/**
 * Credit Wallet del cliente, letto dal gestionale.
 *
 * Il saldo vive in `user_credit_balance`, una riga per ACCOUNT DEL SITO
 * (`auth.users.id`). La scheda cliente del gestionale (`customers_extended`)
 * e' un'altra tabella: le due si toccano solo tramite `customers_extended.
 * user_id`, che e' NULL per tutti i clienti registrati allo sportello e mai
 * iscritti al sito. Quei clienti un wallet non ce l'hanno: non e' un errore,
 * e' che non esiste un saldo da cui prelevare.
 *
 * L'addebito vero e proprio NON si fa da qui: lo fa il database quando la
 * prenotazione viene salvata (trigger `trg_dr7_wallet_sync_prenotazione`,
 * migrazione 20260915000000). Queste funzioni servono alla schermata per
 * mostrare il saldo prima del salvataggio e per rileggerlo dopo.
 */

import { supabase } from '../supabaseClient'
import { isCreditWallet } from './paymentMethodMatchers'

export interface SaldoWallet {
  /** Account sito del cliente. NULL = nessun wallet collegato. */
  userId: string | null
  /** Saldo in euro. NULL quando non c'e' un account a cui guardare. */
  saldo: number | null
}

const VUOTO: SaldoWallet = { userId: null, saldo: null }

/**
 * Saldo del wallet a partire dalla scheda cliente del gestionale.
 * Non solleva mai: una lettura fallita vale "non lo so", e la schermata
 * continua a funzionare (nessun blocco, mai — direzione).
 */
export async function leggiSaldoWallet(customerId: string | null | undefined): Promise<SaldoWallet> {
  if (!customerId) return VUOTO
  try {
    const { data: cliente } = await supabase
      .from('customers_extended')
      .select('user_id')
      .eq('id', customerId)
      .maybeSingle()

    const userId = (cliente as { user_id?: string | null } | null)?.user_id || null
    if (!userId) return VUOTO

    const { data: riga } = await supabase
      .from('user_credit_balance')
      .select('balance')
      .eq('user_id', userId)
      .maybeSingle()

    const saldo = riga ? Number((riga as { balance: number | string }).balance) || 0 : 0
    return { userId, saldo }
  } catch {
    return VUOTO
  }
}

/**
 * Euro che usciranno dal wallet salvando la prenotazione con questi dati.
 * Stessa regola della funzione SQL `dr7_wallet_importo_dovuto`: pagata -> il
 * totale, parziale -> l'acconto incassato, tutto il resto -> zero.
 *
 * Gli importi arrivano dal form in EURO (stringhe), non in centesimi.
 */
export function importoDovutoWallet(opts: {
  metodo: string | null | undefined
  statoPagamento: string | null | undefined
  totaleEur: number
  acconoEur: number
}): number {
  if (!isCreditWallet(opts.metodo)) return 0
  const stato = (opts.statoPagamento || '').toLowerCase().trim()
  if (['paid', 'succeeded', 'completed', 'pagato'].includes(stato)) {
    return Math.round((opts.totaleEur || 0) * 100) / 100
  }
  if (['partial', 'parziale'].includes(stato)) {
    return Math.round((opts.acconoEur || 0) * 100) / 100
  }
  return 0
}

/** "€ 1.234,50" — come ovunque nel gestionale. */
export function formattaEuro(n: number): string {
  return `€ ${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export interface MovimentoWalletPrenotazione {
  /** Euro effettivamente usciti dal wallet per questa prenotazione (netto degli storni). */
  addebitato: number
  /** Saldo del wallet dopo il movimento. NULL se non c'e' un wallet collegato. */
  saldo: number | null
  userId: string | null
}

/**
 * Cosa ha fatto davvero il database al wallet per questa prenotazione.
 *
 * Si legge DOPO il salvataggio, per dire all'operatore quanto e' uscito e cosa
 * resta. La verita' e' il registro `credit_transactions`, non quello che la
 * schermata si aspettava: se il trigger ha deciso diversamente (importo gia'
 * addebitato dal sito, differenza rispetto a un salvataggio precedente), qui
 * si vede il movimento reale.
 */
export async function leggiMovimentoWallet(bookingId: string): Promise<MovimentoWalletPrenotazione> {
  const vuoto: MovimentoWalletPrenotazione = { addebitato: 0, saldo: null, userId: null }
  if (!bookingId) return vuoto
  try {
    const { data: righe } = await supabase
      .from('credit_transactions')
      .select('user_id, transaction_type, amount, reference_type, balance_after, created_at')
      .eq('reference_id', bookingId)
      .order('created_at', { ascending: true })

    const movimenti = (righe || []) as Array<{
      user_id: string
      transaction_type: string
      amount: number | string
      reference_type: string | null
      balance_after: number | string
    }>
    if (movimenti.length === 0) return vuoto

    // Stessa somma della funzione SQL: gli addebiti contano, fra gli accrediti
    // contano solo gli storni emessi dal trigger (un cashback collegato alla
    // stessa prenotazione non e' un rimborso del noleggio).
    const addebitato = movimenti.reduce((tot, m) => {
      const importo = Number(m.amount) || 0
      if (m.transaction_type === 'debit') return tot + importo
      if (m.reference_type === 'booking_refund') return tot - importo
      return tot
    }, 0)

    const ultimo = movimenti[movimenti.length - 1]
    return {
      addebitato: Math.round(addebitato * 100) / 100,
      saldo: Number(ultimo.balance_after) || 0,
      userId: ultimo.user_id || null,
    }
  } catch {
    return vuoto
  }
}
