import { useMemo } from 'react'
import { useCodiceFiscaleCalculator, type CFFieldConfig } from '../hooks/useCodiceFiscaleCalculator'

interface CalcolaCFButtonProps {
  config: CFFieldConfig
  className?: string
}

export default function CalcolaCFButton({ config, className }: CalcolaCFButtonProps) {
  const { calcola, mode } = useCodiceFiscaleCalculator(config)

  const title = useMemo(() => {
    switch (mode) {
      case 'forward': return 'Calcola il Codice Fiscale dai dati anagrafici'
      case 'reverse': return 'Estrai dati anagrafici dal Codice Fiscale'
      case 'verify': return 'Verifica coerenza tra dati e Codice Fiscale'
      default: return 'Compila i dati anagrafici o il Codice Fiscale'
    }
  }, [mode])

  return (
    <button
      type="button"
      onClick={calcola}
      title={title}
      className={className || 'px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium rounded whitespace-nowrap transition-colors'}
    >
      Calcola
    </button>
  )
}
