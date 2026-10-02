import { forwardRef, type InputHTMLAttributes } from 'react'

// 02/10/2026: una sola barra di ricerca per tutto il gestionale. Prima ogni
// tab aveva la sua (Clienti grande con lente, Timeline piccola senza lente,
// Lavaggi con il bordo azzurro...). Cambiare lo stile qui lo cambia ovunque.
//   grande   -> sopra le liste (Clienti, Veicoli, DR7 Trust...)
//   compatta -> nelle barre degli strumenti (calendari, filtri accanto ad altri bottoni)
// La larghezza si passa con className (es. "w-64", "flex-1"); di base occupa tutta la riga.

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'size' | 'className'> & {
  value: string
  onChange: (testo: string) => void
  variante?: 'grande' | 'compatta'
  className?: string
}

const BarraRicerca = forwardRef<HTMLInputElement, Props>(function BarraRicerca(
  { value, onChange, variante = 'grande', className = 'w-full', placeholder = 'Cerca...', ...resto },
  ref,
) {
  const compatta = variante === 'compatta'
  return (
    <div className={`relative ${className}`}>
      <svg
        className={`absolute top-1/2 -translate-y-1/2 text-theme-text-muted pointer-events-none ${compatta ? 'left-2.5 w-4 h-4' : 'left-3 w-5 h-5'}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full bg-theme-bg-tertiary border border-theme-border rounded-full text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-dr7-gold focus:border-transparent ${compatta ? 'pl-8 pr-8 py-1.5 text-sm' : 'pl-10 pr-10 py-3'}`}
        {...resto}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className={`absolute top-1/2 -translate-y-1/2 text-theme-text-muted hover:text-theme-text-primary ${compatta ? 'right-2.5' : 'right-3'}`}
          aria-label="Pulisci ricerca"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
})

export default BarraRicerca
