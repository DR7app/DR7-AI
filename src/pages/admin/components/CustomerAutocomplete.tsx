import { useState, useEffect, useRef } from 'react'
import ClientStatusBadge from '../../../components/ClientStatusBadge'
import ClientCardInfoModal from './ClientCardInfoModal'

interface Customer {
    id: string
    full_name: string
    email: string | null
    phone: string | null
    scadenza_patente?: string | null
    user_id?: string | null
}

interface CustomerAutocompleteProps {
    customers: Customer[]
    selectedCustomerId: string
    onSelectCustomer: (customerId: string) => void
    placeholder?: string
    required?: boolean
    showCardInfoOnSelect?: boolean
}

export default function CustomerAutocomplete({
    customers,
    selectedCustomerId,
    onSelectCustomer,
    placeholder = 'Cerca cliente per nome, email o telefono...',
    required = true,
    showCardInfoOnSelect = false
}: CustomerAutocompleteProps) {
    const [cardInfoCustomerId, setCardInfoCustomerId] = useState<string | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [isOpen, setIsOpen] = useState(false)
    const [highlightedIndex, setHighlightedIndex] = useState(0)
    const inputRef = useRef<HTMLInputElement>(null)
    const dropdownRef = useRef<HTMLDivElement>(null)

    // Get selected customer
    const selectedCustomer = customers.find(c => c.id === selectedCustomerId)

    // Filter customers based on search query
    // Deduplicate customers by email (or name if no email) — keep first occurrence
    const deduped = (() => {
        const seen = new Set<string>()
        return customers.filter(c => {
            const key = (c.email || c.full_name || c.id).toLowerCase().trim()
            if (seen.has(key)) return false
            seen.add(key)
            return true
        })
    })()

    const filteredCustomers = deduped.filter(customer => {
        if (!searchQuery.trim()) return true
        const words = searchQuery.toLowerCase().split(/\s+/).filter(Boolean)
        const name = customer.full_name.toLowerCase()
        const email = customer.email?.toLowerCase() || ''
        const phone = customer.phone || ''
        return words.every(word =>
            name.includes(word) || email.includes(word) || phone.includes(word)
        )
    })

    // Update search query when customer is selected
    // CRITICAL FIX: Always sync search query with selected customer name
    // This ensures the name displays correctly when editing a booking
    useEffect(() => {
        if (selectedCustomer) {
            setSearchQuery(selectedCustomer.full_name)
        } else if (!isOpen) {
            // Only clear when dropdown is closed and no customer is selected
            setSearchQuery('')
        }
    }, [selectedCustomer, isOpen])

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(event.target as Node) &&
                inputRef.current &&
                !inputRef.current.contains(event.target as Node)
            ) {
                setIsOpen(false)
                // Restore selected customer name if exists
                if (selectedCustomer) {
                    setSearchQuery(selectedCustomer.full_name)
                }
            }
        }

        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [selectedCustomer])

    // Handle keyboard navigation
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!isOpen) {
            if (e.key === 'ArrowDown' || e.key === 'Enter') {
                setIsOpen(true)
                e.preventDefault()
            }
            return
        }

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault()
                setHighlightedIndex(prev =>
                    prev < filteredCustomers.length - 1 ? prev + 1 : prev
                )
                break
            case 'ArrowUp':
                e.preventDefault()
                setHighlightedIndex(prev => (prev > 0 ? prev - 1 : 0))
                break
            case 'Enter':
                e.preventDefault()
                if (filteredCustomers[highlightedIndex]) {
                    selectCustomer(filteredCustomers[highlightedIndex])
                }
                break
            case 'Escape':
                e.preventDefault()
                setIsOpen(false)
                if (selectedCustomer) {
                    setSearchQuery(selectedCustomer.full_name)
                }
                break
        }
    }

    const selectCustomer = (customer: Customer) => {
        onSelectCustomer(customer.id)
        setSearchQuery(customer.full_name)
        setIsOpen(false)
        setHighlightedIndex(0)
        if (showCardInfoOnSelect) {
            setCardInfoCustomerId(customer.id)
        }
    }

    const handleInputChange = (value: string) => {
        setSearchQuery(value)
        setIsOpen(true)
        setHighlightedIndex(0)

        // Clear selection if user is typing
        if (selectedCustomerId && value !== selectedCustomer?.full_name) {
            onSelectCustomer('')
        }
    }

    return (
        <div className="relative">
            <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => handleInputChange(e.target.value)}
                onFocus={() => setIsOpen(true)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                required={required}
                className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-white"
                autoComplete="off"
            />

            {/* Dropdown */}
            {isOpen && filteredCustomers.length > 0 && (
                <div
                    ref={dropdownRef}
                    className="absolute z-50 w-full mt-1 bg-theme-bg-primary border border-theme-border rounded-lg shadow-2xl max-h-60 overflow-y-auto"
                    style={{ backdropFilter: 'blur(10px)' }}
                >
                    {filteredCustomers.map((customer, index) => (
                        <div
                            key={customer.id}
                            onClick={() => selectCustomer(customer)}
                            onMouseEnter={() => setHighlightedIndex(index)}
                            className={`px-4 py-3 cursor-pointer transition-all duration-150 border-b border-theme-border/30 last:border-b-0 ${index === highlightedIndex
                                ? 'bg-blue-600/20 border-l-4 border-l-blue-500'
                                : 'hover:bg-theme-bg-secondary/50 border-l-4 border-l-transparent'
                                }`}
                        >
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-theme-text-primary">{customer.full_name}</span>
                                <ClientStatusBadge
                                    customerId={customer.id}
                                    userId={customer.user_id}
                                    email={customer.email}
                                    phone={customer.phone}
                                />
                                {customer.scadenza_patente && new Date(customer.scadenza_patente) < new Date() && (
                                    <span className="px-1.5 py-0.5 bg-red-500/20 border border-red-500/40 rounded text-[10px] font-bold text-red-400 uppercase whitespace-nowrap">Patente scaduta</span>
                                )}
                            </div>
                            <div className="text-xs text-theme-text-muted mt-0.5">
                                {customer.email || customer.phone || 'N/A'}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* No results message */}
            {isOpen && searchQuery && filteredCustomers.length === 0 && (
                <div
                    ref={dropdownRef}
                    className="absolute z-50 w-full mt-1 bg-theme-bg-secondary border border-theme-border-light rounded shadow-lg px-3 py-2"
                >
                    <div className="text-theme-text-muted text-sm">Nessun cliente trovato</div>
                </div>
            )}

            {/* Selected client status indicator */}
            {selectedCustomer && !isOpen && (
                <div className="mt-1.5 flex items-center gap-2 text-xs text-theme-text-muted">
                    <span>Stato cliente:</span>
                    <ClientStatusBadge
                        customerId={selectedCustomer.id}
                        userId={selectedCustomer.user_id}
                        email={selectedCustomer.email}
                        phone={selectedCustomer.phone}
                        size="md"
                    />
                </div>
            )}

            {/* Hidden input for form validation */}
            <input
                type="hidden"
                value={selectedCustomerId}
                required={required}
            />

            {showCardInfoOnSelect && cardInfoCustomerId && (
                <ClientCardInfoModal
                    customerId={cardInfoCustomerId}
                    onClose={() => setCardInfoCustomerId(null)}
                />
            )}
        </div>
    )
}
