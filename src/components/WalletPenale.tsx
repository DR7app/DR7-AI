import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { authFetch } from '../utils/authFetch'
import { isCreditWallet } from '../utils/paymentMethodMatchers'
import { leggiSaldoWallet, formattaEuro } from '../utils/walletCliente'
import { useAutorizzazioneWallet, type ClienteWallet } from '../hooks/useAutorizzazioneWallet'

// 17/09/2026 (direzione): danni e penali pagati col Credit Wallet.
// Prima la scelta "Credit Wallet" in queste modali era solo un'etichetta: il
// trigger del wallet lavora sul totale della prenotazione, non su
// booking_details.danni / penalties, quindi dal wallet non usciva nulla.
// Ora, come nelle prenotazioni: si vede il credito del cliente, si chiede il
// codice al cliente (email) e l'importo esce davvero dal wallet tramite
// customer-wallet-admin (azione 'debit'), che verifica e consuma il codice.
// Si preleva solo il saldo LIBERO: il credito vincolato vale per i servizi
// indicati nel lotto, non per penali e danni.

export interface AddebitoWalletPenale {
  il: string
  importo: number
  override_id: string
  saldo_dopo: number | null
}

interface Opzioni {
  cliente: ClienteWallet
  customerName?: string
  serviceType?: string
  metodo: string
  statoPagamento: string
  importo: number
}

interface StatoSaldo {
  caricamento: boolean
  /** id da passare a customer-wallet-admin: scheda, altrimenti account */
  idCliente: string | null
  /** true = esiste un account sito, quindi un wallet */
  haWallet: boolean
  saldoLibero: number
}

// La scheda cliente da cui partire: prima per id (scheda o account), poi per email.
async function risolviCliente(c: ClienteWallet): Promise<{ schedaId: string | null; userId: string | null }> {
  for (const id of [c.customerId, c.userId]) {
    if (!id) continue
    const { data } = await supabase.from('customers_extended').select('id, user_id').eq('id', id).maybeSingle()
    if (data) return { schedaId: data.id, userId: data.user_id || null }
  }
  if (c.userId) {
    const { data } = await supabase.from('customers_extended').select('id, user_id').eq('user_id', c.userId).limit(1)
    if (data?.[0]) return { schedaId: data[0].id, userId: data[0].user_id || null }
  }
  const email = (c.email || '').trim()
  if (email) {
    const { data } = await supabase.from('customers_extended').select('id, user_id')
      .ilike('email', email).order('user_id', { ascending: true, nullsFirst: false }).limit(1)
    if (data?.[0]) return { schedaId: data[0].id, userId: data[0].user_id || null }
  }
  // bookings.user_id puo' essere direttamente l'account del sito, senza scheda.
  return { schedaId: null, userId: c.userId || null }
}

async function leggiStato(c: ClienteWallet, serviceType?: string): Promise<StatoSaldo> {
  const { schedaId, userId } = await risolviCliente(c)
  if (schedaId) {
    const s = await leggiSaldoWallet(schedaId, serviceType)
    return { caricamento: false, idCliente: schedaId, haWallet: !!s.userId, saldoLibero: s.userId ? s.saldoLibero : 0 }
  }
  if (userId) {
    const { data } = await supabase.from('user_credit_balance').select('balance').eq('user_id', userId).maybeSingle()
    return { caricamento: false, idCliente: userId, haWallet: !!data, saldoLibero: data ? Number(data.balance) || 0 : 0 }
  }
  return { caricamento: false, idCliente: null, haWallet: false, saldoLibero: 0 }
}

export function useWalletPenale(o: Opzioni) {
  const autWallet = useAutorizzazioneWallet()
  const attivo = isCreditWallet(o.metodo) && o.statoPagamento === 'paid' && o.importo > 0
  const [stato, setStato] = useState<StatoSaldo>({ caricamento: false, idCliente: null, haWallet: false, saldoLibero: 0 })

  useEffect(() => {
    let annullato = false
    if (!attivo) return
    setStato(s => ({ ...s, caricamento: true }))
    leggiStato(o.cliente, o.serviceType).then(r => { if (!annullato) setStato(r) })
    return () => { annullato = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attivo, o.cliente.customerId, o.cliente.userId, o.cliente.email, o.serviceType])

  const identificato = !!(o.cliente.customerId || o.cliente.userId || o.cliente.email)

  /** Richiesta del codice appena si sceglie Credit Wallet (o si passa a Pagato col wallet). */
  const chiedi = (metodo: string, statoPagamento: string) => {
    if (!isCreditWallet(metodo) || statoPagamento !== 'paid' || o.importo <= 0 || !identificato) return
    autWallet.chiediSeWallet(metodo, { cliente: o.cliente, customerName: o.customerName, totaleEur: o.importo })
  }

  /**
   * Prima di salvare: credito, codice del cliente, prelievo. Se torna
   * `errore`, la modale NON deve salvare nulla.
   */
  const verificaEPreleva = async (descrizione: string): Promise<{ addebito: AddebitoWalletPenale | null; errore?: string }> => {
    if (!attivo) return { addebito: null }
    if (!identificato) return { addebito: null, errore: 'Credit Wallet: la prenotazione non ha un cliente collegato.' }
    const fresco = await leggiStato(o.cliente, o.serviceType)
    setStato(fresco)
    if (!fresco.idCliente) return { addebito: null, errore: 'Credit Wallet: scheda cliente non trovata.' }
    if (!fresco.haWallet || fresco.saldoLibero + 0.001 < o.importo) {
      return {
        addebito: null,
        errore: `Credito Wallet insufficiente: il cliente ha ${formattaEuro(fresco.saldoLibero)} e ne servono ${formattaEuro(o.importo)}. Scegli un altro metodo di pagamento.`,
      }
    }
    const aut = await autWallet.chiediSeWallet(o.metodo, { cliente: o.cliente, customerName: o.customerName, totaleEur: o.importo })
    if (aut === null) return { addebito: null, errore: 'Autorizzazione del cliente annullata: nulla e\' stato salvato.' }
    if (!aut) return { addebito: null, errore: 'Credit Wallet: codice del cliente mancante.' }

    const res = await authFetch('/.netlify/functions/customer-wallet-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'debit',
        customer_id: fresco.idCliente,
        amount: o.importo,
        description: descrizione,
        clientOverrideId: aut.overrideId,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data?.success) {
      return { addebito: null, errore: `Prelievo dal Credit Wallet non riuscito: ${data?.error || `HTTP ${res.status}`}` }
    }
    const saldoDopo = typeof data.new_balance_cents === 'number' ? data.new_balance_cents / 100 : null
    setStato(s => ({ ...s, saldoLibero: saldoDopo ?? s.saldoLibero }))
    return {
      addebito: { il: new Date().toISOString(), importo: o.importo, override_id: aut.overrideId, saldo_dopo: saldoDopo },
    }
  }

  const residuo = Math.round((stato.saldoLibero - o.importo) * 100) / 100
  const insufficiente = !stato.haWallet || residuo < 0

  const riquadro = attivo ? (
    stato.caricamento ? (
      <div className="rounded-xl border border-theme-border bg-theme-bg-tertiary p-3 text-[13px] text-theme-text-muted">
        Lettura del Credit Wallet del cliente...
      </div>
    ) : !stato.idCliente ? (
      <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-3 text-[13px] font-semibold text-red-600 dark:text-red-400">
        Cliente non trovato: impossibile usare il Credit Wallet.
      </div>
    ) : (
      <div className={`rounded-xl border p-3 space-y-1 text-[13px] ${insufficiente ? 'border-red-500/40 bg-red-500/5' : 'border-theme-border bg-theme-bg-tertiary'}`}>
        <div className="flex items-center justify-between">
          <span className="text-theme-text-secondary">Credit Wallet del cliente</span>
          <span className="font-semibold text-theme-text-primary">{stato.haWallet ? formattaEuro(stato.saldoLibero) : 'Nessun wallet'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-theme-text-secondary">Verrà prelevato</span>
          <span className="font-semibold text-theme-text-primary">{formattaEuro(o.importo)}</span>
        </div>
        {insufficiente ? (
          <p className="pt-1 font-semibold text-red-600 dark:text-red-400">
            Credito insufficiente: cambia metodo di pagamento.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-theme-text-secondary">Saldo dopo il salvataggio</span>
              <span className="font-semibold text-theme-text-primary">{formattaEuro(residuo)}</span>
            </div>
            <div className="pt-2 flex items-center justify-between gap-2">
              <span className="text-theme-text-muted">Il cliente conferma con il codice ricevuto via email.</span>
              <button
                type="button"
                onClick={() => chiedi(o.metodo, o.statoPagamento)}
                className="px-3 py-1.5 rounded-full bg-dr7-gold text-white text-xs font-semibold hover:opacity-90 transition-opacity"
              >
                Richiedi autorizzazione
              </button>
            </div>
          </>
        )}
      </div>
    )
  ) : null

  return { attivo, riquadro, chiedi, verificaEPreleva, modale: autWallet.modale }
}
