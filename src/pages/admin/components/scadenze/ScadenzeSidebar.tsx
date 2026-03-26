import { CATEGORIES, CATEGORY_KEYS, DOT_COLORS } from './scadenzeConfig'
import type { ScadenzeStats } from './useScadenze'

interface ScadenzeSidebarProps {
  activeView: string
  onNavigate: (view: string) => void
  stats: ScadenzeStats
}


export default function ScadenzeSidebar({ activeView, onNavigate, stats }: ScadenzeSidebarProps) {
  return (
    <>
      {/* Desktop sidebar */}
      <nav className="hidden md:block w-56 shrink-0 border-r border-theme-border bg-theme-bg-secondary/50 rounded-l-lg overflow-y-auto">
        <div className="py-2">
          {/* Panoramica */}
          <button
            onClick={() => onNavigate('panoramica')}
            className={`w-full text-left px-4 py-2.5 flex items-center gap-3 text-sm transition-colors ${
              activeView === 'panoramica'
                ? 'bg-dr7-gold/10 text-dr7-gold border-r-2 border-dr7-gold font-semibold'
                : 'text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-dr7-gold shrink-0" />
            <span className="truncate">Panoramica</span>
            <span className={`ml-auto text-xs px-1.5 py-0.5 rounded-full ${
              activeView === 'panoramica' ? 'bg-dr7-gold/20 text-dr7-gold' : 'bg-theme-bg-tertiary text-theme-text-muted'
            }`}>
              {stats.totalActive}
            </span>
          </button>

          <div className="border-b border-theme-border my-1" />

          {/* Categories */}
          {CATEGORY_KEYS.map(key => {
            const cat = CATEGORIES[key]
            const count = stats.byCategory[key]?.count || 0
            const isActive = activeView === key

            return (
              <button
                key={key}
                onClick={() => onNavigate(key)}
                className={`w-full text-left px-4 py-2.5 flex items-center gap-3 text-sm transition-colors ${
                  isActive
                    ? 'bg-dr7-gold/10 text-dr7-gold border-r-2 border-dr7-gold font-semibold'
                    : 'text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary'
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full ${DOT_COLORS[cat.color]} shrink-0`} />
                <span className="truncate">{cat.label.replace('Scadenze ', '')}</span>
                {count > 0 && (
                  <span className={`ml-auto text-xs px-1.5 py-0.5 rounded-full ${
                    isActive ? 'bg-dr7-gold/20 text-dr7-gold' : 'bg-theme-bg-tertiary text-theme-text-muted'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </nav>

      {/* Mobile horizontal pills */}
      <div className="md:hidden overflow-x-auto pb-3 mb-4 -mx-1">
        <div className="flex gap-2 px-1 min-w-max">
          {/* Panoramica pill */}
          <button
            onClick={() => onNavigate('panoramica')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              activeView === 'panoramica'
                ? 'bg-dr7-gold text-white'
                : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-dr7-gold" />
            Panoramica
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${
              activeView === 'panoramica' ? 'bg-black/20 text-black' : 'bg-theme-bg-hover text-theme-text-muted'
            }`}>
              {stats.totalActive}
            </span>
          </button>

          {CATEGORY_KEYS.map(key => {
            const cat = CATEGORIES[key]
            const count = stats.byCategory[key]?.count || 0
            const isActive = activeView === key

            return (
              <button
                key={key}
                onClick={() => onNavigate(key)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                  isActive
                    ? 'bg-dr7-gold text-white'
                    : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${DOT_COLORS[cat.color]}`} />
                {cat.label.replace('Scadenze ', '')}
                {count > 0 && (
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                    isActive ? 'bg-black/20 text-black' : 'bg-theme-bg-hover text-theme-text-muted'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}
