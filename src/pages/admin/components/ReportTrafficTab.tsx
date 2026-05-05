import { useMemo, useState } from 'react'
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

// ──────────────────────────────────────────────────────────────────────────────
// Mock dataset — placeholder values until GA4 / Search Console / Business
// Profile are wired. Numbers and shape mirror what the live API will return,
// so swapping `mock*` for real fetches is a one-liner each.
// ──────────────────────────────────────────────────────────────────────────────

interface KpiCard {
  key: string
  label: string
  value: number
  format: 'int' | 'pct' | 'eur'
  delta: number // % vs previous period
  color: string // tailwind text class
  spark: number[]
}

const mockKpis: KpiCard[] = [
  { key: 'visits',    label: 'Visite da Google',         value: 12458,  format: 'int', delta: 18.4, color: 'text-cyan-400',    spark: [60,80,55,90,75,110,130,120,135,160] },
  { key: 'clicks',    label: 'Click Organici',           value: 8675,   format: 'int', delta: 21.5, color: 'text-emerald-400', spark: [40,55,52,70,65,80,92,100,98,110] },
  { key: 'impr',      label: 'Impressioni',              value: 156982, format: 'int', delta: 23.7, color: 'text-fuchsia-400', spark: [200,260,240,310,290,360,400,420,460,510] },
  { key: 'ctr',       label: 'CTR Medio',                value: 5.52,   format: 'pct', delta: 6.1,  color: 'text-pink-400',    spark: [4.2,4.5,4.4,4.7,4.9,5.0,5.1,5.3,5.4,5.52] },
  { key: 'calls',     label: 'Chiamate da Google',       value: 342,    format: 'int', delta: 12.3, color: 'text-orange-400',  spark: [20,25,22,30,28,35,40,38,42,45] },
  { key: 'bookings',  label: 'Prenotazioni da Google',   value: 128,    format: 'int', delta: 21.4, color: 'text-violet-400',  spark: [6,8,9,11,10,13,15,14,17,19] },
  { key: 'revenue',   label: 'Fatturato da Google',      value: 87562,  format: 'eur', delta: 22.5, color: 'text-dr7-gold',    spark: [4000,5500,5200,7000,6800,8200,9100,9800,10500,11800] },
]

const mockTraffic = [
  { day: '20/04', organico: 320, ads: 90,  maps: 60 },
  { day: '22/04', organico: 360, ads: 110, maps: 75 },
  { day: '24/04', organico: 410, ads: 130, maps: 80 },
  { day: '26/04', organico: 380, ads: 100, maps: 70 },
  { day: '28/04', organico: 460, ads: 150, maps: 90 },
  { day: '30/04', organico: 510, ads: 170, maps: 105 },
  { day: '02/05', organico: 480, ads: 145, maps: 95 },
  { day: '04/05', organico: 540, ads: 180, maps: 115 },
  { day: '06/05', organico: 600, ads: 200, maps: 130 },
  { day: '08/05', organico: 580, ads: 175, maps: 120 },
  { day: '10/05', organico: 640, ads: 210, maps: 140 },
  { day: '12/05', organico: 690, ads: 230, maps: 155 },
]

const mockDistribution = [
  { name: 'Search Organico', value: 51.2, color: '#10b981' },
  { name: 'Google Ads',      value: 33.5, color: '#a855f7' },
  { name: 'Google Maps',     value:  8.7, color: '#f59e0b' },
  { name: 'YouTube',         value:  4.1, color: '#ef4444' },
  { name: 'Discover',        value:  2.5, color: '#06b6d4' },
]

const mockFunnel = [
  { stage: 'Visite',          value: 12458, color: '#06b6d4' },
  { stage: 'Click sito',      value:  9341, color: '#10b981' },
  { stage: 'Lead/Preventivo', value:   876, color: '#f59e0b' },
  { stage: 'Prenotazioni',    value:   128, color: '#a855f7' },
]

const mockMapsActions = [
  { label: 'Visualizzazioni',     value: 3782, delta:  8.2 },
  { label: 'Click al sito',       value: 1042, delta: 12.5 },
  { label: 'Chiamate',            value:  342, delta: 12.3 },
  { label: 'Richieste indicazioni', value: 268, delta: 18.7 },
  { label: 'Messaggi',            value:   78, delta:  6.2 },
]

const mockTopKeywords = [
  { kw: 'noleggio supercar cagliari',  click: 1058, impr: 9420, ctr: 11.2, pos: 1.4 },
  { kw: 'noleggio lamborghini sardegna', click:  942, impr: 8210, ctr: 11.5, pos: 1.6 },
  { kw: 'dr7 empire',                  click:  756, impr: 4982, ctr: 15.2, pos: 1.1 },
  { kw: 'noleggio porsche cagliari',   click:  534, impr: 5870, ctr:  9.1, pos: 2.3 },
  { kw: 'noleggio auto lusso cagliari', click:  421, impr: 6240, ctr:  6.7, pos: 2.8 },
]

const mockOrganicKpis = {
  click_total: 8675, click_delta: 21.5,
  impr_total: 156982, impr_delta: 23.7,
  ctr: 5.52, ctr_delta: 6.1,
  pos: 2.1, pos_delta: -0.4, // negative = better position
}

const mockBusinessProfile = {
  visualizzazioni: 3782, vis_delta: 8.2,
  ricerca_diretta: 1632, ric_dir_delta: 11.4,
  ricerca_scoperta: 2100, ric_scop_delta: 5.7,
  interazioni_totali: 1748, int_delta: 14.2,
  provenienza: [
    { name: 'Ricerca Google', value: 58.2, color: '#10b981' },
    { name: 'Google Maps',    value: 32.4, color: '#f59e0b' },
    { name: 'Indicazioni',    value:  9.4, color: '#06b6d4' },
  ],
}

const mockAttribution = [
  { canale: 'Fatturato da Google totale', value: 87562, roas: '—',  delta: 22.5 },
  { canale: 'Fatturato Organico',         value: 38964, roas: '—',  delta: 19.4 },
  { canale: 'Fatturato Ads',              value: 42218, roas: '8.45', delta: 26.1 },
  { canale: 'Fatturato Google Maps',      value:  6380, roas: '—',  delta: 16.7 },
]

const mockInsights = [
  { title: 'Traffico organico in crescita',   body: 'Le visite da ricerca organica sono aumentate del 21% rispetto al periodo precedente. Continua con i contenuti supercar Cagliari.' },
  { title: 'Alta impressione, basso CTR',     body: '"noleggio auto lusso cagliari" ha 6.240 impressioni ma solo 6,7% CTR. Ottimizza il title tag e la meta description per la pagina /cars.' },
  { title: 'Opportunità Ads',                 body: 'La parola chiave "noleggio Lamborghini Sardegna" ha 8.210 impressioni organiche. Una campagna Ads dedicata potrebbe accelerare i risultati.' },
]

const mockAlerts = [
  { tone: 'success', title: 'Conversion Rate +12%', body: 'Le prenotazioni da Google sono salite del 12% questa settimana.' },
  { tone: 'warning', title: 'Audi Lamborghini RS3 sotto-performante', body: 'La pagina veicolo ha 314 visite ma 0 preventivi negli ultimi 7 giorni.' },
  { tone: 'info',    title: 'Picco chiamate Google Maps',  body: 'Aumento del 28% delle chiamate da Google Maps nelle ultime 48 ore.' },
]

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

const fmt = (v: number, type: KpiCard['format']) => {
  if (type === 'pct') return `${v.toFixed(2)}%`
  if (type === 'eur') return `€${v.toLocaleString('it-IT')}`
  return v.toLocaleString('it-IT')
}

const deltaCls = (d: number) => d >= 0 ? 'text-emerald-400' : 'text-red-400'
const deltaStr = (d: number) => `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`

// ──────────────────────────────────────────────────────────────────────────────
// Visual primitives
// ──────────────────────────────────────────────────────────────────────────────

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const points = data.map((v, i) => ({ x: i, y: v }))
  return (
    <ResponsiveContainer width="100%" height={36}>
      <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
        <defs>
          <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.5} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="y" stroke={color} strokeWidth={1.5} fill={`url(#grad-${color})`} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

const KPI_HEX: Record<string, string> = {
  'text-cyan-400':    '#22d3ee',
  'text-emerald-400': '#34d399',
  'text-fuchsia-400': '#e879f9',
  'text-pink-400':    '#f472b6',
  'text-orange-400':  '#fb923c',
  'text-violet-400':  '#a78bfa',
  'text-dr7-gold':    '#d4af37',
}

function KpiTile({ k }: { k: KpiCard }) {
  const hex = KPI_HEX[k.color] || '#22d3ee'
  return (
    <div className="bg-theme-bg-secondary/70 border border-theme-border rounded-xl p-3 flex flex-col gap-1 min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-theme-text-muted truncate">{k.label}</div>
      <div className={`text-xl font-bold ${k.color} tabular-nums`}>{fmt(k.value, k.format)}</div>
      <div className={`text-[11px] font-medium ${deltaCls(k.delta)}`}>{deltaStr(k.delta)}</div>
      <div className="-mx-1"><Sparkline data={k.spark} color={hex} /></div>
    </div>
  )
}

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

// ──────────────────────────────────────────────────────────────────────────────
// Main tab
// ──────────────────────────────────────────────────────────────────────────────

const RANGES = [
  { key: '7d',  label: '7 giorni' },
  { key: '28d', label: '28 giorni' },
  { key: '90d', label: '90 giorni' },
] as const
type RangeKey = typeof RANGES[number]['key']

export default function ReportTrafficTab() {
  const [range, setRange] = useState<RangeKey>('28d')
  // Once GA4 is wired, useEffect+fetch swap mock* for live API responses
  // keyed by `range`. UI does not change.
  const kpis = mockKpis
  const traffic = mockTraffic
  const distribution = mockDistribution
  const funnel = mockFunnel
  const mapsActions = mockMapsActions
  const topKeywords = mockTopKeywords
  const organic = mockOrganicKpis
  const business = mockBusinessProfile
  const attribution = mockAttribution
  const insights = mockInsights
  const alerts = mockAlerts

  const totalVisits = useMemo(() => distribution.reduce((s, x) => s + x.value, 0), [distribution])

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
            Performance complessiva del traffico Google su dr7empire.com — Analytics, Search Console, Business Profile.
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
          <span className="text-[10px] text-theme-text-muted/60 italic">Dati mock — collegamento GA4 in attesa di credenziali</span>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        {kpis.map(k => <KpiTile key={k.key} k={k} />)}
      </div>

      {/* Row 2: Traffic over time + Distribution + Funnel + Maps actions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <Card title="Traffico da Google nel tempo" className="lg:col-span-5">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={traffic} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                <XAxis dataKey="day" stroke="rgba(255,255,255,0.3)" fontSize={10} />
                <YAxis stroke="rgba(255,255,255,0.3)" fontSize={10} />
                <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="organico" name="Organico" stroke="#10b981" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="ads"      name="Ads"      stroke="#a855f7" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="maps"     name="Maps"     stroke="#f59e0b" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Distribuzione Traffico" className="lg:col-span-3">
          <div className="h-64 relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={distribution} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                  {distribution.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} formatter={(v) => `${Number(v).toFixed(1)}%`} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <div className="text-2xl font-bold text-theme-text-primary">{totalVisits.toFixed(1)}%</div>
              <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Visite totali</div>
            </div>
          </div>
          <div className="mt-2 space-y-1">
            {distribution.map(d => (
              <div key={d.name} className="flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-1.5 text-theme-text-secondary">
                  <span className="w-2 h-2 rounded-full" style={{ background: d.color }} />
                  {d.name}
                </span>
                <span className="tabular-nums text-theme-text-primary">{d.value.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Conversioni da Google" className="lg:col-span-2">
          <div className="space-y-2 mt-1">
            {funnel.map((f, i) => {
              const pct = (f.value / funnel[0].value) * 100
              return (
                <div key={f.stage}>
                  <div className="flex items-baseline justify-between text-[11px] mb-0.5">
                    <span className="text-theme-text-muted">{f.stage}</span>
                    <span className="tabular-nums text-theme-text-primary font-medium">{f.value.toLocaleString('it-IT')}</span>
                  </div>
                  <div className="h-2 rounded-full bg-theme-bg-tertiary overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: f.color, opacity: 0.4 + 0.6 * (1 - i / funnel.length) }} />
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-3 pt-3 border-t border-theme-border">
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] uppercase tracking-wider text-theme-text-muted">Conversione Tot.</span>
              <span className="text-base font-bold text-emerald-400 tabular-nums">{((funnel[funnel.length - 1].value / funnel[0].value) * 100).toFixed(2)}%</span>
            </div>
          </div>
        </Card>

        <Card title="Azioni da Google Maps" className="lg:col-span-2">
          <div className="space-y-2">
            {mapsActions.map(a => (
              <div key={a.label} className="flex items-center justify-between bg-theme-bg-tertiary/50 rounded-lg px-2.5 py-1.5">
                <span className="text-[11px] text-theme-text-secondary truncate pr-2">{a.label}</span>
                <div className="text-right">
                  <div className="text-sm font-bold text-theme-text-primary tabular-nums">{a.value.toLocaleString('it-IT')}</div>
                  <div className={`text-[10px] font-medium ${deltaCls(a.delta)}`}>{deltaStr(a.delta)}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Row 3: Organico + Business Profile (Ads block skipped — DR7 non gestisce Google Ads) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card title="Google Organico (Search Console)">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Click totali</div>
              <div className="text-lg font-bold text-emerald-400 tabular-nums">{organic.click_total.toLocaleString('it-IT')}</div>
              <div className={`text-[10px] ${deltaCls(organic.click_delta)}`}>{deltaStr(organic.click_delta)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Impressioni</div>
              <div className="text-lg font-bold text-fuchsia-400 tabular-nums">{organic.impr_total.toLocaleString('it-IT')}</div>
              <div className={`text-[10px] ${deltaCls(organic.impr_delta)}`}>{deltaStr(organic.impr_delta)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">CTR Medio</div>
              <div className="text-lg font-bold text-pink-400 tabular-nums">{organic.ctr.toFixed(2)}%</div>
              <div className={`text-[10px] ${deltaCls(organic.ctr_delta)}`}>{deltaStr(organic.ctr_delta)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Posizione media</div>
              <div className="text-lg font-bold text-cyan-400 tabular-nums">{organic.pos.toFixed(1)}</div>
              <div className={`text-[10px] ${deltaCls(-organic.pos_delta)}`}>{organic.pos_delta >= 0 ? '+' : ''}{organic.pos_delta.toFixed(1)}</div>
            </div>
          </div>
          <div className="text-[10px] uppercase tracking-wider text-theme-text-muted mb-2">Top Keyword</div>
          <table className="w-full text-xs">
            <thead className="text-theme-text-muted">
              <tr>
                <th className="text-left font-normal pb-1.5">Keyword</th>
                <th className="text-right font-normal pb-1.5">Click</th>
                <th className="text-right font-normal pb-1.5">Impr.</th>
                <th className="text-right font-normal pb-1.5">CTR</th>
                <th className="text-right font-normal pb-1.5">Pos.</th>
              </tr>
            </thead>
            <tbody>
              {topKeywords.map(k => (
                <tr key={k.kw} className="border-t border-theme-border/40">
                  <td className="py-1.5 text-theme-text-primary truncate max-w-[200px]">{k.kw}</td>
                  <td className="py-1.5 text-right tabular-nums text-emerald-400">{k.click.toLocaleString('it-IT')}</td>
                  <td className="py-1.5 text-right tabular-nums text-theme-text-secondary">{k.impr.toLocaleString('it-IT')}</td>
                  <td className="py-1.5 text-right tabular-nums text-theme-text-secondary">{k.ctr.toFixed(1)}%</td>
                  <td className="py-1.5 text-right tabular-nums text-theme-text-secondary">{k.pos.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Google Business Profile (Maps)">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Visualizzazioni</div>
              <div className="text-lg font-bold text-orange-400 tabular-nums">{business.visualizzazioni.toLocaleString('it-IT')}</div>
              <div className={`text-[10px] ${deltaCls(business.vis_delta)}`}>{deltaStr(business.vis_delta)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Ricerca diretta</div>
              <div className="text-lg font-bold text-emerald-400 tabular-nums">{business.ricerca_diretta.toLocaleString('it-IT')}</div>
              <div className={`text-[10px] ${deltaCls(business.ric_dir_delta)}`}>{deltaStr(business.ric_dir_delta)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Ricerca scoperta</div>
              <div className="text-lg font-bold text-cyan-400 tabular-nums">{business.ricerca_scoperta.toLocaleString('it-IT')}</div>
              <div className={`text-[10px] ${deltaCls(business.ric_scop_delta)}`}>{deltaStr(business.ric_scop_delta)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Interazioni totali</div>
              <div className="text-lg font-bold text-violet-400 tabular-nums">{business.interazioni_totali.toLocaleString('it-IT')}</div>
              <div className={`text-[10px] ${deltaCls(business.int_delta)}`}>{deltaStr(business.int_delta)}</div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-theme-text-muted mb-2">Provenienza visualizzazioni</div>
              <div className="h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={business.provenienza} dataKey="value" nameKey="name" innerRadius={28} outerRadius={48} paddingAngle={2}>
                      {business.provenienza.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }} formatter={(v) => `${Number(v).toFixed(1)}%`} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1">
                {business.provenienza.map(d => (
                  <div key={d.name} className="flex items-center justify-between text-[10px]">
                    <span className="flex items-center gap-1 text-theme-text-secondary">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: d.color }} />
                      {d.name}
                    </span>
                    <span className="tabular-nums text-theme-text-primary">{d.value.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-theme-text-muted mb-2">Azioni più utili</div>
              <div className="space-y-1.5">
                {mapsActions.map(a => (
                  <div key={a.label} className="flex items-center justify-between text-[11px]">
                    <span className="text-theme-text-secondary truncate pr-2">{a.label}</span>
                    <div className="text-right">
                      <span className="font-medium tabular-nums text-theme-text-primary">{a.value.toLocaleString('it-IT')}</span>
                      <span className={`ml-2 ${deltaCls(a.delta)}`}>{deltaStr(a.delta)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Row 4: Attribuzione + Insights AI + Alert */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card title="Attribuzione e Fatturato">
          <div className="h-32 mb-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={attribution} margin={{ top: 4, right: 0, bottom: 0, left: -20 }}>
                <XAxis dataKey="canale" stroke="rgba(255,255,255,0.3)" fontSize={9} tick={{ fontSize: 9 }} />
                <YAxis stroke="rgba(255,255,255,0.3)" fontSize={9} tickFormatter={v => `€${(v/1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }} formatter={(v) => `€${Number(v).toLocaleString('it-IT')}`} />
                <Bar dataKey="value" fill="#d4af37" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1.5">
            {attribution.map(a => (
              <div key={a.canale} className="flex items-center justify-between text-[11px] border-b border-theme-border/40 pb-1.5 last:border-0">
                <span className="text-theme-text-secondary truncate pr-2">{a.canale}</span>
                <div className="text-right whitespace-nowrap">
                  <span className="font-bold tabular-nums text-dr7-gold">€{a.value.toLocaleString('it-IT')}</span>
                  {a.roas !== '—' && <span className="ml-2 text-[10px] text-theme-text-muted">ROAS {a.roas}</span>}
                  <span className={`ml-2 ${deltaCls(a.delta)}`}>{deltaStr(a.delta)}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Insight Intelligenti DR7 A.I." right={<span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/40">BETA</span>}>
          <div className="space-y-2">
            {insights.map((i, idx) => (
              <div key={idx} className="bg-theme-bg-tertiary/40 border border-theme-border rounded-lg p-2.5">
                <div className="text-[11px] font-semibold text-violet-300 mb-0.5">{i.title}</div>
                <div className="text-[11px] text-theme-text-secondary leading-snug">{i.body}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Alert Intelligenti">
          <div className="space-y-2">
            {alerts.map((a, idx) => {
              const tone =
                a.tone === 'success' ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                : a.tone === 'warning' ? 'bg-amber-500/10 border-amber-500/40 text-amber-300'
                : 'bg-cyan-500/10 border-cyan-500/40 text-cyan-300'
              return (
                <div key={idx} className={`rounded-lg p-2.5 border ${tone}`}>
                  <div className="text-[11px] font-semibold mb-0.5">{a.title}</div>
                  <div className="text-[11px] opacity-90 leading-snug">{a.body}</div>
                </div>
              )
            })}
          </div>
        </Card>
      </div>

      <div className="text-[10px] text-theme-text-muted/50 text-center pt-2 border-t border-theme-border/40">
        Dati aggiornati automaticamente · GA4 + Search Console + Google Business Profile · DR7 Empire
      </div>
    </div>
  )
}
