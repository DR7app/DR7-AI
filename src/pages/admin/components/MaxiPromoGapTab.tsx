import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { authFetch } from '../../../utils/authFetch'
import { supabase } from '../../../supabaseClient'

/**
 * Maxi Promo Gap.
 *
 * Body del messaggio: vive in Messaggi di Sistema Pro → "MAXI PROMO GAP 1GG".
 * Variabili: {vehicle_specs}, {date_gap}, {date_gap_long}, {date_gap_short}.
 *
 * Modalità (salvate nella tabella maxi_promo_settings, non env var):
 *   - off       → il cron non invia nulla
 *   - pilot     → invia SOLO al numero pilota indicato qui
 *   - broadcast → invia a tutti i clienti con telefono in customers_extended
 *                 (escluso status=blacklist) — il cron li carica in automatico,
 *                 nessuna lista da inserire a mano.
 *
 * Trigger del cron: ogni 10 min, fa partire l'invio quando
 * (Rome ≥ 18:00) OR (booking creato negli ultimi 20 min sul veicolo
 * con gap). Dedup per (vehicle, gap_date, recipient).
 */
type Mode = 'off' | 'pilot' | 'broadcast'

interface Settings {
  mode: Mode
  pilot_phone: string | null
  updated_at: string
}

export default function MaxiPromoGapTab() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [draftMode, setDraftMode] = useState<Mode>('off')
  const [draftPhone, setDraftPhone] = useState('')
  const [savingSettings, setSavingSettings] = useState(false)

  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [lastResult, setLastResult] = useState<any | null>(null)

  useEffect(() => {
    loadSettings()
  }, [])

  async function loadSettings() {
    const { data } = await supabase
      .from('maxi_promo_settings')
      .select('mode, pilot_phone, updated_at')
      .eq('id', 1)
      .maybeSingle()
    if (data) {
      setSettings(data as Settings)
      setDraftMode((data.mode as Mode) || 'off')
      setDraftPhone(data.pilot_phone || '')
    } else {
      // First load: row not yet created (migration not run)
      setSettings({ mode: 'off', pilot_phone: null, updated_at: '' })
    }
  }

  async function saveSettings() {
    if (draftMode === 'pilot' && !draftPhone.trim()) {
      toast.error('Inserisci il numero pilota')
      return
    }
    setSavingSettings(true)
    try {
      const payload = {
        id: 1,
        mode: draftMode,
        pilot_phone: draftMode === 'pilot' ? draftPhone.trim() : null,
        updated_at: new Date().toISOString(),
      }
      const { error } = await supabase
        .from('maxi_promo_settings')
        .upsert(payload, { onConflict: 'id' })
      if (error) throw error
      toast.success('Impostazioni salvate')
      await loadSettings()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingSettings(false)
    }
  }

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

  const modeBadge = (m: Mode) => {
    const map: Record<Mode, { label: string; cls: string }> = {
      off: { label: 'OFF', cls: 'bg-gray-600/30 text-gray-300' },
      pilot: { label: 'PILOT', cls: 'bg-amber-500/20 text-amber-300 border border-amber-500/40' },
      broadcast: { label: 'BROADCAST', cls: 'bg-green-600/20 text-green-300 border border-green-600/40' },
    }
    const c = map[m]
    return <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${c.cls}`}>{c.label}</span>
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
          Variabili supportate:&nbsp;
          <code className="px-1.5 py-0.5 bg-theme-bg-tertiary rounded text-dr7-gold">{'{vehicle_specs}'}</code>,&nbsp;
          <code className="px-1.5 py-0.5 bg-theme-bg-tertiary rounded text-dr7-gold">{'{date_gap}'}</code>,&nbsp;
          <code className="px-1.5 py-0.5 bg-theme-bg-tertiary rounded text-dr7-gold">{'{date_gap_long}'}</code>,&nbsp;
          <code className="px-1.5 py-0.5 bg-theme-bg-tertiary rounded text-dr7-gold">{'{date_gap_short}'}</code>.
        </p>
      </div>

      {/* AUTOMAZIONE: modalità cron */}
      <div className="bg-theme-bg-secondary border border-theme-border rounded-3xl p-6 max-w-2xl mb-6">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-lg font-bold text-theme-text-primary">Automazione cron</h3>
          {settings && modeBadge(settings.mode)}
        </div>
        <p className="text-xs text-theme-text-muted mb-4">
          Il cron parte ogni 10 min e invia quando: ora di Roma ≥ 18:00 OPPURE è arrivata
          una prenotazione negli ultimi 20 min che crea il gap. Dedup automatico per
          (veicolo, data del gap, destinatario): mai due volte lo stesso messaggio.
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-semibold text-theme-text-primary mb-2">Modalità</label>
            <div className="flex gap-2 flex-wrap">
              {(['off', 'pilot', 'broadcast'] as Mode[]).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setDraftMode(m)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${draftMode === m ? 'bg-dr7-gold text-white' : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover'}`}
                >
                  {m === 'off' ? 'Off' : m === 'pilot' ? 'Pilot (1 numero)' : 'Broadcast (tutti i clienti)'}
                </button>
              ))}
            </div>
            <p className="text-xs text-theme-text-muted mt-2">
              {draftMode === 'off' && 'Il cron non invia nulla. Usa questa modalità per mettere in pausa.'}
              {draftMode === 'pilot' && 'Invia SOLO al numero pilota qui sotto. Niente broadcast.'}
              {draftMode === 'broadcast' && 'Invia a tutti i clienti con telefono in customers_extended (esclusa la blacklist). Lista caricata automaticamente, NON serve inserirli a mano.'}
            </p>
          </div>

          {draftMode === 'pilot' && (
            <div>
              <label className="block text-sm font-semibold text-theme-text-primary mb-2">Numero pilota</label>
              <input
                type="tel"
                value={draftPhone}
                onChange={(e) => setDraftPhone(e.target.value)}
                placeholder="es. +39 347 281 7258"
                className="w-full px-4 py-3 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors"
              />
            </div>
          )}

          <div className="flex gap-3 justify-end">
            <button
              onClick={saveSettings}
              disabled={savingSettings}
              className="px-5 py-2.5 bg-dr7-gold text-white rounded-full font-semibold hover:bg-[#247a6f] transition-colors disabled:opacity-50"
            >
              {savingSettings ? 'Salvataggio...' : 'Salva impostazioni cron'}
            </button>
          </div>
        </div>
      </div>

      {/* TEST manuale (un singolo numero al volo, senza toccare la modalità) */}
      <div className="bg-theme-bg-secondary border border-theme-border rounded-3xl p-6 max-w-2xl">
        <h3 className="text-lg font-bold text-theme-text-primary mb-3">Test manuale</h3>
        <p className="text-xs text-theme-text-muted mb-4">
          Invio una-tantum a un singolo numero — utile per provare il body del messaggio
          senza modificare la modalità del cron qui sopra.
        </p>
        <div className="mb-4">
          <label className="block text-sm font-semibold text-theme-text-primary mb-2">
            Numero di test
          </label>
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
            className="px-5 py-2.5 bg-green-600 text-white rounded-full font-semibold hover:bg-green-700 transition-colors disabled:opacity-50"
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
