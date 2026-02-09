import { useState } from 'react'
import { CATEGORY_KEYS } from './scadenze/scadenzeConfig'
import { useScadenze } from './scadenze/useScadenze'
import ScadenzeSidebar from './scadenze/ScadenzeSidebar'
import ScadenzePanoramica from './scadenze/ScadenzePanoramica'
import ScadenzeCategoryTable from './scadenze/ScadenzeCategoryTable'
import ScadenzeAddModal from './scadenze/ScadenzeAddModal'

export default function ScadenzeTab() {
  const [activeView, setActiveView] = useState('panoramica')
  const [showAddModal, setShowAddModal] = useState(false)

  const {
    loading,
    scadenzaSearch,
    setScadenzaSearch,
    stats,
    topUrgent,
    getScadenzeByCategory,
    filterBySearch,
    handleAction,
    handleAddScadenza
  } = useScadenze()

  if (loading) {
    return <div className="text-theme-text-muted">Caricamento scadenze...</div>
  }

  // Get the category to preselect in the add modal
  const addModalCategory = activeView !== 'panoramica' && CATEGORY_KEYS.includes(activeView)
    ? activeView
    : undefined

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-2xl font-bold text-theme-text-primary">Scadenze</h2>
          <p className="text-sm text-theme-text-muted mt-1">
            Gestione scadenze aziendali, operative e fiscali
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-dr7-gold text-black rounded-lg font-medium hover:bg-dr7-gold/90"
        >
          Aggiungi nuova scadenza
        </button>
      </div>

      {/* Mobile pills (rendered inside sidebar component) */}
      <div className="md:hidden">
        <ScadenzeSidebar activeView={activeView} onNavigate={setActiveView} stats={stats} />
      </div>

      {/* Layout: sidebar + content */}
      <div className="flex rounded-lg border border-theme-border bg-theme-bg-secondary min-h-[500px]">
        {/* Desktop sidebar */}
        <ScadenzeSidebar activeView={activeView} onNavigate={setActiveView} stats={stats} />

        {/* Content area */}
        <div className="flex-1 p-4 md:p-6 overflow-auto">
          {/* Search - shown only on category views */}
          {activeView !== 'panoramica' && (
            <div className="mb-4">
              <input
                type="text"
                value={scadenzaSearch}
                onChange={(e) => setScadenzaSearch(e.target.value)}
                placeholder="Cerca per targa, veicolo o descrizione..."
                className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-4 py-2.5 text-theme-text-primary placeholder-theme-text-muted focus:border-dr7-gold focus:outline-none"
              />
            </div>
          )}

          {/* View content */}
          {activeView === 'panoramica' ? (
            <ScadenzePanoramica
              stats={stats}
              topUrgent={topUrgent}
              onNavigate={setActiveView}
            />
          ) : (
            <ScadenzeCategoryTable
              categoryKey={activeView}
              scadenze={filterBySearch(getScadenzeByCategory(activeView))}
              onAction={handleAction}
            />
          )}
        </div>
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <ScadenzeAddModal
          initialCategory={addModalCategory}
          onAdd={handleAddScadenza}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  )
}
