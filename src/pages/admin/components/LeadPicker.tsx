import { useState, useEffect, useMemo } from 'react'

// Classe input condivisa (identica a NoleggioServiceTab INPUT_CLS).
const INPUT_CLS = 'px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary text-sm w-full placeholder:text-theme-text-muted focus:outline-none focus:border-dr7-gold'

// Selettore cliente dai Lead (tabella `customers`): cerca per nome/telefono/
// email e richiama onPick(nome, telefono). Usato in Prenotazioni, Preventivi e
// nel form Lavaggi/Meccanica (Prime Wash).
export interface Lead { id: string; name: string; phone: string; email: string }
// Stessa sorgente della tab Clienti: customers_extended via /.netlify/functions/
// list-customers (service role, bypassa RLS, paginato = TUTTI i clienti). Niente
// query diretta su `customers` (mostrava solo un sottoinsieme).
export async function fetchLeads(): Promise<Lead[]> {
  try {
    const res = await fetch('/.netlify/functions/list-customers')
    const json = await res.json()
    const rows: Record<string, unknown>[] = json?.customers || []
    return rows.map((c, i) => {
      const g = (k: string) => (c[k] == null ? '' : String(c[k])).trim()
      const name = g('full_name') || `${g('nome') || g('first_name')} ${g('cognome') || g('last_name')}`.trim() || g('ragione_sociale') || g('denominazione')
      const phone = g('telefono') || g('phone') || g('mobile') || g('cellulare')
      return { id: g('id') || g('user_id') || `lead-${i}`, name, phone, email: g('email') }
    }).filter(l => l.name || l.phone || l.email)
  } catch {
    return []
  }
}

export function LeadPicker({ onPick, initialQuery = '', label = 'Seleziona cliente dai Lead', placeholder = 'Cerca un cliente per nome, telefono o email…', onQueryChange }: { onPick: (name: string, phone: string, id?: string) => void; initialQuery?: string; label?: string; placeholder?: string; onQueryChange?: (q: string) => void }) {
  const [leads, setLeads] = useState<Lead[]>([])
  const [query, setQuery] = useState(initialQuery)
  const [open, setOpen] = useState(false)
  useEffect(() => { setQuery(initialQuery) }, [initialQuery])
  useEffect(() => {
    let cancelled = false
    fetchLeads().then(ls => { if (!cancelled) setLeads(ls) })
    return () => { cancelled = true }
  }, [])
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return leads.slice(0, 8)
    return leads.filter(l =>
      l.name.toLowerCase().includes(q) ||
      l.phone.toLowerCase().includes(q) ||
      l.email.toLowerCase().includes(q)
    ).slice(0, 8)
  }, [leads, query])
  return (
    <div className="relative">
      {label !== '' && <label className="text-xs text-theme-text-muted">{label} {leads.length > 0 && <span className="text-theme-text-muted/70">({leads.length})</span>}</label>}
      <input
        className={INPUT_CLS}
        placeholder={placeholder}
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); onQueryChange?.(e.target.value) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && matches.length > 0 && (
        <div className="absolute z-30 mt-1 w-full max-h-64 overflow-auto bg-theme-bg-secondary border border-theme-border rounded-lg shadow-lg">
          {matches.map((l, i) => (
            <button
              key={`${l.id}-${i}`}
              type="button"
              onMouseDown={e => { e.preventDefault(); onPick(l.name, l.phone, l.id); setQuery(l.name); setOpen(false) }}
              className="w-full text-left px-3 py-2 hover:bg-theme-bg-hover border-b border-theme-border last:border-0"
            >
              <div className="text-sm text-theme-text-primary">{l.name || '(senza nome)'}</div>
              <div className="text-xs text-theme-text-muted">{[l.phone, l.email].filter(Boolean).join(' · ') || '—'}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
