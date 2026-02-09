import { CATEGORIES, CATEGORY_KEYS, DOT_COLORS, STATUS_COLORS, STATUS_LABELS, formatDate, formatAmount, getDaysRemaining, getKmRemaining } from './scadenzeConfig'
import type { Scadenza } from './scadenzeConfig'
import type { ScadenzeStats } from './useScadenze'

interface ScadenzePanoramicaProps {
  stats: ScadenzeStats
  topUrgent: Scadenza[]
  onNavigate: (category: string) => void
}

export default function ScadenzePanoramica({ stats, topUrgent, onNavigate }: ScadenzePanoramicaProps) {
  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Totale Attive"
          value={stats.totalActive}
          color="text-theme-text-primary"
          bgColor="bg-theme-bg-tertiary"
        />
        <KpiCard
          label="Scadute"
          value={stats.overdue}
          color="text-red-400"
          bgColor="bg-red-900/20"
          urgent={stats.overdue > 0}
        />
        <KpiCard
          label="Questa Settimana"
          value={stats.dueThisWeek}
          color="text-yellow-400"
          bgColor="bg-yellow-900/20"
        />
        <KpiCard
          label="Importo Totale"
          value={`${formatAmount(stats.totalAmount)}`}
          color="text-theme-text-primary"
          bgColor="bg-theme-bg-tertiary"
          isCurrency
        />
      </div>

      {/* Category Summary Cards */}
      <div>
        <h3 className="text-lg font-bold text-theme-text-primary mb-3">Per Categoria</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {CATEGORY_KEYS.map(key => {
            const cat = CATEGORIES[key]
            const catStats = stats.byCategory[key]
            if (!catStats) return null
            const urgent = catStats.mostUrgent

            return (
              <button
                key={key}
                onClick={() => onNavigate(key)}
                className="text-left p-4 rounded-lg border border-theme-border bg-theme-bg-secondary hover:bg-theme-bg-hover transition-colors group"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-3 h-3 rounded-full ${DOT_COLORS[cat.color]}`} />
                  <span className="text-sm font-semibold text-theme-text-primary group-hover:text-dr7-gold transition-colors">
                    {cat.label.replace('Scadenze ', '')}
                  </span>
                  <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-theme-bg-tertiary text-theme-text-muted">
                    {catStats.count}
                  </span>
                </div>
                {urgent ? (
                  <div className="text-xs text-theme-text-muted">
                    <span className="text-theme-text-secondary">{urgent.item_type}</span>
                    {' - '}
                    {urgent.description || urgent.reference_name || ''}
                    {urgent.due_date && (
                      <span className="ml-1 text-theme-text-muted">
                        ({formatDate(urgent.due_date)})
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-theme-text-muted">Nessuna scadenza</div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Top 5 Urgent */}
      {topUrgent.length > 0 && (
        <div>
          <h3 className="text-lg font-bold text-theme-text-primary mb-3">Scadenze Urgenti</h3>
          <div className="rounded-lg border border-theme-border overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-theme-border bg-theme-bg-tertiary/50">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-theme-text-muted uppercase">Categoria</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-theme-text-muted uppercase">Voce</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-theme-text-muted uppercase">Riferimento</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-theme-text-muted uppercase">Scadenza</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-theme-text-muted uppercase">Stato</th>
                </tr>
              </thead>
              <tbody>
                {topUrgent.map(s => {
                  const cat = CATEGORIES[s.category]
                  const daysInfo = getDaysRemaining(s.due_date)
                  const kmInfo = getKmRemaining(s.due_km, s.current_km)

                  return (
                    <tr
                      key={s.id}
                      onClick={() => onNavigate(s.category)}
                      className="border-b border-theme-border/50 hover:bg-theme-bg-hover cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${DOT_COLORS[cat?.color || 'blue']}`} />
                          <span className="text-xs text-theme-text-muted">
                            {cat?.label.replace('Scadenze ', '') || s.category}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-theme-text-primary">{s.item_type}</td>
                      <td className="px-4 py-3 text-sm text-theme-text-secondary">
                        {s.description || s.reference_name || '-'}
                      </td>
                      <td className="px-4 py-3">
                        {s.due_date ? (
                          <div>
                            <span className="text-sm text-theme-text-primary">{formatDate(s.due_date)}</span>
                            {daysInfo && (
                              <div className={`text-xs mt-0.5 ${daysInfo.urgent ? 'text-red-400 font-bold' : daysInfo.warning ? 'text-yellow-400' : 'text-theme-text-muted'}`}>
                                {daysInfo.days === 0 ? 'OGGI' : daysInfo.days < 0 ? 'SCADUTO' : `Tra ${daysInfo.days}g`}
                              </div>
                            )}
                          </div>
                        ) : s.due_km ? (
                          <div>
                            <span className="text-sm text-theme-text-primary font-mono">{s.due_km.toLocaleString()} km</span>
                            {kmInfo && (
                              <div className={`text-xs mt-0.5 ${kmInfo.urgent ? 'text-red-400 font-bold' : kmInfo.warning ? 'text-yellow-400' : 'text-theme-text-muted'}`}>
                                {kmInfo.km <= 0 ? 'SCADUTO' : `${kmInfo.km.toLocaleString()} km`}
                              </div>
                            )}
                          </div>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-bold ${STATUS_COLORS[s.status] || 'bg-theme-bg-tertiary text-theme-text-secondary'}`}>
                          {STATUS_LABELS[s.status] || s.status}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function KpiCard({ label, value, color, bgColor, urgent, isCurrency }: {
  label: string
  value: number | string
  color: string
  bgColor: string
  urgent?: boolean
  isCurrency?: boolean
}) {
  return (
    <div className={`rounded-lg p-4 border border-theme-border ${bgColor}`}>
      <div className="text-xs text-theme-text-muted uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-2xl font-bold ${color} ${urgent ? 'animate-pulse' : ''}`}>
        {isCurrency ? `\u20AC ${value}` : value}
      </div>
    </div>
  )
}
