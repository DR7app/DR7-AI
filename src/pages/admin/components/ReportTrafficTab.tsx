import { useEffect, useMemo, useState } from 'react'
import {
  LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

// ──────────────────────────────────────────────────────────────────────────────
// Real data only. Backed by /.netlify/functions/ga-report which queries
// Google Analytics 4 Data API. If env vars (GA4_PROPERTY_ID,
// GA4_SERVICE_ACCOUNT_JSON) are missing the function returns
// configured=false and we render the setup banner — never fake numbers.
// ──────────────────────────────────────────────────────────────────────────────

interface KpiBlock {
  visits: number
  pageviews: number
  users: number
  bookings: number
  calls: number
  revenue: number
  delta_visits: number
  delta_pageviews: number
  delta_users: number
}
interface SeriesPoint { day: string; total: number; organico: number; ads: number; maps: number }
interface ChannelSlice { name: string; value: number }
interface FunnelStage { stage: string; value: number }
interface TopPage { page: string; sessions: number; pageviews: number }
interface RealtimeBlock {
  activeUsers: number
  pageviews30m: number
  events30m: number
  conversions30m: number
  topActivePages: { page: string; users: number }[]
}
interface ReportPayload {
  configured: boolean
  missing: string[]
  range: '7d' | '28d' | '90d' | '180d' | '365d'
  kpis: KpiBlock | null
  realtime: RealtimeBlock | null
  traffic: SeriesPoint[]
  distribution: ChannelSlice[]
  funnel: FunnelStage[]
  topPages: TopPage[]
  fetchedAt: string
  warnings: string[]
  permissionIssue?: {
    serviceAccountEmail: string
    propertyId: string
  } | null
  dataSource?: 'ga4' | 'internal'
  conversionsSource?: 'ga4' | 'crm'
}

const RANGES = [
  { key: '7d',  label: '7 giorni' },
  { key: '28d', label: '28 giorni' },
  { key: '90d', label: '90 giorni' },
  { key: '180d', label: '6 mesi' },
  { key: '365d', label: '1 anno' },
] as const
type RangeKey = typeof RANGES[number]['key']

const CHANNEL_COLORS: Record<string, string> = {
  'Organic Search':       '#10b981',
  'Direct':               '#06b6d4',
  'Referral':             '#f59e0b',
  'Organic Social':       '#ec4899',
  'Paid Search':          '#a855f7',
  'Paid Social':          '#a855f7',
  'Display':              '#a855f7',
  'Email':                '#3b82f6',
  'Organic Video':        '#ef4444',
  'Unassigned':           '#64748b',
}
const colorFor = (name: string) => CHANNEL_COLORS[name] || '#94a3b8'

const fmtInt = (v: number) => v.toLocaleString('it-IT')
const fmtEur = (v: number) => `€${v.toLocaleString('it-IT', { maximumFractionDigits: 0 })}`
const deltaCls = (d: number) => d > 0 ? 'text-emerald-400' : d < 0 ? 'text-red-400' : 'text-theme-text-muted'
const deltaStr = (d: number) => d === 0 ? '—' : `${d > 0 ? '+' : ''}${d.toFixed(1)}%`

function Card({ title, right, children, className = '' }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-theme-bg-secondary/70 border border-theme-border rounded-xl p-4 flex flex-col ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-theme-text-primary uppercase tracking-wider">{title}</h3>
        {right}
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  )
}

function KpiTile({ label, value, delta, sub, valueClass = 'text-theme-text-primary', format = 'int' }: {
  label: string; value: number | string; delta?: number; sub?: string; valueClass?: string; format?: 'int' | 'eur'
}) {
  const isString = typeof value === 'string'
  return (
    <div className="bg-theme-bg-secondary/70 border border-theme-border rounded-xl p-3 flex flex-col gap-1 min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-theme-text-muted truncate">{label}</div>
      <div className={`text-xl font-bold ${valueClass} tabular-nums`}>
        {isString ? value : (format === 'eur' ? fmtEur(value as number) : fmtInt(value as number))}
      </div>
      <div className={`text-[11px] font-medium ${delta != null ? deltaCls(delta) : 'text-theme-text-muted'}`}>
        {sub ? sub : (delta != null ? deltaStr(delta) : '—')}
      </div>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center text-[11px] text-theme-text-muted/70 italic h-full min-h-[80px]">
      {message}
    </div>
  )
}

export default function ReportTrafficTab() {
  const [range, setRange] = useState<RangeKey>('28d')
  const [data, setData] = useState<ReportPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  // Quando atterriamo qui con ?ga_oauth=connected (subito dopo l'OAuth
  // callback), il refresh token e' appena stato salvato in app_secrets.
  // Forziamo un refetch e dopo puliamo la query string cosi' un reload
  // manuale non ri-trigghera il banner di successo.
  const oauthFlag = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('ga_oauth')
    : null
  useEffect(() => {
    let abort = false
    setLoading(true)
    setErr(null)
    fetch(`/.netlify/functions/ga-report?range=${range}`)
      .then(r => r.json())
      .then((p: ReportPayload) => { if (!abort) setData(p) })
      .catch(e => { if (!abort) setErr(String(e?.message || e)) })
      .finally(() => {
        if (abort) return
        setLoading(false)
        if (oauthFlag === 'connected' && typeof window !== 'undefined') {
          try {
            const u = new URL(window.location.href)
            u.searchParams.delete('ga_oauth')
            window.history.replaceState({}, '', u.toString())
          } catch { /* ignore */ }
        }
      })
    return () => { abort = true }
  }, [range, oauthFlag])

  const totalSessions = useMemo(
    () => (data?.distribution || []).reduce((s, c) => s + c.value, 0),
    [data]
  )

  const showBanner = data && !data.configured
  const showWarnings = data && data.warnings.length > 0

  return (
    <div className="space-y-4 p-2">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-theme-text-primary flex items-center gap-2">
            <span className="inline-block w-2 h-6 rounded-full bg-gradient-to-b from-cyan-400 via-fuchsia-500 to-emerald-400" />
            Rendimento Sito
          </h1>
          <p className="text-xs text-theme-text-muted mt-1">
            Dati reali da Google Analytics 4 — dr7empire.com
            {data?.fetchedAt && (
              <span className="ml-2 opacity-60">· aggiornato {new Date(data.fetchedAt).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-theme-bg-secondary border border-theme-border rounded-full overflow-hidden">
            {RANGES.map(r => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${range === r.key ? 'bg-dr7-gold text-white' : 'text-theme-text-muted hover:bg-theme-bg-hover'}`}
              >{r.label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Setup banner — shown only when env vars missing */}
      {showBanner && (
        <div className="bg-amber-500/15 border-2 border-amber-500 rounded-xl p-4 text-amber-900 dark:text-amber-100">
          <div className="text-base font-bold mb-2 flex items-center gap-2">
            <span className="text-xl">⚠️</span>
            Configurazione Google Analytics richiesta
          </div>
          <div className="text-sm leading-relaxed mb-3 opacity-90">
            Imposta in Netlify env (admin site) queste variabili:
          </div>
          <ul className="space-y-1.5 mb-3">
            {data!.missing.map(m => (
              <li key={m} className="text-sm font-mono font-bold bg-amber-600 text-white px-3 py-1.5 rounded inline-block mr-2">{m}</li>
            ))}
          </ul>
          <div className="text-xs leading-relaxed space-y-1.5 opacity-90">
            <div><strong>GA4_PROPERTY_ID</strong> — numerico (es. <code className="font-mono bg-amber-600/20 px-1 rounded">14813314951</code>), lo trovi in Analytics → Admin → Property settings.</div>
            <div><strong>GA4_CLIENT_EMAIL</strong> — copia il campo <code className="font-mono bg-amber-600/20 px-1 rounded">client_email</code> dal JSON del service account (es. <code className="font-mono bg-amber-600/20 px-1 rounded">dr7-analytics@…iam.gserviceaccount.com</code>).</div>
            <div><strong>GA4_PRIVATE_KEY</strong> — copia il campo <code className="font-mono bg-amber-600/20 px-1 rounded">private_key</code> dal JSON, da <code>-----BEGIN PRIVATE KEY-----</code> a <code>-----END PRIVATE KEY-----</code> incluso.</div>
          </div>
        </div>
      )}

      {/* Internal data fallback banner — quando GA4 non e' raggiungibile
          mostriamo una nota chiara + bottone per connettere Google account
          via OAuth (alternativa al service account problematico). */}
      {data?.dataSource === 'internal' && (
        <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-4 text-amber-900 dark:text-amber-100 text-sm">
          <div className="font-semibold mb-1">Dati interni DR7 (GA4 non raggiungibile)</div>
          <p className="text-xs leading-relaxed opacity-90 mb-3">
            Questi numeri vengono dalla nostra DB: prenotazioni, clienti, fatturato.
            NON sono dati di traffico web. Per vedere il traffico reale (visite,
            pagine, sorgenti) connetti il tuo account Google direttamente qui sotto —
            nessun service account, nessun checkbox di GA da spuntare.
          </p>
          <a
            href="/.netlify/functions/ga-oauth-start"
            className="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 rounded-full text-sm font-semibold text-amber-900 dark:text-amber-100 hover:bg-amber-50 dark:hover:bg-amber-900/60 transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor"><path d="M12 11v2h5.5c-.2 1.4-1.6 4-5.5 4-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.4l2.6-2.5C16.9 2.5 14.7 1.5 12 1.5 6.2 1.5 1.5 6.2 1.5 12S6.2 22.5 12 22.5c6.1 0 10.1-4.3 10.1-10.3 0-.7-.1-1.2-.2-1.7H12z"/></svg>
            Connetti il mio account Google
          </a>
          <p className="text-[10px] mt-2 opacity-70">
            Apriamo Google → tu acconsenti con <strong>dubai.rent7.0srl@gmail.com</strong> →
            torni qui automaticamente. I dati GA4 reali appaiono entro 30 secondi.
          </p>
        </div>
      )}

      {/* Successo o errore OAuth dopo callback */}
      {typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('ga_oauth') === 'connected' && (
        <div className="bg-emerald-500/15 border border-emerald-500 rounded-xl p-3 text-emerald-900 dark:text-emerald-100 text-sm">
          Account Google connesso. Ricarico i dati…
        </div>
      )}
      {typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('ga_oauth_error') && (
        <div className="bg-red-500/15 border border-red-500 rounded-xl p-3 text-red-900 dark:text-red-100 text-sm">
          Connessione fallita: {new URLSearchParams(window.location.search).get('ga_oauth_error')}
        </div>
      )}

      {/* Permission denied banner — actionable instructions per
          aggiungere il service account come Viewer in GA4. */}
      {data?.permissionIssue && (
        <div className="bg-rose-500/10 border-2 border-rose-500 rounded-xl p-4 text-rose-900 dark:text-rose-100">
          <div className="text-base font-bold mb-2">
            GA4: il service account non ha accesso alla property {data.permissionIssue.propertyId}
          </div>
          <p className="text-sm mb-3 opacity-90">
            Le credenziali sono configurate correttamente ma Google Analytics
            non riconosce ancora il nostro account come autorizzato a leggere
            i dati. Devi aggiungerlo come <strong>Viewer</strong> nella property GA4.
          </p>
          <div className="text-xs leading-relaxed space-y-1.5 opacity-90 mb-3">
            <div><strong>1.</strong> Apri Google Analytics → entra nella property <code className="font-mono bg-rose-500/20 px-1 rounded">{data.permissionIssue.propertyId}</code> (DR7 Empire).</div>
            <div><strong>2.</strong> Vai su <strong>Admin (rotellina) → Property settings → Property Access Management</strong>.</div>
            <div><strong>3.</strong> Clicca <strong>+ Add user</strong>, incolla l'email qui sotto, ruolo <strong>Viewer</strong>, deseleziona "Notify by email".</div>
            <div><strong>4.</strong> Salva. Torna qui e ricarica la pagina (1-2 min per la propagazione).</div>
          </div>
          <div className="bg-rose-600 text-white rounded-lg p-3 flex items-center justify-between gap-3">
            <code className="font-mono text-sm break-all">{data.permissionIssue.serviceAccountEmail}</code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(data.permissionIssue!.serviceAccountEmail)
              }}
              className="px-3 py-1 rounded bg-white text-rose-700 text-xs font-bold hover:bg-rose-50 flex-shrink-0"
            >
              Copia email
            </button>
          </div>
        </div>
      )}

      {/* Warnings — shown when configured but data is unusual */}
      {showWarnings && !showBanner && !data?.permissionIssue && (
        <div className="bg-cyan-500/15 border-2 border-cyan-500 rounded-xl p-3 space-y-1 text-cyan-900 dark:text-cyan-100">
          {data!.warnings.map((w, i) => (
            <div key={i} className="text-sm font-medium">• {w}</div>
          ))}
        </div>
      )}

      {/* Realtime live block — bypassa il ritardo 24-48h del Reporting API.
          Mostra ultimi 30 min direttamente dalla GA4 Realtime API. */}
      {data?.realtime && data.dataSource === 'ga4' && (
        <div className="bg-emerald-500/10 border border-emerald-500/40 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">In tempo reale (ultimi 30 min)</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiTile label="Utenti attivi ora" value={data.realtime.activeUsers} valueClass="text-emerald-400" />
            <KpiTile label="Pagine viste (30m)" value={data.realtime.pageviews30m} valueClass="text-cyan-400" />
            <KpiTile label="Eventi (30m)" value={data.realtime.events30m} valueClass="text-blue-400" />
            <KpiTile label="Conversioni (30m)" value={data.realtime.conversions30m} valueClass="text-violet-400" />
          </div>
          {data.realtime.topActivePages.length > 0 && (
            <div className="mt-3 text-xs text-theme-text-muted">
              <span className="font-semibold">Pagine attive ora: </span>
              {data.realtime.topActivePages.slice(0, 3).map(p => `${p.page} (${p.users})`).join(' · ')}
            </div>
          )}
        </div>
      )}

      {/* Fetch error */}
      {err && (
        <div className="bg-red-500/10 border border-red-500/40 rounded-xl p-3 text-xs text-red-300">
          Errore caricamento dati: {err}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-xs text-theme-text-muted/70 italic">Caricamento dati Google Analytics…</div>
      )}

      {/* KPI strip — uses ONLY real numbers from GA */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Quando i numeri vengono dalla nostra DB invece che da GA4
            rietichettiamo esplicitamente cosi' nessuno crede di vedere
            traffico web. Le KPI di traffico (Visite, Pagine viste,
            Utenti) non hanno senso in quel caso e mostrano '—'. */}
        {data?.dataSource === 'internal' ? (
          <>
            <KpiTile label="Visite (web)" value={'—'} sub="GA4 da configurare" valueClass="text-theme-text-muted" />
            <KpiTile label="Pagine viste (web)" value={'—'} sub="GA4 da configurare" valueClass="text-theme-text-muted" />
            <KpiTile label="Utenti (web)" value={'—'} sub="GA4 da configurare" valueClass="text-theme-text-muted" />
            <KpiTile label="Clienti con telefono" value={data?.kpis?.calls ?? 0} sub="da CRM" valueClass="text-orange-400" />
            <KpiTile label="Prenotazioni create" value={data?.kpis?.bookings ?? 0} delta={data?.kpis?.delta_visits} sub="da CRM" valueClass="text-violet-400" />
            <KpiTile label="Fatturato pagato" value={data?.kpis?.revenue ?? 0} sub="da CRM" valueClass="text-dr7-gold" format="eur" />
          </>
        ) : (
          <>
            <KpiTile label="Visite" value={data?.kpis?.visits ?? 0} delta={data?.kpis?.delta_visits} valueClass="text-cyan-400" />
            <KpiTile label="Pagine viste" value={data?.kpis?.pageviews ?? 0} delta={data?.kpis?.delta_pageviews} valueClass="text-fuchsia-400" />
            <KpiTile label="Utenti" value={data?.kpis?.users ?? 0} delta={data?.kpis?.delta_users} valueClass="text-emerald-400" />
            <KpiTile label="Click telefono" value={data?.kpis?.calls ?? 0} sub={data?.conversionsSource === 'crm' ? 'da CRM' : undefined} valueClass="text-orange-400" />
            <KpiTile label="Prenotazioni" value={data?.kpis?.bookings ?? 0} sub={data?.conversionsSource === 'crm' ? 'da CRM' : undefined} valueClass="text-violet-400" />
            <KpiTile label="Fatturato" value={data?.kpis?.revenue ?? 0} sub={data?.conversionsSource === 'crm' ? 'da CRM' : 'da GA4'} valueClass="text-dr7-gold" format="eur" />
          </>
        )}
      </div>

      {/* Row 2: Traffic over time + Distribution + Funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <Card title="Traffico nel tempo" className="lg:col-span-7">
          <div className="h-64">
            {data && data.traffic.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.traffic} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                  <XAxis dataKey="day" stroke="rgba(255,255,255,0.3)" fontSize={10} />
                  <YAxis stroke="rgba(255,255,255,0.3)" fontSize={10} />
                  <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="total"    name="Totale visite" stroke="#06b6d4" strokeWidth={3} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="organico" name="Organico" stroke="#10b981" strokeWidth={1.5} dot={false} strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="ads"      name="Paid"     stroke="#a855f7" strokeWidth={1.5} dot={false} strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="maps"     name="Maps"     stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="3 3" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message={loading ? 'Caricamento…' : 'Nessuna visita nel periodo selezionato'} />
            )}
          </div>
        </Card>

        <Card title="Distribuzione canali" className="lg:col-span-3">
          <div className="h-48 relative">
            {data && data.distribution.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.distribution} dataKey="value" nameKey="name" innerRadius={42} outerRadius={70} paddingAngle={2}>
                    {data.distribution.map((d, i) => <Cell key={i} fill={colorFor(d.name)} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} formatter={(v: unknown) => fmtInt(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message={loading ? '' : 'Nessun canale rilevato'} />
            )}
            {data && data.distribution.length > 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <div className="text-lg font-bold text-theme-text-primary tabular-nums">{fmtInt(totalSessions)}</div>
                <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Sessioni</div>
              </div>
            )}
          </div>
          <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
            {(data?.distribution || []).map(d => {
              const pctVal = totalSessions ? (d.value / totalSessions) * 100 : 0
              return (
                <div key={d.name} className="flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1.5 text-theme-text-secondary truncate">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: colorFor(d.name) }} />
                    <span className="truncate">{d.name}</span>
                  </span>
                  <span className="tabular-nums text-theme-text-primary flex-shrink-0">{pctVal.toFixed(1)}%</span>
                </div>
              )
            })}
          </div>
        </Card>

        <Card title="Funnel conversione" className="lg:col-span-2">
          {data && data.funnel.length > 0 && data.funnel[0].value > 0 ? (
            <>
              <div className="space-y-2 mt-1">
                {data.funnel.map((f, i) => {
                  const pct = (f.value / data.funnel[0].value) * 100
                  return (
                    <div key={f.stage}>
                      <div className="flex items-baseline justify-between text-[11px] mb-0.5">
                        <span className="text-theme-text-muted truncate pr-1">{f.stage}</span>
                        <span className="tabular-nums text-theme-text-primary font-medium">{fmtInt(f.value)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-theme-bg-tertiary overflow-hidden">
                        <div className="h-full rounded-full bg-cyan-500" style={{ width: `${Math.max(pct, 1)}%`, opacity: 0.4 + 0.6 * (1 - i / data.funnel.length) }} />
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="mt-3 pt-3 border-t border-theme-border">
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-theme-text-muted">Conversione</span>
                  <span className="text-base font-bold text-emerald-400 tabular-nums">
                    {data.funnel[0].value
                      ? ((data.funnel[data.funnel.length - 1].value / data.funnel[0].value) * 100).toFixed(2)
                      : '0.00'}%
                  </span>
                </div>
              </div>
            </>
          ) : (
            <EmptyState message={loading ? '' : 'Dati insufficienti'} />
          )}
        </Card>
      </div>

      {/* Top pages */}
      <Card title="Pagine più viste">
        {data && data.topPages.length > 0 ? (
          <table className="w-full text-xs">
            <thead className="text-theme-text-muted">
              <tr>
                <th className="text-left font-normal pb-1.5">Pagina</th>
                <th className="text-right font-normal pb-1.5">Sessioni</th>
                <th className="text-right font-normal pb-1.5">Pagine viste</th>
              </tr>
            </thead>
            <tbody>
              {data.topPages.map(p => (
                <tr key={p.page} className="border-t border-theme-border/40">
                  <td className="py-1.5 text-theme-text-primary truncate max-w-[420px]">{p.page}</td>
                  <td className="py-1.5 text-right tabular-nums text-emerald-400">{fmtInt(p.sessions)}</td>
                  <td className="py-1.5 text-right tabular-nums text-theme-text-secondary">{fmtInt(p.pageviews)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState message={loading ? '' : 'Nessuna pagina visitata nel periodo'} />
        )}
      </Card>

      {/* Footer */}
      <div className="text-[10px] text-theme-text-muted/50 text-center pt-2 border-t border-theme-border/40">
        Fonte: Google Analytics Data API · property {data?.configured ? '✓' : 'non configurata'} · DR7 Empire
      </div>
    </div>
  )
}
