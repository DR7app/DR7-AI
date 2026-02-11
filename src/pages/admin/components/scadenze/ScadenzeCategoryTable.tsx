import { CATEGORIES, COLOR_CLASSES, STATUS_COLORS, STATUS_LABELS, formatDate, formatAmount, getDaysRemaining, getKmRemaining } from './scadenzeConfig'
import type { Scadenza } from './scadenzeConfig'

interface ScadenzeCategoryTableProps {
  categoryKey: string
  scadenze: Scadenza[]
  onAction: (scadenza: Scadenza, action: string) => void
  onEdit?: (scadenza: Scadenza) => void
}

export default function ScadenzeCategoryTable({ categoryKey, scadenze, onAction, onEdit }: ScadenzeCategoryTableProps) {
  const category = CATEGORIES[categoryKey]
  if (!category) return null

  const isKmBased = categoryKey === 'veicoli_manutenzione'

  return (
    <div className={`rounded-lg border ${COLOR_CLASSES[category.color]}`}>
      <div className="px-4 py-3 border-b border-theme-border">
        <h3 className="text-lg font-bold text-theme-text-primary flex items-center justify-between">
          {category.label}
          <span className="text-sm font-normal text-theme-text-muted">
            {scadenze.length} {scadenze.length === 1 ? 'scadenza' : 'scadenze'}
          </span>
        </h3>
      </div>

      {scadenze.length === 0 ? (
        <div className="p-4 text-theme-text-muted text-center">
          Nessuna scadenza imminente
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-theme-border">
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">
                  {isKmBased ? 'KM Scadenza' : 'Data Scadenza'}
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Voce</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Riferimento</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Importo</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Stato</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {scadenze.map(scadenza => {
                const daysInfo = getDaysRemaining(scadenza.due_date)
                const kmInfo = getKmRemaining(scadenza.due_km, scadenza.current_km)

                return (
                  <tr key={scadenza.id} className="border-b border-theme-border/50 hover:bg-theme-text-primary/5">
                    <td className="px-4 py-3">
                      {isKmBased ? (
                        <div>
                          <span className="text-theme-text-primary font-mono">
                            {scadenza.due_km?.toLocaleString()} km
                          </span>
                          {kmInfo && (
                            <div className={`text-xs mt-1 ${kmInfo.urgent ? 'text-red-400 font-bold' : kmInfo.warning ? 'text-yellow-400' : 'text-theme-text-muted'}`}>
                              {kmInfo.km <= 0 ? 'SCADUTO' : `Mancano ${kmInfo.km.toLocaleString()} km`}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div>
                          <span className="text-theme-text-primary">{formatDate(scadenza.due_date)}</span>
                          {daysInfo && (
                            <div className={`text-xs mt-1 ${daysInfo.urgent ? 'text-red-400 font-bold' : daysInfo.warning ? 'text-yellow-400' : 'text-theme-text-muted'}`}>
                              {daysInfo.days === 0 ? 'OGGI' : daysInfo.days < 0 ? 'SCADUTO' : `Tra ${daysInfo.days} giorni`}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-theme-text-primary">{scadenza.item_type}</td>
                    <td className="px-4 py-3 text-theme-text-secondary">{scadenza.description || scadenza.reference_name || '-'}</td>
                    <td className="px-4 py-3 text-theme-text-primary font-mono">
                      {scadenza.amount ? `${formatAmount(scadenza.amount)}` : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${STATUS_COLORS[scadenza.status] || 'bg-theme-bg-tertiary text-theme-text-secondary'}`}>
                        {STATUS_LABELS[scadenza.status] || scadenza.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {/* Cauzione specific actions */}
                        {categoryKey === 'cauzioni' && (
                          <>
                            {scadenza.status === 'to_block' && (
                              <button
                                onClick={() => onAction(scadenza, 'block')}
                                className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium"
                              >
                                Blocca
                              </button>
                            )}
                            {scadenza.status === 'blocked' && (
                              <>
                                <button
                                  onClick={() => onAction(scadenza, 'collect')}
                                  className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-medium"
                                >
                                  Incassa
                                </button>
                                <button
                                  onClick={() => onAction(scadenza, 'refund')}
                                  className="px-3 py-1 bg-orange-600 hover:bg-orange-700 text-white rounded text-xs font-medium"
                                >
                                  Rimborsa
                                </button>
                              </>
                            )}
                            {scadenza.status === 'to_refund' && (
                              <button
                                onClick={() => onAction(scadenza, 'mark_refunded')}
                                className="px-3 py-1 bg-theme-bg-hover hover:bg-theme-bg-tertiary text-theme-text-primary rounded text-xs font-medium"
                              >
                                Segna rimborsata
                              </button>
                            )}
                          </>
                        )}

                        {/* Payment actions */}
                        {category.actions.includes('pay') && categoryKey !== 'cauzioni' && (
                          <>
                            <button
                              onClick={() => onAction(scadenza, 'pay')}
                              className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-medium"
                            >
                              Paga adesso
                            </button>
                            <button
                              onClick={() => onAction(scadenza, 'mark_paid')}
                              className="px-3 py-1 bg-theme-bg-hover hover:bg-theme-bg-tertiary text-theme-text-primary rounded text-xs font-medium"
                            >
                              Segna pagata
                            </button>
                          </>
                        )}

                        {/* Complete action */}
                        {category.actions.includes('complete') && categoryKey !== 'cauzioni' && (
                          <button
                            onClick={() => onAction(scadenza, 'complete')}
                            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium"
                          >
                            Segna completata
                          </button>
                        )}

                        {/* Delete action for manual items */}
                        {category.actions.includes('delete') && scadenza.is_manual && (
                          <button
                            onClick={() => onAction(scadenza, 'delete')}
                            className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-medium"
                          >
                            Elimina
                          </button>
                        )}

                        {/* Edit action */}
                        {onEdit && (
                          <button
                            onClick={() => onEdit(scadenza)}
                            className="px-3 py-1 bg-theme-bg-hover hover:bg-theme-bg-tertiary text-theme-text-primary rounded text-xs font-medium border border-theme-border"
                          >
                            Modifica
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
