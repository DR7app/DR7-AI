import { useState, useEffect, useRef } from 'react'

interface Customer {
    id: string
    full_name: string
    email: string | null
    phone: string | null
}

interface CustomerAutocompleteProps {
    customers: Customer[]
    selectedCustomerId: string
    onSelectCustomer: (customerId: string) => void
    placeholder?: string
    required?: boolean
}

export default function CustomerAutocomplete({
    customers,
    selectedCustomerId,
    onSelectCustomer,
    placeholder = 'Cerca cliente per nome, email o telefono...',
    required = true
}: CustomerAutocompleteProps) {
    const [searchQuery, setSearchQuery] = useState('')
    const [isOpen, setIsOpen] = useState(false)
    const [highlightedIndex, setHighlightedIndex] = useState(0)
    const inputRef = useRef<HTMLInputElement>(null)
    const dropdownRef = useRef<HTMLDivElement>(null)

    // Get selected customer
    const selectedCustomer = customers.find(c => c.id === selectedCustomerId)

    // Filter customers based on search query
    const filteredCustomers = customers.filter(customer => {
        if (!searchQuery.trim()) return true
        const query = searchQuery.toLowerCase()
        return (
            customer.full_name.toLowerCase().includes(query) ||
            customer.email?.toLowerCase().includes(query) ||
            customer.phone?.includes(query)
        )
    })

    // Update search query when customer is selected
    useEffect(() => {
        if (selectedCustomer && !isOpen) {
            setSearchQuery(selectedCustomer.full_name)
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
                className="w-full px-3 py-2 bg-gray-700 border border-theme-border-light rounded text-theme-text-primary placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white"
                autoComplete="off"
            />

            {/* Dropdown */}
            {isOpen && filteredCustomers.length > 0 && (
                <div
                    ref={dropdownRef}
                    className="absolute z-50 w-full mt-1 bg-theme-bg-tertiary border border-theme-border-light rounded-full shadow-lg max-h-60 overflow-y-auto"
                >
                    {filteredCustomers.map((customer, index) => (
                        <div
                            key={customer.id}
                            onClick={() => selectCustomer(customer)}
                            onMouseEnter={() => setHighlightedIndex(index)}
                            className={`px-3 py-2 cursor-pointer transition-colors ${index === highlightedIndex
                                ? 'bg-white text-black'
                                : 'text-theme-text-primary hover:bg-theme-bg-hover'
                                }`}
                        >
                            <div className="font-semibold">{customer.full_name}</div>
                            <div className="text-xs opacity-75">
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
                    className="absolute z-50 w-full mt-1 bg-theme-bg-tertiary border border-theme-border-light rounded-full shadow-lg px-3 py-2"
                >
                    <div className="text-theme-text-muted text-sm">Nessun cliente trovato</div>
                </div>
            )}

            {/* Hidden input for form validation */}
            <input
                type="hidden"
                value={selectedCustomerId}
                required={required}
            />
        </div>
    )
}
