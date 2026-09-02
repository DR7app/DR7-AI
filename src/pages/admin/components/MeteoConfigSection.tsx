// Centralina Pro > Allerta Meteo (31/08/2026).
//
// Fino a ieri l'allerta meteo aveva le regole scritte nel codice: Noleggio
// Terra partiva con qualunque pioggia, Noleggio Mare con pioggia o raffiche
// oltre 30 km/h, gli altri tre business non ricevevano niente e la citta' era
// una sola per tutti. Da qui ogni business decide da solo COSA guardare (solo
// pioggia, solo vento o entrambi), QUANTO forte deve essere (Bassa / Media /
// Elevata), DA QUALE livello si invia, DOVE si guarda il meteo, QUANDO si puo'
// spedire e CON QUALE messaggio.
//
// Scrive in `centralina_pro_config.config.meteo_config` della riga del
// business; la citta' resta in `weather_location` della stessa riga (la legge
// anche il bottone Allerta Meteo in Prenotazioni). Le stesse regole le applica
// il cron orario: `netlify/functions/weather-alert-cron.ts`.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ScheletroTesto } from '../../../components/Scheletro'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { authFetch } from '../../../utils/authFetch'
import {
  LIVELLI, LIVELLO_LABELS, CRITERIO_LABELS, METEO_BUSINESS_LABELS,
  loadMeteoConfigClient, saveMeteoConfigClient, normalizeMeteoConfig, valutaMeteo, dentroFascia,
  type MeteoBusiness, type MeteoBusinessConfig, type MeteoCriterio, type MeteoLivello, type MeteoEsito,
} from '../../../utils/meteoConfig'

/** Toggle "Cron ON" storico: vale finche' il business non salva una scelta sua. */
const LEGACY_TOGGLE: Partial<Record<MeteoBusiness, string>> = {
  terra: 'pro_allerta_meteo',
  mare: 'pro_allerta_meteo_mare',
}

interface MeteoLive {
  available: boolean
  luogo?: string
  label?: string
  labelNow?: string
  location?: { name: string; lat: number; lon: number; admin1?: string; label?: string }
  now?: { rain?: boolean; windGustKmh?: number; precipitationMm?: number }
  forecast?: { rain?: boolean; windGustKmh?: number; precipitationMm?: number; atLocal?: string }
}
interface Citta { name: string; lat: number; lon: number; admin1?: string; label?: string }
interface TemplateRow { message_key: string; label: string | null; message_body: string | null; is_enabled: boolean | null }

/** Colori del livello: gli stessi in tutta la sezione, chiari e scuri. */
const LIVELLO_STYLE: Record<MeteoEsito, string> = {
  nessuna: 'border-theme-border bg-theme-bg-tertiary text-theme-text-muted',
  bassa: 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  media: 'border-orange-500/50 bg-orange-500/10 text-orange-700 dark:text-orange-400',
  elevata: 'border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400',
}
const LIVELLO_PALLINO: Record<MeteoEsito, string> = {
  nessuna: 'bg-gray-400',
  bassa: 'bg-amber-500',
  media: 'bg-orange-500',
  elevata: 'bg-red-500',
}

const LIVELLO_HINT: Record<MeteoLivello, string> = {
  bassa: 'Primo accenno di maltempo.',
  media: 'Maltempo vero, da segnalare.',
  elevata: 'Condizioni pesanti.',
}

/**
 * Campo numerico a testo: `type="number"` con locale italiano rifiuta la
 * virgola e mangia i decimali (stessa ragione per cui gli importi in euro non
 * lo usano). Qui si digita "0,4" o "0.4" e si salva 0.4.
 */
function NumeroField({
  value, onChange, suffix, disabled, ariaLabel,
}: {
  value: number
  onChange: (n: number) => void
  suffix: string
  disabled?: boolean
  ariaLabel: string
}) {
  const [testo, setTesto] = useState(String(value).replace('.', ','))
  const ultimoValore = useRef(value)
  useEffect(() => {
    // Riallinea solo quando il valore cambia da fuori (cambio business, reset).
    if (ultimoValore.current !== value) {
      ultimoValore.current = value
      setTesto(String(value).replace('.', ','))
    }
  }, [value])
  return (
    <div className={`flex items-center gap-1.5 ${disabled ? 'opacity-40' : ''}`}>
      <input
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        disabled={disabled}
        value={testo}
        onChange={e => {
          const t = e.target.value
          setTesto(t)
          const n = Number(t.replace(',', '.'))
          if (Number.isFinite(n)) { ultimoValore.current = n; onChange(n) }
        }}
        onBlur={() => setTesto(String(ultimoValore.current).replace('.', ','))}
        className="w-20 px-2.5 h-9 rounded-lg border border-theme-border bg-theme-bg-primary text-sm text-theme-text-primary text-right focus:outline-none focus:ring-1 focus:ring-dr7-gold disabled:cursor-not-allowed"
      />
      <span className="text-[11px] text-theme-text-muted whitespace-nowrap">{suffix}</span>
    </div>
  )
}

export default function MeteoConfigSection({
  business,
  readOnly = false,
}: {
  business: MeteoBusiness
  readOnly?: boolean
}) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [cfg, setCfg] = useState<MeteoBusinessConfig>(() => normalizeMeteoConfig(undefined, business))
  const [attiva, setAttiva] = useState(false)

  // Meteo live della citta' del business: serve a mostrare, con le
  // impostazioni aperte adesso, che livello darebbero davvero.
  const [meteo, setMeteo] = useState<MeteoLive | null>(null)
  const [meteoLoading, setMeteoLoading] = useState(false)

  // Selettore citta' (geocoder Open-Meteo, gratuito).
  const [cittaOpen, setCittaOpen] = useState(false)
  const [cittaQuery, setCittaQuery] = useState('')
  const [cittaResults, setCittaResults] = useState<Citta[]>([])
  const [cittaBusy, setCittaBusy] = useState(false)

  const [templates, setTemplates] = useState<TemplateRow[]>([])

  const caricaMeteo = useCallback(async () => {
    setMeteoLoading(true)
    try {
      const res = await fetch(`/.netlify/functions/weather-now?business=${business}`)
      setMeteo(res.ok ? await res.json() : { available: false })
    } catch {
      setMeteo({ available: false })
    } finally {
      setMeteoLoading(false)
    }
  }, [business])

  useEffect(() => {
    let vivo = true
    setLoading(true)
    void (async () => {
      const caricata = await loadMeteoConfigClient(business)
      if (!vivo) return
      setCfg(caricata)

      // Acceso o spento: se il business non ha mai scelto, vale il vecchio
      // toggle "Cron ON" del template (solo Terra e Mare ce l'avevano).
      if (typeof caricata.attiva === 'boolean') {
        setAttiva(caricata.attiva)
      } else {
        const key = LEGACY_TOGGLE[business]
        if (!key) { setAttiva(false) } else {
          const { data } = await supabase
            .from('system_messages')
            .select('is_enabled, cron_approved')
            .eq('message_key', key)
          if (!vivo) return
          setAttiva((data || []).some((r: { is_enabled?: boolean; cron_approved?: boolean }) =>
            r.is_enabled !== false && r.cron_approved === true))
        }
      }

      // Template meteo disponibili: si SCEGLIE fra quelli che esistono, non se
      // ne creano di nuovi (il catalogo Pro non deve crescere da solo).
      try {
        const { data: tpl } = await supabase
          .from('system_messages')
          .select('message_key, label, message_body, is_enabled')
          .ilike('message_key', 'pro_allerta_meteo%')
        if (!vivo) return
        // Una chiave puo' comparire su piu' righe: si tiene la prima.
        const viste = new Set<string>()
        const unici: TemplateRow[] = []
        for (const r of (tpl || []) as TemplateRow[]) {
          if (viste.has(r.message_key)) continue
          viste.add(r.message_key)
          unici.push(r)
        }
        setTemplates(unici)
      } catch {
        // Senza elenco template la sezione resta usabile: si sceglie dopo.
      } finally {
        if (vivo) setLoading(false)
      }
      void caricaMeteo()
    })()
    return () => { vivo = false }
  }, [business, caricaMeteo])

  // Ricerca citta' con debounce: si interroga il geocoder quando si smette di
  // digitare, non a ogni tasto.
  useEffect(() => {
    const q = cittaQuery.trim()
    if (!cittaOpen || q.length < 2) { setCittaResults([]); return }
    const t = setTimeout(async () => {
      setCittaBusy(true)
      try {
        const res = await fetch(`/.netlify/functions/weather-now?q=${encodeURIComponent(q)}`)
        const d = await res.json()
        setCittaResults(res.ok ? (d.results || []) : [])
      } catch {
        setCittaResults([])
      } finally {
        setCittaBusy(false)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [cittaQuery, cittaOpen])

  async function scegliCitta(loc: Citta) {
    setCittaBusy(true)
    try {
      const res = await authFetch('/.netlify/functions/weather-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business, location: { name: loc.name, lat: loc.lat, lon: loc.lon, admin1: loc.admin1 } }),
      })
      const d = await res.json()
      if (!res.ok || !d.success) throw new Error(d.error || 'Salvataggio non riuscito')
      toast.success(`${METEO_BUSINESS_LABELS[business]}: meteo su ${loc.label || loc.name}`)
      setCittaOpen(false)
      setCittaQuery('')
      setCittaResults([])
      await caricaMeteo()
    } catch (e) {
      toast.error('Errore: ' + (e instanceof Error ? e.message : 'Riprova'))
    } finally {
      setCittaBusy(false)
    }
  }

  /**
   * Salva la configurazione del business. Per Terra e Mare allinea anche il
   * vecchio toggle "Cron ON" del loro template, altrimenti Messaggi di Sistema
   * Pro mostrerebbe uno stato diverso da quello vero.
   */
  async function salva() {
    setSaving(true)
    try {
      const daSalvare: MeteoBusinessConfig = { ...cfg, attiva }
      await saveMeteoConfigClient(business, daSalvare)
      const legacyKey = LEGACY_TOGGLE[business]
      if (legacyKey && daSalvare.template_key === legacyKey) {
        // Solo cron_approved: `is_automatic` autorizzerebbe anche lo scheduler
        // generico dei messaggi programmati (incidente del 26/08/2026).
        await supabase
          .from('system_messages')
          .update({ cron_approved: attiva, updated_at: new Date().toISOString() })
          .eq('message_key', legacyKey)
      }
      setCfg(daSalvare)
      toast.success(`Allerta meteo ${METEO_BUSINESS_LABELS[business]} aggiornata`)
      void caricaMeteo()
    } catch (e) {
      toast.error('Errore: ' + (e instanceof Error ? e.message : 'riprova'))
    } finally {
      setSaving(false)
    }
  }

  function setSoglia(livello: MeteoLivello, campo: 'pioggia_mm' | 'vento_kmh', valore: number) {
    setCfg(prev => ({
      ...prev,
      soglie: { ...prev.soglie, [livello]: { ...prev.soglie[livello], [campo]: valore } },
    }))
  }

  // Anteprima: la previsione vera passata nelle impostazioni APERTE ADESSO,
  // anche se non ancora salvate. La regola e' la stessa del server (i due
  // moduli sono confrontati da meteoConfig.test.ts).
  const anteprima = useMemo(() => {
    if (!meteo?.available || !meteo.forecast) return null
    return valutaMeteo(cfg, meteo.forecast)
  }, [cfg, meteo])
  const anteprimaAdesso = useMemo(() => {
    if (!meteo?.available || !meteo.now) return null
    return valutaMeteo(cfg, meteo.now)
  }, [cfg, meteo])

  const oraRoma = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }).format(new Date()))
  const inFascia = dentroFascia(cfg, oraRoma)

  const usaPioggia = cfg.criterio !== 'vento'
  const usaVento = cfg.criterio !== 'pioggia'

  const templateScelto = templates.find(t => t.message_key === cfg.template_key)

  if (loading) return <ScheletroTesto righe={4} className="py-4" />

  const card = 'rounded-2xl border border-theme-border bg-theme-bg-secondary p-4'
  const etichetta = 'block text-[10px] uppercase tracking-wider text-theme-text-muted font-semibold mb-1'

  return (
    <div className="space-y-4">
      {/* ── Intestazione + Salva ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-theme-text-primary">
            Allerta Meteo — {METEO_BUSINESS_LABELS[business]}
          </h3>
          <p className="text-xs text-theme-text-muted mt-0.5 max-w-2xl">
            Queste impostazioni valgono solo per questo business e comandano sia il cron orario
            sia il bottone Allerta Meteo in Prenotazioni. Il testo del messaggio si modifica in
            Messaggi di Sistema Pro.
          </p>
        </div>
        {!readOnly && (
          <button
            type="button" onClick={salva} disabled={saving}
            className="shrink-0 px-3 h-9 rounded-lg bg-dr7-gold text-white text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? 'Salvataggio...' : 'Salva'}
          </button>
        )}
      </div>

      {/* ── Interruttore generale + meteo live ───────────────────────────── */}
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={readOnly}
              onClick={() => setAttiva(v => !v)}
              aria-label={attiva ? 'Disattiva invio automatico' : 'Attiva invio automatico'}
              className={`relative w-11 h-6 rounded-full transition-colors disabled:opacity-50 ${attiva ? 'bg-emerald-500' : 'bg-theme-bg-tertiary border border-theme-border'}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${attiva ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
            <div>
              <div className="text-sm font-semibold text-theme-text-primary">Invio automatico</div>
              <div className="text-[11px] text-theme-text-muted">
                {attiva
                  ? 'Il sistema controlla ogni ora e avvisa da solo i clienti esposti.'
                  : 'L’allerta parte solo a mano, dal bottone Allerta Meteo in Prenotazioni.'}
              </div>
            </div>
          </div>

          {/* Lettura vera del momento, sulla citta' di questo business. */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={caricaMeteo}
              disabled={meteoLoading}
              title="Rileggi il meteo adesso"
              className={`inline-flex items-center gap-1.5 px-2.5 h-9 rounded-lg border text-xs font-medium transition-colors disabled:opacity-50 ${
                anteprima ? LIVELLO_STYLE[anteprima.livello] : 'border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999A5.002 5.002 0 007 12a4 4 0 00-4 3z" />
              </svg>
              {meteoLoading ? 'Meteo...' : meteo?.available ? meteo.label : 'Meteo n/d'}
            </button>

            {/* Citta' del business: il Mare puo' guardare Olbia mentre Terra guarda Cagliari. */}
            <div className="relative">
              <button
                type="button"
                disabled={readOnly}
                onClick={() => setCittaOpen(v => !v)}
                title="Citta' su cui si basa l'allerta di questo business"
                className="inline-flex items-center gap-1.5 px-2.5 h-9 rounded-lg border border-theme-border text-xs font-medium text-theme-text-secondary hover:bg-theme-bg-hover transition-colors disabled:opacity-50"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {meteo?.location?.name || meteo?.luogo || 'Citta'}
              </button>
              {cittaOpen && (
                <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-lg border border-theme-border bg-theme-bg-secondary shadow-xl p-2">
                  <input
                    autoFocus
                    type="text"
                    value={cittaQuery}
                    onChange={e => setCittaQuery(e.target.value)}
                    placeholder="Olbia, Cagliari, Alghero..."
                    className="w-full px-2.5 h-8 rounded-md border border-theme-border bg-theme-bg-primary text-xs text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-1 focus:ring-dr7-gold"
                  />
                  <div className="mt-1.5 max-h-56 overflow-y-auto">
                    {cittaBusy && <div className="px-2 py-2 text-xs text-theme-text-muted">Ricerca...</div>}
                    {!cittaBusy && cittaQuery.trim().length >= 2 && cittaResults.length === 0 && (
                      <div className="px-2 py-2 text-xs text-theme-text-muted">Nessuna citta' trovata</div>
                    )}
                    {cittaResults.map(r => (
                      <button
                        key={`${r.name}-${r.lat}-${r.lon}`}
                        type="button"
                        onClick={() => scegliCitta(r)}
                        disabled={cittaBusy}
                        className="w-full text-left px-2 py-1.5 rounded-md text-xs text-theme-text-primary hover:bg-theme-bg-hover transition-colors disabled:opacity-50"
                      >
                        {r.label || r.name}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 px-1 text-[10px] leading-snug text-theme-text-muted">
                    La citta' si salva subito, senza premere Salva.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Cosa guardare ────────────────────────────────────────────────── */}
      <div className={card}>
        <div className={etichetta}>Cosa fa scattare l'allerta</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {(['pioggia', 'vento', 'entrambi'] as MeteoCriterio[]).map(c => {
            const attivo = cfg.criterio === c
            return (
              <button
                key={c}
                type="button"
                disabled={readOnly}
                onClick={() => setCfg(prev => ({ ...prev, criterio: c }))}
                className={`text-left px-3 py-2.5 rounded-xl border transition-colors disabled:opacity-60 ${
                  attivo
                    ? 'border-[#007aff] bg-[#007aff]/10'
                    : 'border-theme-border bg-theme-bg-primary hover:bg-theme-bg-hover'
                }`}
              >
                <div className={`text-sm font-semibold ${attivo ? 'text-[#007aff]' : 'text-theme-text-primary'}`}>
                  {CRITERIO_LABELS[c]}
                </div>
                <div className="text-[11px] text-theme-text-muted mt-0.5">
                  {c === 'pioggia' && 'Il vento non conta, per quanto forte sia.'}
                  {c === 'vento' && 'La pioggia non conta: guarda solo le raffiche.'}
                  {c === 'entrambi' && 'Basta che una delle due superi la soglia.'}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── I tre livelli ────────────────────────────────────────────────── */}
      <div className={card}>
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <div className={etichetta}>Livelli di allerta</div>
            <p className="text-[11px] text-theme-text-muted">
              Il livello e' il piu' alto raggiunto dalla previsione. Si invia da
              <span className="font-semibold text-theme-text-secondary"> {LIVELLO_LABELS[cfg.livello_minimo]} </span>
              in su: sotto, il sistema vede il maltempo ma non scrive a nessuno. Una soglia a 0 spegne quel livello.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-theme-text-muted">
                <th className="text-left font-semibold pb-2">Livello</th>
                <th className="text-left font-semibold pb-2">Pioggia da</th>
                <th className="text-left font-semibold pb-2">Raffiche da</th>
                <th className="text-left font-semibold pb-2">Invia da qui</th>
              </tr>
            </thead>
            <tbody>
              {LIVELLI.map(l => {
                const scelto = cfg.livello_minimo === l
                const raggiuntoOra = anteprima
                  ? (cfg.criterio === 'pioggia' ? anteprima.pioggia : cfg.criterio === 'vento' ? anteprima.vento : anteprima.livello) === l
                  : false
                return (
                  <tr key={l} className="border-t border-theme-border">
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${LIVELLO_PALLINO[l]}`} />
                        <div>
                          <div className="font-semibold text-theme-text-primary">{LIVELLO_LABELS[l]}</div>
                          <div className="text-[10px] text-theme-text-muted">{LIVELLO_HINT[l]}</div>
                        </div>
                        {raggiuntoOra && (
                          <span className={`ml-1 px-1.5 py-0.5 rounded-full border text-[10px] font-semibold ${LIVELLO_STYLE[l]}`}>
                            adesso
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3">
                      <NumeroField
                        ariaLabel={`Pioggia livello ${LIVELLO_LABELS[l]}`}
                        value={cfg.soglie[l].pioggia_mm}
                        onChange={n => setSoglia(l, 'pioggia_mm', n)}
                        suffix="mm/h"
                        disabled={readOnly || !usaPioggia}
                      />
                    </td>
                    <td className="py-2.5 pr-3">
                      <NumeroField
                        ariaLabel={`Vento livello ${LIVELLO_LABELS[l]}`}
                        value={cfg.soglie[l].vento_kmh}
                        onChange={n => setSoglia(l, 'vento_kmh', n)}
                        suffix="km/h"
                        disabled={readOnly || !usaVento}
                      />
                    </td>
                    <td className="py-2.5">
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() => setCfg(prev => ({ ...prev, livello_minimo: l }))}
                        className={`px-2.5 h-8 rounded-lg border text-xs font-semibold transition-colors disabled:opacity-60 ${
                          scelto ? LIVELLO_STYLE[l] : 'border-theme-border text-theme-text-muted hover:bg-theme-bg-hover'
                        }`}
                      >
                        {scelto ? 'Soglia di invio' : 'Imposta'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Quando si guarda e quando si scrive ──────────────────────────── */}
      <div className={card}>
        <div className={etichetta}>Quando</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] text-theme-text-secondary mb-1">Guarda avanti</label>
            <NumeroField
              ariaLabel="Ore di previsione"
              value={cfg.ore_avanti}
              onChange={n => setCfg(prev => ({ ...prev, ore_avanti: Math.max(1, Math.min(12, Math.round(n))) }))}
              suffix="ore"
              disabled={readOnly}
            />
            <p className="mt-1 text-[10px] leading-snug text-theme-text-muted">
              Si valuta l'ora peggiore di questa finestra: l'avviso arriva prima del maltempo, non a cliente gia' bagnato.
            </p>
          </div>
          <div>
            <label className="block text-[11px] text-theme-text-secondary mb-1">Non scrivere prima delle</label>
            <NumeroField
              ariaLabel="Ora di inizio invii"
              value={cfg.ora_inizio}
              onChange={n => setCfg(prev => ({ ...prev, ora_inizio: Math.max(0, Math.min(23, Math.round(n))) }))}
              suffix=":00"
              disabled={readOnly}
            />
          </div>
          <div>
            <label className="block text-[11px] text-theme-text-secondary mb-1">Ne' dopo le</label>
            <NumeroField
              ariaLabel="Ora di fine invii"
              value={cfg.ora_fine}
              onChange={n => setCfg(prev => ({ ...prev, ora_fine: Math.max(0, Math.min(23, Math.round(n))) }))}
              suffix=":00"
              disabled={readOnly}
            />
            <p className="mt-1 text-[10px] leading-snug text-theme-text-muted">
              Fuori fascia l'avviso non si perde: parte appena la fascia riapre, se il maltempo persiste.
            </p>
          </div>
        </div>

        <label className="mt-3 flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            disabled={readOnly}
            checked={cfg.riavvisa_se_peggiora}
            onChange={e => setCfg(prev => ({ ...prev, riavvisa_se_peggiora: e.target.checked }))}
            className="mt-0.5 w-4 h-4 accent-[#007aff]"
          />
          <span className="text-xs text-theme-text-secondary">
            Riavvisa se il livello peggiora
            <span className="block text-[10px] text-theme-text-muted">
              Un episodio si segnala una volta sola. Con questa spunta, se si passa (per esempio) da Bassa a Elevata parte un secondo avviso: e' un'altra notizia.
            </span>
          </span>
        </label>
      </div>

      {/* ── Messaggio ────────────────────────────────────────────────────── */}
      <div className={card}>
        <div className={etichetta}>Messaggio da inviare</div>
        {templates.length === 0 ? (
          <p className="text-xs text-theme-text-muted">
            Nessun template meteo ancora presente in Messaggi di Sistema Pro. Li crea il cron alla prima esecuzione,
            oppure si aprono una volta da quella tab.
          </p>
        ) : (
          <>
            <select
              disabled={readOnly}
              value={cfg.template_key}
              onChange={e => setCfg(prev => ({ ...prev, template_key: e.target.value }))}
              className="w-full sm:w-96 px-2.5 h-9 rounded-lg border border-theme-border bg-theme-bg-primary text-sm text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-dr7-gold disabled:opacity-60"
            >
              {templates.map(t => (
                <option key={t.message_key} value={t.message_key}>
                  {(t.label || t.message_key) + (t.is_enabled === false ? ' (spento)' : '')}
                </option>
              ))}
            </select>
            {templateScelto?.is_enabled === false && (
              <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                Questo template e' spento in Messaggi di Sistema Pro: finche' resta cosi', non parte nessun avviso.
              </p>
            )}
            {templateScelto?.message_body && (
              <div className="mt-2 rounded-lg bg-theme-bg-tertiary border border-theme-border p-3 max-h-40 overflow-y-auto">
                <pre className="text-[11px] leading-relaxed text-theme-text-secondary whitespace-pre-wrap font-sans">
                  {templateScelto.message_body}
                </pre>
              </div>
            )}
            <p className="mt-1.5 text-[10px] text-theme-text-muted">
              Il testo si modifica in Messaggi di Sistema Pro: qui si sceglie solo quale usare per questo business.
            </p>
          </>
        )}
      </div>

      {/* ── Prova del nove: cosa succederebbe adesso ─────────────────────── */}
      <div className={`${card} ${anteprima?.supera ? 'border-amber-500/40' : ''}`}>
        <div className={etichetta}>Con queste impostazioni, adesso</div>
        {!meteo?.available ? (
          <p className="text-xs text-theme-text-muted">
            Meteo non disponibile: si riprova con il bottone qui sopra. Il cron, se non riesce a leggere, salta il giro senza inviare.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${LIVELLO_STYLE[anteprima?.livello || 'nessuna']}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${LIVELLO_PALLINO[anteprima?.livello || 'nessuna']}`} />
                {LIVELLO_LABELS[anteprima?.livello || 'nessuna']}
              </span>
              <span className="text-xs text-theme-text-secondary">
                {meteo.location?.label || meteo.luogo} — prossime {cfg.ore_avanti} ore: {meteo.label}
              </span>
            </div>
            <p className="text-[11px] text-theme-text-muted">
              Adesso: {meteo.labelNow}
              {anteprimaAdesso && anteprimaAdesso.livello !== (anteprima?.livello || 'nessuna') && (
                <> (livello attuale: {LIVELLO_LABELS[anteprimaAdesso.livello]})</>
              )}
            </p>
            <p className="text-xs text-theme-text-secondary">{anteprima?.motivo}</p>
            <div className="text-xs font-semibold">
              {!attiva ? (
                <span className="text-theme-text-muted">Invio automatico spento: nessun messaggio partirebbe da solo.</span>
              ) : !anteprima?.supera ? (
                <span className="text-theme-text-muted">
                  Sotto la soglia di invio ({LIVELLO_LABELS[cfg.livello_minimo]}): nessun messaggio.
                </span>
              ) : !inFascia ? (
                <span className="text-amber-600 dark:text-amber-400">
                  Livello raggiunto, ma sono le {String(oraRoma).padStart(2, '0')}:00 — fuori dalla fascia {String(cfg.ora_inizio).padStart(2, '0')}:00-{String(cfg.ora_fine).padStart(2, '0')}:00. Partirebbe alla riapertura.
                </span>
              ) : (
                <span className="text-emerald-600 dark:text-emerald-400">
                  Partirebbe l'avviso ai clienti di {METEO_BUSINESS_LABELS[business]} esposti adesso (una volta per episodio).
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
