import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { authFetch } from '../utils/authFetch'
import MissingFieldsModal from './MissingFieldsModal'

// 17/09/2026 (direzione): pagando col Credit Wallet serve il consenso del
// CLIENTE. "Richiedi autorizzazione" manda un codice all'email della scheda
// cliente (netlify/functions/wallet-autorizzazione-cliente.ts); il cliente lo
// detta all'operatore. Se la scheda non ha un'email si apre "Dati mancanti":
// l'email inserita finisce nella scheda cliente e il codice parte subito dopo.

export interface ClienteWallet {
  /** id della scheda (customers_extended) se la schermata lo conosce */
  customerId?: string | null
  /** account sito del cliente (bookings.user_id) */
  userId?: string | null
  email?: string | null
}

interface Props {
  isOpen: boolean
  /** Scheda cliente. In alternativa `cliente` con account sito o email. */
  customerId?: string | null
  cliente?: ClienteWallet
  customerName?: string
  importo: number
  draftSessionId: string
  onAutorizzato: (overrideId: string, customerId: string) => void
  onCancel: () => void
  /** Chiamata dopo che l'email e' stata salvata nella scheda cliente. */
  onEmailSalvata?: () => void
}

export interface AutorizzazioneWallet {
  overrideId: string
  /** id della scheda cliente risolto dal server */
  customerId: string
  importo: number
}

function euro(n: number): string {
  return `€ ${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function AutorizzazioneWalletClienteModal({
  isOpen,
  customerId: customerIdProp,
  cliente,
  customerName,
  importo,
  draftSessionId,
  onAutorizzato,
  onCancel,
  onEmailSalvata,
}: Props) {
  const [overrideId, setOverrideId] = useState<string | null>(null)
  // Id della scheda: quello passato, oppure quello trovato dal server.
  const [customerId, setCustomerId] = useState<string>(customerIdProp || cliente?.customerId || '')
  const [emailInviata, setEmailInviata] = useState('')
  const [codice, setCodice] = useState('')
  const [invioInCorso, setInvioInCorso] = useState(false)
  const [verificaInCorso, setVerificaInCorso] = useState(false)
  const [errore, setErrore] = useState('')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [schedaPerEmail, setSchedaPerEmail] = useState<any | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setOverrideId(null)
    setEmailInviata('')
    setCodice('')
    setErrore('')
    setSchedaPerEmail(null)
    setCustomerId(customerIdProp || cliente?.customerId || '')
  }, [isOpen, customerIdProp, cliente?.customerId, cliente?.userId, cliente?.email, importo])

  if (!isOpen) return null

  const apriDatiMancanti = async (idScheda: string) => {
    setCustomerId(idScheda)
    let scheda: Record<string, unknown> = { id: idScheda }
    try {
      const resp = await authFetch(`/.netlify/functions/get-customer?id=${idScheda}`)
      if (resp.ok) scheda = (await resp.json()).customer || scheda
    } catch { /* si apre lo stesso con l'id */ }
    setSchedaPerEmail(scheda)
  }

  const inviaCodice = async () => {
    if (invioInCorso) return
    setInvioInCorso(true)
    setErrore('')
    try {
      const res = await authFetch('/.netlify/functions/wallet-autorizzazione-cliente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send',
          customerId: customerId || undefined,
          userId: cliente?.userId || undefined,
          email: cliente?.email || undefined,
          importo,
          draftSessionId,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 422 && data?.emailMancante) {
        toast('Il cliente non ha un\'email: inseriscila per inviare il codice', { duration: 5000 })
        if (!data.customerId) throw new Error('Scheda cliente non trovata')
        await apriDatiMancanti(data.customerId)
        return
      }
      if (!res.ok || !data?.overrideId) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      setOverrideId(data.overrideId)
      if (data.customerId) setCustomerId(data.customerId)
      setEmailInviata(data.email || '')
      setCodice('')
      toast.success(`Codice inviato a ${data.email || 'cliente'}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setErrore(msg)
      toast.error(msg)
    } finally {
      setInvioInCorso(false)
    }
  }

  const verificaCodice = async () => {
    if (!overrideId || codice.length !== 6 || verificaInCorso) return
    setVerificaInCorso(true)
    setErrore('')
    try {
      const res = await authFetch('/.netlify/functions/wallet-autorizzazione-cliente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', overrideId, code: codice }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      toast.success('Autorizzazione del cliente confermata')
      onAutorizzato(overrideId, customerId)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setErrore(msg)
    } finally {
      setVerificaInCorso(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center z-[60] p-0 sm:p-4">
        <div className="w-full sm:max-w-md bg-theme-bg-secondary sm:rounded-lg border border-theme-border overflow-hidden">
          <div className="p-4 border-b border-theme-border">
            <h3 className="text-lg font-bold text-theme-text-primary">Autorizzazione Credit Wallet</h3>
            <p className="text-xs text-theme-text-muted mt-1">
              Il cliente deve autorizzare il prelievo dal suo Credit Wallet con il codice ricevuto via email.
            </p>
          </div>
          <div className="p-4 space-y-3 text-sm">
            <div className="rounded-lg border border-theme-border bg-theme-bg-tertiary p-3 space-y-1">
              {customerName && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-theme-text-secondary">Cliente</span>
                  <span className="font-semibold text-theme-text-primary text-right">{customerName}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-theme-text-secondary">Importo da prelevare</span>
                <span className="font-semibold text-theme-text-primary">{euro(importo)}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={inviaCodice}
              disabled={invioInCorso}
              className="w-full px-4 py-2.5 rounded-full bg-dr7-gold text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {invioInCorso ? 'Invio in corso...' : overrideId ? 'Invia un nuovo codice' : 'Richiedi autorizzazione'}
            </button>

            {overrideId && (
              <div className="space-y-2">
                <p className="text-theme-text-secondary">
                  Codice inviato a <span className="font-semibold text-theme-text-primary">{emailInviata}</span>. Valido 10 minuti.
                </p>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={codice}
                  onChange={(e) => { setCodice(e.target.value.replace(/\D/g, '').slice(0, 6)); setErrore('') }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); verificaCodice() } }}
                  placeholder="000000"
                  autoFocus
                  className="w-full text-center tracking-[0.5em] text-2xl font-bold bg-theme-bg-tertiary border border-theme-border rounded-lg px-4 py-3 text-theme-text-primary outline-none focus:border-dr7-gold"
                />
              </div>
            )}

            {errore && (
              <p className="text-sm font-semibold text-red-600 dark:text-red-400">{errore}</p>
            )}
          </div>
          <div className="p-4 border-t border-theme-border flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-full border border-theme-border text-theme-text-secondary text-sm font-semibold hover:bg-theme-bg-hover transition-colors"
            >
              Annulla
            </button>
            <button
              type="button"
              onClick={verificaCodice}
              disabled={!overrideId || codice.length !== 6 || verificaInCorso}
              className="px-4 py-2 rounded-full bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition-colors disabled:opacity-50"
            >
              {verificaInCorso ? 'Verifica...' : 'Conferma codice'}
            </button>
          </div>
        </div>
      </div>

      {schedaPerEmail && (
        <div className="relative z-[70]">
          <MissingFieldsModal
            isOpen
            customerId={customerId}
            customerData={schedaPerEmail}
            missingFields={['email']}
            contesto="prenotazione"
            onClose={() => setSchedaPerEmail(null)}
            onSave={() => {
              setSchedaPerEmail(null)
              onEmailSalvata?.()
              // L'email ora e' nella scheda: il codice parte subito.
              setTimeout(() => { inviaCodice() }, 50)
            }}
          />
        </div>
      )}
    </>
  )
}
