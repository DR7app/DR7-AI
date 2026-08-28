import { useState, useRef, useEffect, useCallback } from 'react'

interface NominatimResult {
  place_id: number
  display_name: string
  /** Nominatim returns coords as strings — convert to number when used. */
  lat?: string
  lon?: string
  address?: {
    road?: string
    house_number?: string
    postcode?: string
    city?: string
    town?: string
    village?: string
    municipality?: string
    state?: string
    county?: string
    country?: string
  }
}

export interface AddressParts {
  street: string
  city: string
  zip: string
  province: string
  full: string
  lat?: number
  lon?: number
}

interface AddressAutocompleteProps {
  value: string
  onChange: (value: string) => void
  /** Called with structured address parts (incl. coords) when a suggestion is selected */
  onSelectParts?: (parts: AddressParts) => void
  /** Chiamato all'uscita dal campo col testo scritto a mano: permette a chi
   *  usa il componente di completarlo (es. CAP dal comune riconosciuto). */
  onBlurComplete?: (value: string) => void
  placeholder?: string
  className?: string
  label?: string
  required?: boolean
  disabled?: boolean
}

export default function AddressAutocomplete({
  value,
  onChange,
  onSelectParts,
  onBlurComplete,
  placeholder = 'Via, Numero Civico, CAP, Città',
  className = '',
  label,
  required,
  disabled,
}: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(-1)
  // 2026-05-29: stato esplicito della ricerca. Prima ogni errore/0-risultati
  // veniva inghiottito (`if (!res.ok) return` + `catch {}`), quindi quando
  // Nominatim rifiutava/limitava la richiesta il menu restava vuoto senza
  // alcun messaggio → l'utente vedeva "nessun indirizzo trovato" senza capire
  // il perche'. Ora distinguiamo loading / vuoto / errore e lo mostriamo.
  const [status, setStatus] = useState<'idle' | 'loading' | 'empty' | 'error'>('idle')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const skipFetchRef = useRef(false)

  const fetchSuggestions = useCallback(async (query: string) => {
    if (query.length < 3) {
      setSuggestions([])
      setStatus('idle')
      setIsOpen(false)
      return
    }
    setStatus('loading')
    setIsOpen(true)
    try {
      // 2026-08-14: ancoraggio geografico sulla SARDEGNA.
      //
      // Senza, la ricerca era inutilizzabile sui luoghi con un nome comune.
      // "Marina Piccola" esiste ad Ardea, Sorrento, Capri, Arenzano, Bari...
      // e Nominatim restituiva quelle: la Marina Piccola di Cagliari — che e'
      // il porto da cui partono le barche — non entrava nemmeno nei primi 5
      // risultati. L'operatore concludeva che "non la trova".
      //
      // `viewbox` senza `bounded=1` e' una PREFERENZA, non un filtro: i
      // risultati sardi salgono in cima, ma un indirizzo a Milano o a Roma
      // si trova ancora (serve per le consegne fuori isola).
      // Riquadro: tutta la Sardegna, non solo Cagliari, cosi' Olbia, Sassari
      // e Alghero funzionano allo stesso modo.
      const VIEWBOX_SARDEGNA = '8.10,41.30,9.90,38.80'
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&addressdetails=1&limit=5&countrycodes=it&viewbox=${VIEWBOX_SARDEGNA}`,
        { headers: { 'Accept-Language': 'it' } }
      )
      if (!res.ok) {
        // 429 = rate limit, 403 = endpoint che blocca l'uso autocomplete.
        console.warn(`[AddressAutocomplete] Nominatim HTTP ${res.status} per "${query}"`)
        setSuggestions([])
        setStatus('error')
        return
      }
      const data: NominatimResult[] = await res.json()
      setSuggestions(data)
      setStatus(data.length > 0 ? 'idle' : 'empty')
      setIsOpen(true)
      setHighlightIndex(-1)
    } catch (err) {
      // Rete bloccata / CORS / ad-blocker: mostra l'errore invece di sparire.
      console.warn('[AddressAutocomplete] ricerca indirizzo fallita:', err)
      setSuggestions([])
      setStatus('error')
    }
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    onChange(val)
    skipFetchRef.current = false
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (!skipFetchRef.current) fetchSuggestions(val)
    }, 300)
  }

  // 2026-08-27: il numero civico digitato non deve sparire.
  //
  // OSM non ha il civico per moltissime vie: cercando "Via Roma 15, Cagliari"
  // Nominatim risponde con il risultato a livello di STRADA (address.road
  // valorizzato, house_number assente). Selezionandolo il campo diventava
  // "Via Roma, 09124 Cagliari" e l'operatore non riusciva piu' a mettere il
  // civico (ogni tentativo veniva riscritto alla selezione successiva).
  // Se il civico e' nel testo digitato e il risultato scelto e' una via senza
  // house_number, lo riportiamo noi nel testo formattato. La distanza resta
  // calcolata sul centro della via: differenza irrilevante per il costo di
  // consegna.
  const houseNumberFromQuery = (query: string): string => {
    const tokens = query.split(/[\s,]+/).filter(Boolean)
    // 5 cifre = CAP, non un civico. Ammessi 12, 12A, 12/A.
    const candidates = tokens.filter(t => /^\d{1,4}[/-]?[A-Za-z]?$/.test(t) && !/^\d{5}$/.test(t))
    return candidates.length > 0 ? candidates[candidates.length - 1] : ''
  }

  const houseNumberFor = (result: NominatimResult, query: string): string => {
    const a = result.address
    if (!a) return ''
    if (a.house_number) return a.house_number
    if (!a.road) return ''
    const typed = houseNumberFromQuery(query)
    if (!typed) return ''
    // "Via 4 Novembre": il numero fa parte del nome della via, non e' un civico.
    if (a.road.split(/[\s,]+/).some(t => t.toLowerCase() === typed.toLowerCase())) return ''
    return typed
  }

  const formatAddress = (result: NominatimResult, query = ''): string => {
    const a = result.address
    if (!a) return result.display_name
    const parts: string[] = []
    const houseNum = houseNumberFor(result, query)
    if (a.road) parts.push(houseNum ? `${a.road} ${houseNum}` : a.road)
    const city = a.city || a.town || a.village || a.municipality || ''
    if (a.postcode && city) parts.push(`${a.postcode} ${city}`)
    else if (city) parts.push(city)
    if (a.state) parts.push(a.state)
    return parts.length > 0 ? parts.join(', ') : result.display_name
  }

  const extractParts = (result: NominatimResult, query = ''): AddressParts => {
    const a = result.address || {}
    const road = a.road || ''
    const houseNum = houseNumberFor(result, query)
    const street = houseNum ? `${road} ${houseNum}` : road
    const city = a.city || a.town || a.village || a.municipality || ''
    const zip = a.postcode || ''
    const province = a.county || a.state || ''
    const lat = result.lat ? parseFloat(result.lat) : undefined
    const lon = result.lon ? parseFloat(result.lon) : undefined
    return {
      street,
      city,
      zip,
      province,
      full: formatAddress(result, query),
      lat: Number.isFinite(lat) ? lat : undefined,
      lon: Number.isFinite(lon) ? lon : undefined,
    }
  }

  const handleSelect = (result: NominatimResult) => {
    skipFetchRef.current = true
    // `value` e' ancora il testo digitato dall'operatore: e' li' che sta il
    // civico quando OSM non ce l'ha.
    const typedQuery = value
    const formatted = formatAddress(result, typedQuery)
    onChange(formatted)
    if (onSelectParts) onSelectParts(extractParts(result, typedQuery))
    setSuggestions([])
    setStatus('idle')
    setIsOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIndex(prev => (prev > 0 ? prev - 1 : suggestions.length - 1))
    } else if (e.key === 'Enter' && highlightIndex >= 0) {
      e.preventDefault()
      handleSelect(suggestions[highlightIndex])
    } else if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [])

  const inputClass = className || 'w-full px-3 py-2 min-h-[44px] bg-theme-bg-primary border border-dr7-gold/30 rounded text-base sm:text-sm text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors'

  return (
    <div ref={containerRef} className="relative">
      {label && <label className="block text-sm font-medium text-theme-text-primary mb-2">{label}</label>}
      <input
        type="text"
        value={value}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (suggestions.length > 0) setIsOpen(true) }}
        onBlur={(e) => { if (onBlurComplete) onBlurComplete(e.target.value) }}
        placeholder={placeholder}
        className={inputClass}
        required={required}
        disabled={disabled}
        autoComplete="off"
      />
      {isOpen && suggestions.length === 0 && status !== 'idle' && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-theme-bg-primary border border-theme-border rounded-lg shadow-2xl px-4 py-3 text-sm">
          {status === 'loading' && <span className="text-theme-text-muted">Ricerca indirizzo…</span>}
          {status === 'empty' && <span className="text-theme-text-muted">Nessun indirizzo trovato. Controlla l&apos;ortografia (la ricerca non corregge i refusi), oppure prova con la sola città — es. &quot;Cagliari&quot;.</span>}
          {status === 'error' && <span className="text-amber-400">Ricerca indirizzi non disponibile (servizio mappe bloccato o limitato). Inserisci città e costo manualmente.</span>}
        </div>
      )}
      {isOpen && suggestions.length > 0 && (
        <ul className="absolute z-50 left-0 right-0 mt-1 bg-theme-bg-primary border border-theme-border rounded-lg shadow-2xl max-h-60 overflow-y-auto">
          {suggestions.map((result, i) => (
            <li
              key={result.place_id}
              onClick={() => handleSelect(result)}
              onMouseEnter={() => setHighlightIndex(i)}
              className={`px-4 py-3 text-sm cursor-pointer transition-colors border-b border-theme-border/30 last:border-0 ${
                i === highlightIndex
                  ? 'bg-blue-600/20 border-l-4 border-l-blue-500'
                  : 'hover:bg-theme-bg-secondary/50 border-l-4 border-l-transparent'
              }`}
            >
              <span className="text-theme-text-primary">{formatAddress(result, value)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
