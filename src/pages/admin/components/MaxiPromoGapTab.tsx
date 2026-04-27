import { useState } from 'react'
import toast from 'react-hot-toast'
import { authFetch } from '../../../utils/authFetch'

/**
 * Maxi Promo Gap — pannello di test.
 *
 * Cosa fa: contatta /.netlify/functions/maxi-promo-gap-test che (1) rileva
 * i veicoli con un buco di 1 giorno DOMANI nel calendario (domani libero,
 * dopodomani prenotato) e (2) invia il template Pro
 * `pro_maxi_promo_gap_1gg` (la risoluzione passa da OLD_TO_PRO + label
 * fallback in messageTemplates.ts) al numero di telefono indicato qui.
 *
 * Il body del messaggio non vive in questo componente: si edita
 * direttamente in "Messaggi di Sistema Pro" → template MAXI PROMO GAP 1GG.
 * Le variabili supportate sono `{vehicle_specs}` (alias `{vehicle}`,
 * `{veicolo}`) — nessun dato hardcoded.
 */
export default function MaxiPromoGapTab() {
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [lastResult, setLastResult] = useState<any | null>(null)

  async function runDryRun() {
    setLoading(true)
    setLastResult(null)
    try {
      const res = await authFetch('/.netlify/functions/maxi-promo-gap-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setLastResult(data)
      toast.success(`Rilevati ${data.count} veicoli con buco di 1 giorno domani`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function runTestSend() {
    if (!phone.trim()) {
      toast.error('Inserisci un numero di telefono di test')
      return
    }
    if (!confirm(`Inviare i messaggi MAXI PROMO al numero ${phone.trim()}?\n\nIl messaggio verrà letto da Messaggi di Sistema Pro (template MAXI PROMO GAP 1GG).`)) return

    setLoading(true)
    setLastResult(null)
    const toastId = toast.loading('Rilevamento + invio in corso...')
    try {
      const res = await authFetch('/.netlify/functions/maxi-promo-gap-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim() }),
      })
      const data = await res.json()
      toast.dismiss(toastId)
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setLastResult(data)
      if (data.gapsFound === 0) {
        toast('Nessun buco di 1 giorno rilevato per domani', { icon: 'ℹ️' })
      } else if (data.sent === data.gapsFound) {
        toast.success(`${data.sent}/${data.gapsFound} messaggi inviati a ${data.recipient}`)
      } else {
        toast.error(`Inviati ${data.sent}/${data.gapsFound} (${data.failed} falliti)`)
      }
    } catch (err) {
      toast.dismiss(toastId)
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-3 sm:p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-theme-text-primary mb-1">Maxi Promo Gap 1GG</h2>
        <p className="text-sm text-theme-text-muted">
          Rileva automaticamente i veicoli con un solo giorno libero domani (gap fra due
          prenotazioni) e invia il messaggio promozionale. Il body del messaggio si gestisce
          in <span className="text-dr7-gold font-medium">Messaggi di Sistema Pro</span> →
          template <span className="text-dr7-gold font-medium">MAXI PROMO GAP 1GG</span>.
          Variabili: <code className="px-1.5 py-0.5 bg-theme-bg-tertiary rounded text-dr7-gold">{'{vehicle_specs}'}</code>.
        </p>
      </div>

      <div className="bg-theme-bg-secondary border border-theme-border rounded-3xl p-6 max-w-2xl">
        <div className="mb-4">
          <label className="block text-sm font-semibold text-theme-text-primary mb-2">
            Numero di test
          </label>
          <p className="text-xs text-theme-text-muted mb-2">
            Per ora inviamo solo a un singolo destinatario. Inserisci il numero su cui
            vuoi ricevere il/i messaggi (verranno generati uno per ciascun veicolo con
            gap rilevato).
          </p>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="es. +39 345 790 5205"
            className="w-full px-4 py-3 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors"
          />
        </div>

        <div className="flex gap-3 flex-wrap">
          <button
            onClick={runDryRun}
            disabled={loading}
            className="px-5 py-2.5 bg-theme-bg-tertiary text-theme-text-secondary rounded-full font-medium hover:bg-theme-bg-hover transition-colors disabled:opacity-50"
          >
            {loading ? '...' : 'Rileva (senza inviare)'}
          </button>
          <button
            onClick={runTestSend}
            disabled={loading}
            className="px-5 py-2.5 bg-dr7-gold text-white rounded-full font-semibold hover:bg-[#247a6f] transition-colors disabled:opacity-50"
          >
            {loading ? 'Invio...' : 'Rileva e invia test'}
          </button>
        </div>
      </div>

      {lastResult && (
        <div className="mt-6 bg-theme-bg-secondary border border-theme-border rounded-3xl p-6 max-w-3xl">
          <h3 className="text-lg font-bold text-theme-text-primary mb-3">Esito ultimo run</h3>

          {typeof lastResult.gapsFound === 'number' ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <Stat label="Gap rilevati" value={lastResult.gapsFound} color="text-dr7-gold" />
              <Stat label="Inviati" value={lastResult.sent} color="text-green-400" />
              <Stat label="Falliti" value={lastResult.failed} color="text-red-400" />
              <Stat label="Destinatario" value={lastResult.recipient || '—'} small />
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
              <Stat label="Gap rilevati" value={lastResult.count ?? 0} color="text-dr7-gold" />
              <Stat label="Modalità" value="Dry run (no invio)" small />
            </div>
          )}

          {Array.isArray(lastResult.results) && lastResult.results.length > 0 ? (
            <div>
              <h4 className="text-sm font-semibold text-theme-text-primary mb-2">Dettaglio invii</h4>
              <ul className="text-sm space-y-1">
                {lastResult.results.map((r: { vehicle: string; ok: boolean; reason?: string }, i: number) => (
                  <li key={i} className={`px-3 py-1.5 rounded-lg ${r.ok ? 'bg-green-900/20 text-green-300' : 'bg-red-900/20 text-red-300'}`}>
                    <span className="font-medium">{r.vehicle}</span>
                    {r.ok ? ' · inviato' : ` · ${r.reason || 'fallito'}`}
                  </li>
                ))}
              </ul>
            </div>
          ) : Array.isArray(lastResult.vehicles) && lastResult.vehicles.length > 0 ? (
            <div>
              <h4 className="text-sm font-semibold text-theme-text-primary mb-2">Veicoli con gap</h4>
              <ul className="text-sm space-y-1">
                {lastResult.vehicles.map((v: { id?: string; name?: string; plate?: string } | string, i: number) => (
                  <li key={i} className="px-3 py-1.5 rounded-lg bg-theme-bg-tertiary text-theme-text-primary">
                    {typeof v === 'string'
                      ? v
                      : <>{v.name || '—'}{v.plate ? <span className="text-theme-text-muted ml-2">{v.plate}</span> : null}</>
                    }
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-theme-text-muted">Nessun veicolo con gap di 1 giorno per domani.</p>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, color, small }: { label: string; value: number | string; color?: string; small?: boolean }) {
  return (
    <div className="bg-theme-bg-tertiary border border-theme-border rounded-2xl p-3">
      <div className="text-xs text-theme-text-muted">{label}</div>
      <div className={`${small ? 'text-sm' : 'text-2xl'} font-bold ${color || 'text-theme-text-primary'} truncate`}>{value}</div>
    </div>
  )
}
