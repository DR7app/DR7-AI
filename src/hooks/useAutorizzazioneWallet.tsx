import { useCallback, useRef, useState } from 'react'
import { authFetch } from '../utils/authFetch'
import AutorizzazioneWalletClienteModal, { type AutorizzazioneWallet, type ClienteWallet } from '../components/AutorizzazioneWalletClienteModal'
import { isCreditWallet } from '../utils/paymentMethodMatchers'
import { leggiMovimentoWallet } from '../utils/walletCliente'

// 17/09/2026 (direzione): scegliendo "Credit Wallet" come metodo di pagamento,
// in QUALUNQUE schermata, parte subito la richiesta di autorizzazione al
// cliente (codice via email) per il totale della prenotazione, anche se lo
// stato resta "Da saldare". L'autorizzazione si salva nella prenotazione
// (booking_details.wallet_autorizzazione_cliente): quando piu' tardi qualcuno
// segna pagato, se copre l'importo non si richiede di nuovo.
//
// Uso in una schermata:
//   const autWallet = useAutorizzazioneWallet()
//   ... onChange metodo: autWallet.chiediSeWallet(metodo, { cliente, totaleEur, bookingId })
//   ... prima di salvare: const aut = await autWallet.chiediSeWallet(...); if (aut === null) return
//   ... booking_details: { ...autWallet.perBookingDetails(aut) }
//   ... nel JSX: {autWallet.modale}

export type { AutorizzazioneWallet, ClienteWallet }

/** Autorizzazione come salvata in booking_details. */
export interface AutorizzazioneWalletSalvata {
  override_id: string
  customer_id?: string
  importo: number
  autorizzato_il?: string
}

export interface RichiestaWallet {
  cliente: ClienteWallet
  customerName?: string
  /** Totale della prenotazione in euro. */
  totaleEur: number
  /** Prenotazione esistente: quello gia' prelevato non si autorizza due volte. */
  bookingId?: string | null
  /** booking_details della prenotazione esistente, per riusare un'autorizzazione salvata. */
  bookingDetails?: { wallet_autorizzazione_cliente?: AutorizzazioneWalletSalvata | null } | null
}

/**
 * Risultato: `false` = il metodo non e' il wallet o non c'e' nulla da
 * autorizzare; un oggetto = autorizzazione valida; `null` = l'operatore ha
 * annullato (la schermata NON deve salvare).
 */
export type EsitoWallet = AutorizzazioneWallet | false | null

export function perBookingDetails(aut: EsitoWallet | undefined): Record<string, unknown> {
  if (!aut) return {}
  return {
    wallet_autorizzazione_cliente: {
      override_id: aut.overrideId,
      customer_id: aut.customerId,
      importo: aut.importo,
      autorizzato_il: new Date().toISOString(),
    } satisfies AutorizzazioneWalletSalvata,
  }
}

function chiaviCliente(c: ClienteWallet): string[] {
  return [c.customerId || '', c.userId || '', (c.email || '').trim().toLowerCase()].filter(Boolean)
}

export function useAutorizzazioneWallet(opzioni?: { onEmailSalvata?: () => void }) {
  const [aperta, setAperta] = useState<{
    richiesta: RichiestaWallet
    importo: number
    resolve: (v: EsitoWallet) => void
  } | null>(null)
  // Autorizzazioni ottenute in questa sessione, con le chiavi del cliente
  // (id scheda, account sito, email) per ritrovarle da qualunque dato.
  const ottenuteRef = useRef<{ aut: AutorizzazioneWallet; chiavi: string[] }[]>([])
  const sessioneRef = useRef<string>(crypto.randomUUID())
  // Una sola richiesta aperta alla volta: una nuova chiude la precedente come
  // annullata, cosi' nessuna schermata resta appesa a una promessa mai risolta.
  const resolveApertaRef = useRef<((v: EsitoWallet) => void) | null>(null)

  // Un codice gia' ottenuto vale solo se gli resta abbastanza: il database lo
  // scala a ogni prelievo, quindi si chiede al server quanto ne rimane.
  const coperta = async (r: RichiestaWallet, importo: number): Promise<AutorizzazioneWallet | null> => {
    const ids = chiaviCliente(r.cliente)
    const candidati: AutorizzazioneWallet[] = ottenuteRef.current
      .filter(o => o.chiavi.some(k => ids.includes(k)))
      .map(o => o.aut)
    const salvata = r.bookingDetails?.wallet_autorizzazione_cliente
    if (salvata?.override_id
        && (!salvata.customer_id || !r.cliente.customerId || salvata.customer_id === r.cliente.customerId)) {
      candidati.push({ overrideId: salvata.override_id, customerId: salvata.customer_id || '', importo: Number(salvata.importo) || 0 })
    }
    for (const c of candidati) {
      try {
        const res = await authFetch('/.netlify/functions/wallet-autorizzazione-cliente', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'residuo', overrideId: c.overrideId }),
        })
        const d = await res.json().catch(() => ({}))
        if (res.ok && d?.valido && Number(d.residuo) + 0.001 >= importo) {
          return { ...c, customerId: d.customerId || c.customerId }
        }
      } catch { /* si chiede un codice nuovo */ }
    }
    return null
  }

  const chiediSeWallet = useCallback(async (metodo: string | null | undefined, r: RichiestaWallet): Promise<EsitoWallet> => {
    if (!isCreditWallet(metodo)) return false
    if (!r.cliente.customerId && !r.cliente.userId && !r.cliente.email) return false
    const totale = Math.round((r.totaleEur || 0) * 100) / 100
    let gia = 0
    if (r.bookingId) gia = (await leggiMovimentoWallet(r.bookingId)).addebitato || 0
    const importo = Math.round((totale - gia) * 100) / 100
    if (importo <= 0) return false
    const esistente = await coperta(r, importo)
    if (esistente) return esistente
    return new Promise<EsitoWallet>(resolve => {
      resolveApertaRef.current?.(null)
      resolveApertaRef.current = resolve
      setAperta({ richiesta: r, importo, resolve })
    })
  }, [])

  const reset = useCallback(() => {
    ottenuteRef.current = []
    sessioneRef.current = crypto.randomUUID()
  }, [])

  const modale = aperta ? (
    <AutorizzazioneWalletClienteModal
      isOpen
      cliente={aperta.richiesta.cliente}
      customerName={aperta.richiesta.customerName}
      importo={aperta.importo}
      draftSessionId={sessioneRef.current}
      onEmailSalvata={opzioni?.onEmailSalvata}
      onCancel={() => {
        resolveApertaRef.current = null
        aperta.resolve(null)
        setAperta(null)
      }}
      onAutorizzato={(overrideId, customerId) => {
        const aut = { overrideId, customerId, importo: aperta.importo }
        ottenuteRef.current.push({ aut, chiavi: [customerId, ...chiaviCliente(aperta.richiesta.cliente)].filter(Boolean) })
        resolveApertaRef.current = null
        aperta.resolve(aut)
        setAperta(null)
      }}
    />
  ) : null

  return { chiediSeWallet, reset, modale, perBookingDetails, inCorso: !!aperta }
}
