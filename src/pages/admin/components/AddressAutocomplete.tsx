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
  placeholder?: string
  className?: string
  label?: string
  required?: boolean
}

export default function AddressAutocomplete({
  value,
  onChange,
  onSelectParts,
  placeholder = 'Via, Numero Civico, CAP, Città',
  className = '',
  label,
  required,
}: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const skipFetchRef = useRef(false)

  const fetchSuggestions = useCallback(async (query: string) => {
    if (query.length < 3) {
      setSuggestions([])
      setIsOpen(false)
      return
    }
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=5&countrycodes=it`,
        { headers: { 'Accept-Language': 'it' } }
      )
      if (!res.ok) return
      const data: NominatimResult[] = await res.json()
      setSuggestions(data)
      setIsOpen(data.length > 0)
      setHighlightIndex(-1)
    } catch {
      // Silently fail — user can still type manually
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

  const formatAddress = (result: NominatimResult): string => {
    const a = result.address
    if (!a) return result.display_name
    const parts: string[] = []
    if (a.road) parts.push(a.house_number ? `${a.road} ${a.house_number}` : a.road)
    const city = a.city || a.town || a.village || a.municipality || ''
    if (a.postcode && city) parts.push(`${a.postcode} ${city}`)
    else if (city) parts.push(city)
    if (a.state) parts.push(a.state)
    return parts.length > 0 ? parts.join(', ') : result.display_name
  }

  const extractParts = (result: NominatimResult): AddressParts => {
    const a = result.address || {}
    const road = a.road || ''
    const houseNum = a.house_number || ''
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
      full: formatAddress(result),
      lat: Number.isFinite(lat) ? lat : undefined,
      lon: Number.isFinite(lon) ? lon : undefined,
    }
  }

  const handleSelect = (result: NominatimResult) => {
    skipFetchRef.current = true
    const formatted = formatAddress(result)
    onChange(formatted)
    if (onSelectParts) onSelectParts(extractParts(result))
    setSuggestions([])
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
        placeholder={placeholder}
        className={inputClass}
        required={required}
        autoComplete="off"
      />
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
              <span className="text-theme-text-primary">{formatAddress(result)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
