import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import Button from './Button'
import NewClientModal from './NewClientModal'

interface Customer {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  driver_license_number: string | null
  notes: string | null
  created_at: string
  updated_at: string
  status?: 'blacklist' | 'has_rental' | 'vip' | null
  verification?: {
    idStatus: 'unverified' | 'pending' | 'verified'
    stripeVerificationSessionId?: string
    verifiedAt?: string
  }
  // Extended customer fields from customers_extended table
  tipo_cliente?: 'persona_fisica' | 'azienda' | 'pubblica_amministrazione'
  source?: string
  // Persona Fisica fields
  nome?: string
  cognome?: string
  codice_fiscale?: string
  sesso?: string
  patente?: string
  indirizzo?: string
  pec?: string
  data_nascita?: string
  luogo_nascita?: string
  provincia_nascita?: string
  numero_civico?: string
  codice_postale?: string
  citta_residenza?: string
  provincia_residenza?: string
  tipo_patente?: string
  emessa_da?: string
  data_rilascio_patente?: string
  scadenza_patente?: string
  numero_patente?: string
  // Azienda fields
  ragione_sociale?: string
  denominazione?: string
  partita_iva?: string
  codice_destinatario?: string
  indirizzo_azienda?: string
  indirizzo_ddt?: string
  contatti_cliente?: string
  // Pubblica Amministrazione fields
  codice_ipa?: string
  codice_univoco?: string
  codice_fiscale_pa?: string
  ente_ufficio?: string
  indirizzo_pa?: string
  citta?: string
  // Common fields
  nazione?: string
  telefono?: string
  residency_zone?: string
  // Membership fields
  membership_tier?: 'Argento' | 'Oro' | 'Platino' | null
  membership_expires_at?: string | null
  active_membership?: any // populated from customer_memberships table
  // Metadata for extended fields
  metadata?: {
    sesso?: string
    provincia_nascita?: string
    patente?: {
      numero?: string
      tipo?: string
      ente?: string
      rilascio?: string
      scadenza?: string
    }
    sede_operativa?: string
    rappresentante?: {
      nome?: string
      cognome?: string
      cf?: string
      ruolo?: string
      documento?: {
        tipo?: string
        numero?: string
        rilascio?: string
        scadenza?: string
        luogo?: string
      }
    }
  }
}

export default function CustomersTab() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)

  const [viewingDocuments, setViewingDocuments] = useState<Customer | null>(null)
  const [documentsUrls, setDocumentsUrls] = useState<{
    licenses: Array<{ url: string; fileName: string }>;
    ids: Array<{ url: string; fileName: string }>;
    codiceFiscale: Array<{ url: string; fileName: string }>
  }>({ licenses: [], ids: [], codiceFiscale: [] })
  const [loadingDocuments, setLoadingDocuments] = useState(false)
  const [uploadingLicense, setUploadingLicense] = useState(false)
  const [uploadingId, setUploadingId] = useState(false)
  const [uploadingCodiceFiscale, setUploadingCodiceFiscale] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showNewClientModal, setShowNewClientModal] = useState(false)
  const [viewingCustomerDetails, setViewingCustomerDetails] = useState<Customer | null>(null)

  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)

  // Gift Voucher feature
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<Set<string>>(new Set())

  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const [totalCustomers, setTotalCustomers] = useState(0)
  const CUSTOMERS_PER_PAGE = 30

  const [allCustomers, setAllCustomers] = useState<Customer[]>([])

  useEffect(() => {
    loadCustomers()
  }, [])

  // Reset to page 1 when search query changes
  useEffect(() => {
    if (searchQuery) {
      setCurrentPage(1)
    }
  }, [searchQuery])

  // Handle filtering and pagination locally
  useEffect(() => {
    if (!allCustomers.length) return

    let result = [...allCustomers]

    // 1. Sort alphabetically by full_name (A-Z)
    result.sort((a, b) => {
      const nameA = a.full_name.toLowerCase()
      const nameB = b.full_name.toLowerCase()
      return nameA.localeCompare(nameB, 'it')
    })

    // 2. Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = result.filter((customer) => {
        // Build full name from nome + cognome if full_name doesn't exist
        const fullName = customer.full_name || `${customer.nome || ''} ${customer.cognome || ''}`.trim()

        return (
          fullName.toLowerCase().includes(query) ||
          customer.email?.toLowerCase().includes(query) ||
          customer.phone?.toLowerCase().includes(query) ||
          customer.nome?.toLowerCase().includes(query) ||
          customer.cognome?.toLowerCase().includes(query) ||
          customer.ragione_sociale?.toLowerCase().includes(query) ||
          customer.denominazione?.toLowerCase().includes(query) ||
          customer.telefono?.toLowerCase().includes(query)
        )
      })
    }

    // Update total count
    setTotalCustomers(result.length)

    // 3. Apply pagination
    const from = (currentPage - 1) * CUSTOMERS_PER_PAGE
    const to = from + CUSTOMERS_PER_PAGE
    const paginatedCustomers = result.slice(from, to)

    setCustomers(paginatedCustomers)

    // Only log if we have data to avoid spamming console on initial render
    if (paginatedCustomers.length > 0) {
      console.log('[CustomersTab] Updated view:', {
        total: result.length,
        page: currentPage,
        displayed: paginatedCustomers.length
      })
    }

  }, [allCustomers, searchQuery, currentPage])

  async function loadCustomers() {
    setLoading(true)
    try {
      console.log('[CustomersTab] Loading customers from DB...')

      // Check current user
      const { data: { user } } = await supabase.auth.getUser()
      console.log('[CustomersTab] Current user:', user?.email)

      // Get unique customers from bookings table (primary source of customer data)
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select('customer_name, customer_email, customer_phone, user_id, booked_at, booking_details')
        .order('booked_at', { ascending: false })


      if (bookingsError) {
        console.error('[CustomersTab] Could not load customers from bookings:', bookingsError)
      }

      // Merge customers by email or phone
      const customerMap = new Map<string, Customer>()
      const collisionCounter: Record<string, number> = {}

      // Process bookings data to create unique customer entries
      if (bookingsData) {
        console.log('Total bookings:', bookingsData.length)
        console.log('Top Collisions:', Object.entries(collisionCounter).filter(([, v]) => v > 1).sort((a, b) => b[1] - a[1]).slice(0, 5))
        bookingsData.forEach((booking: any) => {
          // Extract customer data from booking_details if available
          const details = booking.booking_details?.customer || {}

          // Get customer info from direct columns or booking_details
          const customerName = booking.customer_name || details.fullName || 'Cliente'
          // CRITICAL FIX: Normalize email and phone to ensure keys match with customers_extended
          const customerEmail = (booking.customer_email || details.email || '').toLowerCase().trim() || null
          const customerPhone = (booking.customer_phone || details.phone || '').trim() || null

          // Debug log
          if (!customerPhone && !customerEmail) {
            console.log('Missing contact info for:', {
              customerName,
              booking_details: booking.booking_details
            })
          }

          // Use email as primary key for merging, fallback to phone or user_id
          const key = customerEmail || customerPhone || booking.user_id

          if (key) {
            // ... existing logic ...
            const existing = customerMap.get(key)
            if (existing) {
              if (!existing.phone && customerPhone) {
                existing.phone = customerPhone
              }
              if (!existing.email && customerEmail) {
                existing.email = customerEmail
              }
              if (existing.full_name === 'Cliente' && customerName) {
                existing.full_name = customerName
              }
            } else {
              // Create new customer entry - use user_id if valid, otherwise generate temp ID
              const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
              const customerId = (booking.user_id && uuidRegex.test(booking.user_id))
                ? booking.user_id
                : `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

              customerMap.set(key, {
                id: customerId,
                full_name: customerName,
                email: customerEmail,
                phone: customerPhone,
                driver_license_number: null,
                notes: null,
                created_at: booking.booked_at,
                updated_at: booking.booked_at
              })
            }
          }
        })
        console.log('Unique customers from bookings:', customerMap.size)
      }

      // Get customers from customers_extended table
      console.log('[CustomersTab] Fetching customers_extended...')

      // We'll set total count after loading from all sources

      // Fetch all customers (we'll paginate client-side for proper alphabetical sorting)
      // CRITICAL FIX: Sort by updated_at so we get the most recently modified version when deduplicating
      const { data: customersExtendedData, error: customersExtendedError } = await supabase
        .from('customers_extended')
        .select('*')
        .order('updated_at', { ascending: false })

      if (customersExtendedError) {
        console.error('[CustomersTab] ❌ ERROR loading customers_extended:', customersExtendedError)
        console.error('[CustomersTab] Error code:', customersExtendedError.code)
        console.error('[CustomersTab] Error message:', customersExtendedError.message)

        // @ts-ignore
        console.error('[CustomersTab] Error hint:', customersExtendedError.hint)

        // Show user-friendly error message
        if (customersExtendedError.code === '42501') {
          console.warn('[CustomersTab] ⚠️ RLS policy blocking access. Run fix_customers_extended_rls.sql')
        } else if (customersExtendedError.code === '42P01') {
          console.warn('[CustomersTab] ⚠️ Table does not exist. Run create-customers-extended-table.sql')
        }
      } else {
        console.log('[CustomersTab] ✅ Successfully loaded customers_extended:', customersExtendedData?.length)
      }

      // DEBUG: Log counts
      console.log('STATS:', {
        bookings: bookingsData?.length || 0,
        customers_extended: customersExtendedData?.length || 0,
        unique_map_size: customerMap.size
      })

      if (!customersExtendedError && customersExtendedData) {
        console.log('[CustomersTab] Customers from customers_extended:', customersExtendedData.length)
        // console.log('[CustomersTab] Sample customer:', customersExtendedData[0])

        // First, deduplicate customers_extended by ID to ensure we only process each once
        const seenIds = new Set<string>()

        customersExtendedData.forEach((customer: any) => {
          // Skip if we've already processed this ID
          if (seenIds.has(customer.id)) {
            console.warn('[CustomersTab] Skipping duplicate ID:', customer.id)
            return
          }
          seenIds.add(customer.id)

          // CRITICAL: We want to overwrite any existing "booking entry" that matches this customer's email or phone
          // because the DB record is the "real" one with the correct ID.

          let matchedKey: string | null = null;

          if (customer.email && customer.email.trim()) {
            const emailKey = customer.email.trim().toLowerCase()
            if (customerMap.has(emailKey)) matchedKey = emailKey
          }

          if (!matchedKey && customer.telefono && customer.telefono.trim()) {
            const phoneKey = customer.telefono.trim()
            if (customerMap.has(phoneKey)) matchedKey = phoneKey
          }

          // Determine the key we will use for this customer in the map
          // Ideally, we use the ID to be absolutely unique
          const canonicalKey = customer.id

          // Create display name based on customer type
          let fullName = 'Cliente'
          if (customer.tipo_cliente === 'persona_fisica') {
            fullName = `${customer.nome || ''} ${customer.cognome || ''}`.trim()
          } else if (customer.tipo_cliente === 'azienda') {
            fullName = customer.ragione_sociale || customer.denominazione || 'Azienda'
          } else if (customer.tipo_cliente === 'pubblica_amministrazione') {
            fullName = customer.ente_ufficio || customer.denominazione || 'Pubblica Amministrazione'
          }

          if (!fullName || fullName === 'Cliente') {
            fullName = `${customer.nome || ''} ${customer.cognome || ''}`.trim() ||
              customer.ragione_sociale ||
              customer.denominazione ||
              'Cliente'
          }

          const extendedData = {
            // We map the DB fields to our Customer interface
            // ... (preserve existing mapping logig) ...
            id: customer.id,
            full_name: fullName,
            email: customer.email,
            phone: customer.telefono,
            driver_license_number: customer.numero_patente,
            driver_license_expiry: customer.scadenza_patente,
            // Ensure created_at is preserved
            created_at: customer.created_at,
            updated_at: customer.updated_at || customer.created_at,
            notes: customer.note,
            source: 'db', // Flag to know this is from DB

            // Extended fields
            tipo_cliente: customer.tipo_cliente,
            codice_fiscale: customer.codice_fiscale,
            partita_iva: customer.partita_iva,
            ragione_sociale: customer.ragione_sociale,
            indirizzo: customer.indirizzo,
            citta: customer.citta,
            cap: customer.cap,
            data_nascita: customer.data_nascita,
            luogo_nascita: customer.luogo_nascita, // ensure mapped
            sesso: customer.sesso,

            // Licenses matches
            numero_patente: customer.numero_patente,
            rilasciata_da: customer.rilasciata_da,
            data_rilascio: customer.data_rilascio,
            scadenza_patente: customer.scadenza_patente,

            // Common
            nazione: customer.nazione,
            telefono: customer.telefono,
            // Additional fields
            citta_residenza: customer.citta_residenza,
            provincia_residenza: customer.provincia_residenza,
            codice_postale: customer.codice_postale,
            numero_civico: customer.numero_civico,
            // Membership
            membership_tier: customer.membership_tier,
            membership_expires_at: customer.membership_expires_at,
            status: customer.status
          }

          // INSERT the "Real" customer
          customerMap.set(canonicalKey, extendedData as any)

          // REMOVE any placeholder entries that were based on email or phone
          // This ensures we don't have duplicates (one real, one from booking with temp ID)
          if (matchedKey && matchedKey !== canonicalKey) {
            // console.log(`[CustomersTab] Replacing placeholder ${matchedKey} with DB record ${canonicalKey}`)
            customerMap.delete(matchedKey)
          }

          // Also check explicitly for email key again to be sure
          if (customer.email && customer.email.trim()) {
            const emailKey = customer.email.trim().toLowerCase()
            if (emailKey !== canonicalKey && customerMap.has(emailKey)) {
              customerMap.delete(emailKey)
            }
          }
        })

      }

      // [REMOVED] Legacy merge with 'customers' table which was causing data loss/bad merges
      /*
      const { data: customersData, error: customersError } = await supabase
        .from('customers')
        .select('*')
        .order('created_at', { ascending: false })
  
      if (!customersError && customersData) {
        customersData.forEach(c => {
          const key = c.email || c.phone || c.id
          if (key && !customerMap.has(key)) {
            customerMap.set(key, c)
          }
        })
      }
      */

      // [NEW] Fetch Customer Memberships
      console.log('[CustomersTab] Fetching customer_memberships...')
      const { data: membershipsData, error: membershipsError } = await supabase
        .from('customer_memberships')
        .select('*')
        .eq('status', 'active')
      // Let's fetch all active ones to show current package.
      // Ideally we fetch all and sort by date, but specifically we want the *active* one.

      if (!membershipsError && membershipsData) {
        console.log('[CustomersTab] Memberships found:', membershipsData.length)

        // Map memberships to customers
        const membershipMap = new Map()
        membershipsData.forEach((m: any) => {
          // If multiple active, take the one with latest start_date? Or just first.
          membershipMap.set(m.client_id, m)
        })

        // Iterate through all customers and attach membership if found
        customerMap.forEach((customer, key) => {
          if (customer.id && membershipMap.has(customer.id)) {
            const mem = membershipMap.get(customer.id)
            // We add a 'membership' object to the customer. 
            // Currently type definition has membership_tier (legacy?). 
            // Let's use a new field or map to existing if compatible, but I prefer explicit 'active_membership'
            // modifying the customer object in the map
            const updatedCustomer = {
              ...customer,
              active_membership: mem,
              // Also update legacy fields for compatibility if needed, but UI will use active_membership
              membership_tier: mem.package_name
            }
            customerMap.set(key, updatedCustomer)
          }
        })
      } else if (membershipsError) {
        // If table doesn't exist yet (404/42P01), ignore error prevents crashing
        if (membershipsError.code !== '42P01') {
          console.error('Error fetching memberships:', membershipsError)
        } else {
          console.warn('customer_memberships table missing, skipping.')
        }
      }

      // Check storage for documents (optimized to just check existence if possible, or skip if too slow)
      // For now, we'll skip the heavy storage listing and per-user fetching
      // The verification status should be in customers_extended or handled via specific queries when viewing a customer

      // Initial cleanup of loading state
      const customersArray = Array.from(customerMap.values())

      // Store all customers
      setAllCustomers(customersArray)

    } catch (error) {
      console.error('[CustomersTab] ❌ Failed to load customers:', error)
    } finally {
      setLoading(false)
    }
  }



  async function handleDelete(id: string) {
    if (!confirm('Sei sicuro di voler eliminare questo cliente?')) return

    try {
      // Try deleting from customers_extended first (likely the main table for detailed clients)
      const { error: extendedError } = await supabase
        .from('customers_extended')
        .delete()
        .eq('id', id)

      if (extendedError) {
        console.warn('Error deleting from customers_extended (might not exist or be a view):', extendedError)
      }

      // Also delete from 'customers' table for backward compatibility
      const { error } = await supabase
        .from('customers')
        .delete()
        .eq('id', id)

      if (error) throw error

      loadCustomers()
    } catch (error) {
      console.error('Failed to delete customer:', error)
      alert('Impossibile eliminare il cliente')
    }
  }



  async function handleEdit(customer: Customer) {
    console.log('[handleEdit] Customer object:', customer)
    console.log('[handleEdit] Customer ID:', customer.id)
    console.log('[handleEdit] Customer keys:', Object.keys(customer))

    // CRITICAL FIX: Fetch fresh data from database before opening edit modal
    // This ensures ALL fields are populated, not just the cached/merged data
    if (customer.id && customer.id.length > 10) {
      try {
        console.log('[handleEdit] 🔄 Fetching fresh data from customers_extended for ID:', customer.id)
        const { data: freshCustomerData, error } = await supabase
          .from('customers_extended')
          .select('*')
          .eq('id', customer.id)
          .single()

        if (error) {
          console.error('[handleEdit] ❌ Error fetching fresh customer data:', error)
          // Fallback to cached data if fetch fails
          setSelectedCustomer(customer)
        } else if (freshCustomerData) {
          console.log('[handleEdit] ✅ Fresh data loaded from DB:', freshCustomerData)
          console.log('[handleEdit] 📊 Fields in fresh data:', Object.keys(freshCustomerData))

          // Apply the same mapping logic as handleViewCustomerDetails to ensure consistent display
          const raw = freshCustomerData;

          // CRITICAL: Extract metadata JSONB field (some data is stored here)
          const metadata = raw.metadata || {};

          // Reconstruct full name
          let fullName = 'Cliente'
          if (raw.tipo_cliente === 'persona_fisica') {
            fullName = `${raw.nome || ''} ${raw.cognome || ''}`.trim()
          } else if (raw.tipo_cliente === 'azienda') {
            fullName = raw.ragione_sociale || raw.denominazione || 'Azienda'
          } else if (raw.tipo_cliente === 'pubblica_amministrazione') {
            fullName = raw.ente_ufficio || raw.denominazione || 'Pubblica Amministrazione'
          }

          if (!fullName || fullName === 'Cliente') {
            fullName = `${raw.nome || ''} ${raw.cognome || ''}`.trim() ||
              raw.ragione_sociale ||
              raw.denominazione ||
              'Cliente'
          }

          const freshCustomer: Customer = {
            // Start with cached customer to preserve any UI-only fields
            ...customer,
            // Overwrite with fresh DB data (this is the critical part)
            ...raw,
            // Explicit overrides for display fields
            id: raw.id,
            full_name: fullName,
            email: raw.email,
            phone: raw.telefono,
            telefono: raw.telefono,

            // CRITICAL FIX: Map ALL database columns to form field names
            // Persona Fisica fields
            nome: raw.nome,
            cognome: raw.cognome,
            codice_fiscale: raw.codice_fiscale,
            sesso: metadata.sesso || raw.sesso,  // Form prefers metadata.sesso (line 153)
            data_nascita: raw.data_nascita,

            // Birth location - form uses provincia_nascita from metadata (line 156)
            luogo_nascita: raw.luogo_nascita || raw.citta_nascita || raw.comune_nascita,
            citta_nascita: raw.citta_nascita || raw.luogo_nascita,
            provincia_nascita: metadata.provincia_nascita || raw.provincia_nascita,

            // Address fields - map from various possible column names
            indirizzo: raw.indirizzo || raw.sede_legale,
            numero_civico: raw.numero_civico,
            codice_postale: raw.codice_postale || raw.cap,
            cap: raw.cap || raw.codice_postale,
            citta_residenza: raw.citta_residenza || raw.citta || raw.comune,
            citta: raw.citta || raw.citta_residenza || raw.comune,
            comune: raw.comune || raw.citta || raw.citta_residenza,
            provincia_residenza: raw.provincia_residenza || raw.provincia,
            provincia: raw.provincia || raw.provincia_residenza,

            // Driver's license fields - form uses metadata.patente.* (lines 183-187)
            driver_license_number: metadata.patente?.numero || raw.numero_patente || raw.patente,
            numero_patente: metadata.patente?.numero || raw.numero_patente || raw.patente,
            patente: metadata.patente?.numero || raw.numero_patente || raw.patente,
            tipo_patente: metadata.patente?.tipo || raw.tipo_patente || raw.categoria_patente,
            categoria_patente: metadata.patente?.tipo || raw.categoria_patente || raw.tipo_patente,
            emessa_da: metadata.patente?.ente || raw.emessa_da || raw.rilasciata_da,
            rilasciata_da: metadata.patente?.ente || raw.rilasciata_da || raw.emessa_da,
            data_rilascio_patente: metadata.patente?.rilascio || raw.data_rilascio_patente || raw.data_rilascio,
            data_rilascio: metadata.patente?.rilascio || raw.data_rilascio || raw.data_rilascio_patente,
            scadenza_patente: metadata.patente?.scadenza || raw.scadenza_patente || raw.data_scadenza_patente,
            data_scadenza_patente: metadata.patente?.scadenza || raw.data_scadenza_patente || raw.scadenza_patente,

            // Company fields
            ragione_sociale: raw.ragione_sociale,
            partita_iva: raw.partita_iva,
            codice_destinatario: raw.codice_destinatario,
            sede_legale: raw.sede_legale || raw.indirizzo,
            indirizzo_azienda: raw.sede_legale || raw.indirizzo_azienda || raw.indirizzo,

            // Contact fields
            pec: raw.pec,
            nazione: raw.nazione,

            // Other fields
            note: raw.note || raw.notes,
            notes: raw.notes || raw.note,
            tipo_cliente: raw.tipo_cliente,
            source: raw.source,
            created_at: raw.created_at,
            updated_at: raw.updated_at,

            // Metadata (preserve if exists and add patente structure for form)
            metadata: {
              ...(raw.metadata || customer.metadata || {}),
              // Ensure patente object exists with all fields for form pre-filling
              patente: {
                numero: metadata.patente?.numero || raw.numero_patente || raw.patente || '',
                tipo: metadata.patente?.tipo || raw.tipo_patente || raw.categoria_patente || '',
                ente: metadata.patente?.ente || raw.emessa_da || raw.rilasciata_da || '',
                rilascio: metadata.patente?.rilascio || raw.data_rilascio_patente || raw.data_rilascio || '',
                scadenza: metadata.patente?.scadenza || raw.scadenza_patente || raw.data_scadenza_patente || ''
              }
            }
          }

          console.log('[handleEdit] 🎯 Passing fresh customer to modal:', freshCustomer)
          setSelectedCustomer(freshCustomer)
        }
      } catch (err) {
        console.error('[handleEdit] ❌ Exception fetching fresh data:', err)
        // Fallback to cached data
        setSelectedCustomer(customer)
      }
    } else {
      // No valid ID, use cached data (shouldn't happen for real customers)
      console.warn('[handleEdit] ⚠️ No valid customer ID, using cached data')
      setSelectedCustomer(customer)
    }

    setShowNewClientModal(true)
  }

  async function fetchCustomerDocuments(userId: string) {
    setLoadingDocuments(true)
    setDocumentsUrls({ licenses: [], ids: [], codiceFiscale: [] })

    try {
      console.log('[CustomersTab] Fetching documents via Netlify function for:', userId)
      const response = await fetch('/.netlify/functions/get-customer-documents', {
        method: 'POST',
        body: JSON.stringify({ userId }),
        headers: { 'Content-Type': 'application/json' }
      })

      if (!response.ok) {
        throw new Error(`Function failed with status ${response.status}`)
      }

      const result = await response.json()

      if (result.success && result.documents) {
        console.log('[CustomersTab] Documents loaded:', result.documents)
        setDocumentsUrls(result.documents)
      } else {
        console.error('[CustomersTab] Failed to load documents:', result.error)
      }
    } catch (error) {
      console.error('[CustomersTab] Error fetching documents:', error)
    } finally {
      setLoadingDocuments(false)
    }
  }

  async function handleViewDocuments(customer: Customer) {
    setViewingDocuments(customer)
    if (customer.id && customer.id.length > 10) {
      await fetchCustomerDocuments(customer.id)
    }
  }

  async function handleViewCustomerDetails(customer: Customer) {
    // Fetch fresh data from database to ensure all fields are populated
    if (customer.id && customer.id.length > 10) {
      try {
        const { data: freshCustomerData, error } = await supabase
          .from('customers_extended')
          .select('*')
          .eq('id', customer.id)
          .single()

        if (error) {
          console.error('Error fetching fresh customer data:', error)
          // Fallback to cached data if fetch fails
          setViewingCustomerDetails(customer)
        } else if (freshCustomerData) {
          console.log('[handleViewCustomerDetails] Raw DB Fetch:', freshCustomerData)
          console.log('[handleViewCustomerDetails] CF from DB:', freshCustomerData.codice_fiscale)
          console.log('[handleViewCustomerDetails] Indirizzo from DB:', freshCustomerData.indirizzo)

          // Apply the same mapping logic as loadCustomers to ensure consistent display
          const raw = freshCustomerData;

          // Reconstruct full name
          let fullName = 'Cliente'
          if (raw.tipo_cliente === 'persona_fisica') {
            fullName = `${raw.nome || ''} ${raw.cognome || ''}`.trim()
          } else if (raw.tipo_cliente === 'azienda') {
            fullName = raw.ragione_sociale || raw.denominazione || 'Azienda'
          } else if (raw.tipo_cliente === 'pubblica_amministrazione') {
            fullName = raw.ente_ufficio || raw.denominazione || 'Pubblica Amministrazione'
          }

          if (!fullName || fullName === 'Cliente') {
            fullName = `${raw.nome || ''} ${raw.cognome || ''}`.trim() ||
              raw.ragione_sociale ||
              raw.denominazione ||
              'Cliente'
          }

          const freshCustomer: Customer = {
            // ... spread existing customer to keep local props if any
            ...customer,
            // Overwrite with fresh DB data
            id: raw.id,
            full_name: fullName,
            email: raw.email,
            phone: raw.telefono,

            // Fields mapping
            driver_license_number: raw.numero_patente,
            // ... other specific mappings that loadCustomers does

            // Spread raw data to cover all matching columns (nome, cognome, etc)
            ...raw,

            // Explicit overrides for mapped fields
            telefono: raw.telefono,
            numero_patente: raw.numero_patente,
            scadenza_patente: raw.scadenza_patente,

            // CRITICAL FIX: Map DB columns to UI expected keys
            luogo_nascita: raw.citta_nascita || raw.luogo_nascita,
            indirizzo_azienda: raw.sede_legale || raw.indirizzo_azienda || raw.indirizzo,
            patente: raw.numero_patente || raw.patente,

            // Fix address display
            indirizzo: raw.indirizzo || raw.sede_legale,
            citta: raw.citta || raw.citta_residenza || raw.comune,
            cap: raw.cap || raw.codice_postale
          }

          setViewingCustomerDetails(freshCustomer)
        }
      } catch (err) {
        console.error('Error:', err)
        setViewingCustomerDetails(customer)
      }
    } else {
      // No valid ID, use cached data
      setViewingCustomerDetails(customer)
    }
  }

  async function handleUploadLicense(file: File, userId: string) {
    if (!file) return

    setUploadingLicense(true)
    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `${Date.now()}.${fileExt}`
      const filePath = `${userId}/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('driver-licenses')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        })

      if (uploadError) throw uploadError

      alert('Patente caricata con successo!')
      await fetchCustomerDocuments(userId)
    } catch (error: any) {
      console.error('Error uploading license:', error)
      alert('Errore nel caricamento della patente: ' + (error.message || JSON.stringify(error)))
    } finally {
      setUploadingLicense(false)
    }
  }

  async function handleUploadId(file: File, userId: string) {
    if (!file) return

    setUploadingId(true)
    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `${Date.now()}.${fileExt}`
      const filePath = `${userId}/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('driver-ids')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        })

      if (uploadError) throw uploadError

      alert('Documento d\'identità caricato con successo!')
      await fetchCustomerDocuments(userId)
    } catch (error: any) {
      console.error('Error uploading ID:', error)
      alert('Errore nel caricamento del documento: ' + (error.message || JSON.stringify(error)))
    } finally {
      setUploadingId(false)
    }
  }

  async function handleDeleteLicense(fileName: string, userId: string) {
    if (!confirm('Sei sicuro di voler eliminare questo documento?')) {
      return
    }

    try {
      const { error } = await supabase.storage
        .from('driver-licenses')
        .remove([`${userId}/${fileName}`])

      if (error) throw error

      alert('✅ Documento eliminato con successo!')
      await fetchCustomerDocuments(userId)
    } catch (error: any) {
      console.error('Error deleting license:', error)
      alert('❌ Errore nell\'eliminazione: ' + (error.message || JSON.stringify(error)))
    }
  }

  async function handleDeleteId(fileName: string, userId: string) {
    if (!confirm('Sei sicuro di voler eliminare questo documento?')) {
      return
    }

    try {
      const { error } = await supabase.storage
        .from('driver-ids')
        .remove([`${userId}/${fileName}`])

      if (error) throw error

      alert('✅ Documento eliminato con successo!')
      await fetchCustomerDocuments(userId)
    } catch (error: any) {
      console.error('Error deleting ID:', error)
      alert('❌ Errore nell\'eliminazione: ' + (error.message || JSON.stringify(error)))
    }
  }

  async function handleUploadCodiceFiscale(file: File, userId: string) {
    if (!file) return

    setUploadingCodiceFiscale(true)
    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `${Date.now()}.${fileExt}`
      const filePath = `${userId}/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('codice-fiscale')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        })

      if (uploadError) throw uploadError

      alert('Codice Fiscale caricato con successo!')
      await fetchCustomerDocuments(userId)
    } catch (error: any) {
      console.error('Error uploading Codice Fiscale:', error)
      alert('Errore nel caricamento del Codice Fiscale: ' + (error.message || JSON.stringify(error)))
    } finally {
      setUploadingCodiceFiscale(false)
    }
  }

  async function handleDeleteCodiceFiscale(fileName: string, userId: string) {
    if (!confirm('Sei sicuro di voler eliminare questo documento?')) {
      return
    }

    try {
      const { error } = await supabase.storage
        .from('codice-fiscale')
        .remove([`${userId}/${fileName}`])

      if (error) throw error

      alert('✅ Documento eliminato con successo!')
      await fetchCustomerDocuments(userId)
    } catch (error: any) {
      console.error('Error deleting Codice Fiscale:', error)
      alert('❌ Errore nell\'eliminazione: ' + (error.message || JSON.stringify(error)))
    }
  }

  async function handleUpdateCustomerStatus(customerId: string, newStatus: 'blacklist' | 'has_rental' | 'vip' | null) {
    try {
      const { error } = await supabase
        .from('customers_extended')
        .update({ status: newStatus })
        .eq('id', customerId)

      if (error) throw error

      // Update local state
      setCustomers(customers.map(c =>
        c.id === customerId ? { ...c, status: newStatus } : c
      ))

      const statusLabel = newStatus === 'blacklist' ? 'Blacklist' :
        newStatus === 'vip' ? 'VIP' :
          newStatus === 'has_rental' ? 'Fidelizzato' : 'Nessuno'
      alert(`✅ Status aggiornato a: ${statusLabel}`)
    } catch (error: any) {
      console.error('Error updating customer status:', error)
      alert('❌ Errore nell\'aggiornamento dello status')
    }
  }

  async function handleBulkStatusUpdate(newStatus: 'blacklist' | 'has_rental' | 'vip' | null) {
    const count = selectedCustomerIds.size
    const statusLabel = newStatus === 'blacklist' ? 'Blacklist' :
      newStatus === 'vip' ? 'VIP' :
        newStatus === 'has_rental' ? 'Fidelizzato' : 'Nessuno'

    if (!confirm(`Vuoi cambiare lo status di ${count} clienti a: ${statusLabel}?`)) return

    try {
      const updates = Array.from(selectedCustomerIds).map(async (customerId) => {
        const { error } = await supabase
          .from('customers_extended')
          .update({ status: newStatus })
          .eq('id', customerId)

        if (error) throw error
      })

      await Promise.all(updates)

      // Update local state
      setCustomers(customers.map(c =>
        selectedCustomerIds.has(c.id) ? { ...c, status: newStatus } : c
      ))

      // Clear selection
      setSelectedCustomerIds(new Set())

      alert(`✅ Status aggiornato per ${count} clienti a: ${statusLabel}`)
    } catch (error: any) {
      console.error('Error updating customer statuses:', error)
      alert('❌ Errore nell\'aggiornamento degli status')
    }
  }



  if (loading) {
    return <div className="text-center py-8 text-theme-text-muted">Caricamento...</div>
  }

  return (
    <div>
      {/* Customer Details Modal - For Fattura Generation */}
      {viewingCustomerDetails && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-theme-bg-secondary border border-theme-border rounded-lg max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex-shrink-0 bg-theme-bg-secondary border-b border-theme-border p-6 flex justify-between items-center">
              <h3 className="text-xl font-bold text-theme-text-primary">
                Dettagli Cliente Completi - {viewingCustomerDetails.full_name}
              </h3>
              <button
                onClick={() => setViewingCustomerDetails(null)}
                className="text-theme-text-muted hover:text-theme-text-primary"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-6">

              {/* Customer Type Badge */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-theme-text-muted">Tipo Cliente:</span>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${viewingCustomerDetails.tipo_cliente === 'persona_fisica'
                  ? 'bg-blue-500/20 text-blue-400'
                  : viewingCustomerDetails.tipo_cliente === 'azienda'
                    ? 'bg-purple-500/20 text-purple-400'
                    : 'bg-green-500/20 text-green-400'
                  }`}>
                  {viewingCustomerDetails.tipo_cliente === 'persona_fisica' && 'Persona Fisica'}
                  {viewingCustomerDetails.tipo_cliente === 'azienda' && 'Azienda'}
                  {viewingCustomerDetails.tipo_cliente === 'pubblica_amministrazione' && 'Pubblica Amministrazione'}
                </span>
              </div>

              {/* Membership Section */}
              <div className="bg-theme-bg-tertiary rounded-lg p-4 border border-dr7-gold/20 mb-4">
                <h4 className="text-sm font-semibold text-dr7-gold mb-3 border-b border-theme-border pb-2 flex justify-between items-center">
                  <span>Pacchetto Membership</span>
                  {(viewingCustomerDetails as any).active_membership && (
                    <span className={`px-2 py-0.5 rounded text-xs text-black font-bold ${(viewingCustomerDetails as any).active_membership.package_name === 'Argento' ? 'bg-gray-400' :
                      (viewingCustomerDetails as any).active_membership.package_name === 'Oro' ? 'bg-yellow-500' :
                        (viewingCustomerDetails as any).active_membership.package_name === 'Platino' ? 'bg-purple-500 text-theme-text-primary' : 'bg-blue-500 text-theme-text-primary'
                      }`}>
                      {(viewingCustomerDetails as any).active_membership.package_name}
                    </span>
                  )}
                </h4>
                {(viewingCustomerDetails as any).active_membership ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <span className="text-sm text-theme-text-muted">Stato:</span>
                      <p className="text-sm text-theme-text-primary font-medium capitalize">
                        {(viewingCustomerDetails as any).active_membership.status === 'active' ? 'Attivo' : (viewingCustomerDetails as any).active_membership.status}
                      </p>
                    </div>
                    <div>
                      <span className="text-sm text-theme-text-muted">Data Attivazione:</span>
                      <p className="text-sm text-theme-text-primary font-medium">
                        {(viewingCustomerDetails as any).active_membership.start_date ? new Date((viewingCustomerDetails as any).active_membership.start_date).toLocaleDateString('it-IT') : '-'}
                      </p>
                    </div>
                    <div>
                      <span className="text-sm text-theme-text-muted">Data Scadenza:</span>
                      <p className="text-sm text-theme-text-primary font-medium">
                        {(viewingCustomerDetails as any).active_membership.end_date ? new Date((viewingCustomerDetails as any).active_membership.end_date).toLocaleDateString('it-IT') : 'Illimitato'}
                      </p>
                    </div>
                    <div>
                      <span className="text-sm text-theme-text-muted">Riferimento Ordine:</span>
                      <p className="text-sm text-theme-text-primary font-medium font-mono">
                        {(viewingCustomerDetails as any).active_membership.external_order_id || '-'}
                      </p>
                    </div>
                    <div>
                      <span className="text-sm text-theme-text-muted">Fonte:</span>
                      <p className="text-sm text-theme-text-primary font-medium">
                        {(viewingCustomerDetails as any).active_membership.source || 'dr7empire.com'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">Nessun pacchetto attivo</p>
                )}
              </div>

              {/* Persona Fisica Details */}
              {viewingCustomerDetails.tipo_cliente === 'persona_fisica' && (
                <div className="bg-theme-bg-tertiary rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-theme-text-secondary mb-3 border-b border-theme-border pb-2">
                    Dati Persona Fisica
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <span className="text-sm text-theme-text-muted">Nome:</span>
                      <p className="text-sm text-theme-text-primary font-medium">{viewingCustomerDetails.nome || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-theme-text-muted">Cognome:</span>
                      <p className="text-sm text-theme-text-primary font-medium">{viewingCustomerDetails.cognome || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-theme-text-muted">Sesso:</span>
                      <p className="text-sm text-theme-text-primary font-medium">
                        {(() => {
                          const val = viewingCustomerDetails.sesso || viewingCustomerDetails.metadata?.sesso;
                          return val === 'M' ? 'Maschio' : val === 'F' ? 'Femmina' : val || '-';
                        })()}
                      </p>
                    </div>
                    <div>
                      <span className="text-sm text-theme-text-muted">Codice Fiscale:</span>
                      <p className="text-sm text-theme-text-primary font-medium font-mono">{viewingCustomerDetails.codice_fiscale || '-'}</p>
                    </div>
                    {/* Duplicate Sesso removed */}
                    <div>
                      <span className="text-sm text-theme-text-muted">Data di Nascita:</span>
                      <p className="text-sm text-theme-text-primary font-medium">{viewingCustomerDetails.data_nascita || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-theme-text-muted">Luogo di Nascita:</span>
                      <p className="text-sm text-theme-text-primary font-medium">
                        {viewingCustomerDetails.luogo_nascita ? `${viewingCustomerDetails.luogo_nascita} (${viewingCustomerDetails.metadata?.provincia_nascita || '-'})` : '-'}
                      </p>
                    </div>
                    <div>
                      <span className="text-sm text-theme-text-muted">Numero Patente:</span>
                      <p className="text-sm text-theme-text-primary font-medium font-mono">{viewingCustomerDetails.patente || viewingCustomerDetails.driver_license_number || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-theme-text-muted">Categoria Patente:</span>
                      <p className="text-sm text-theme-text-primary font-medium">{viewingCustomerDetails.tipo_patente || viewingCustomerDetails.metadata?.patente?.tipo || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-theme-text-muted">Ente Rilascio:</span>
                      <p className="text-sm text-theme-text-primary font-medium">{viewingCustomerDetails.emessa_da || viewingCustomerDetails.metadata?.patente?.ente || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-theme-text-muted">Data Rilascio:</span>
                      <p className="text-sm text-theme-text-primary font-medium">{viewingCustomerDetails.data_rilascio_patente || viewingCustomerDetails.metadata?.patente?.rilascio || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-theme-text-muted">Data Scadenza:</span>
                      <p className="text-sm text-theme-text-primary font-medium">{viewingCustomerDetails.scadenza_patente || viewingCustomerDetails.metadata?.patente?.scadenza || '-'}</p>
                    </div>
                    <div className="md:col-span-2">
                      <span className="text-sm text-theme-text-muted">Indirizzo:</span>
                      <p className="text-sm text-theme-text-primary font-medium">
                        {(() => {
                          const fullAddress = viewingCustomerDetails.indirizzo || '';
                          const numberMatch = fullAddress.match(/\s+(\d+[a-zA-Z]?)$/);
                          if (numberMatch && !viewingCustomerDetails.numero_civico) {
                            // Extract street name without number
                            return fullAddress.replace(/\s+\d+[a-zA-Z]?$/, '').trim() || '-';
                          }
                          return fullAddress || '-';
                        })()}
                      </p>
                    </div>
                    <div>
                      <span className="text-sm text-theme-text-muted">Numero Civico:</span>
                      <p className="text-sm text-theme-text-primary font-medium">
                        {(() => {
                          // First check if numero_civico field has data
                          if (viewingCustomerDetails.numero_civico) {
                            return viewingCustomerDetails.numero_civico;
                          }
                          // If not, try to extract from indirizzo
                          const fullAddress = viewingCustomerDetails.indirizzo || '';
                          const numberMatch = fullAddress.match(/\s+(\d+[a-zA-Z]?)$/);
                          return numberMatch ? numberMatch[1] : '-';
                        })()}
                      </p>
                    </div>
                    <div>
                      <span className="text-sm text-theme-text-muted">Città di Residenza:</span>
                      <p className="text-sm text-theme-text-primary font-medium">{viewingCustomerDetails.citta_residenza || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-theme-text-muted">Provincia:</span>
                      <p className="text-sm text-theme-text-primary font-medium">{viewingCustomerDetails.provincia_residenza || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-theme-text-muted">CAP:</span>
                      <p className="text-sm text-theme-text-primary font-medium">{viewingCustomerDetails.codice_postale || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-theme-text-muted">PEC:</span>
                      <p className="text-sm text-theme-text-primary font-medium">{viewingCustomerDetails.pec || '-'}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Azienda Details */}
              {viewingCustomerDetails.tipo_cliente === 'azienda' && (
                <div className="bg-theme-bg-tertiary rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-theme-text-secondary mb-3 border-b border-theme-border pb-2">
                    Dati Azienda
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="md:col-span-2">
                      <span className="text-sm text-theme-text-muted">Ragione Sociale / Denominazione:</span>
                      <p className="text-sm text-theme-text-primary font-medium">{viewingCustomerDetails.ragione_sociale || viewingCustomerDetails.denominazione || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-theme-text-muted">Partita IVA:</span>
                      <p className="text-sm text-theme-text-primary font-medium font-mono">{viewingCustomerDetails.partita_iva || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-theme-text-muted">Codice Fiscale:</span>
                      <p className="text-sm text-theme-text-primary font-medium font-mono">{viewingCustomerDetails.codice_fiscale || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-theme-text-muted">Codice Destinatario:</span>
                      <p className="text-sm text-theme-text-primary font-medium font-mono">{viewingCustomerDetails.codice_destinatario || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-theme-text-muted">PEC:</span>
                      <p className="text-sm text-theme-text-primary font-medium">{viewingCustomerDetails.pec || '-'}</p>
                    </div>
                    <div className="md:col-span-2">
                      <span className="text-sm text-theme-text-muted">Indirizzo Sede Legale:</span>
                      <p className="text-sm text-theme-text-primary font-medium">{viewingCustomerDetails.indirizzo_azienda || viewingCustomerDetails.indirizzo || '-'}</p>
                    </div>
                    <div className="md:col-span-2">
                      <span className="text-sm text-theme-text-muted">Sede Operativa:</span>
                      <p className="text-sm text-theme-text-primary font-medium">{viewingCustomerDetails.metadata?.sede_operativa || '-'}</p>
                    </div>
                    <div className="md:col-span-2">
                      <span className="text-sm text-theme-text-muted">Indirizzo DDT:</span>
                      <p className="text-sm text-theme-text-primary font-medium">{viewingCustomerDetails.indirizzo_ddt || '-'}</p>
                    </div>
                    <div className="md:col-span-2">
                      <span className="text-sm text-theme-text-muted">Contatti Cliente:</span>
                      <p className="text-sm text-theme-text-primary font-medium">{viewingCustomerDetails.contatti_cliente || '-'}</p>
                    </div>
                  </div>

                  {/* Rappresentante Legale Info */}
                  <div className="mt-4 border-t border-theme-border pt-3">
                    <h5 className="text-xs font-semibold text-theme-text-muted uppercase tracking-wider mb-2">Rappresentante Legale</h5>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <span className="text-sm text-theme-text-muted">Nome Completo:</span>
                        <p className="text-sm text-theme-text-primary font-medium">
                          {viewingCustomerDetails.metadata?.rappresentante?.nome} {viewingCustomerDetails.metadata?.rappresentante?.cognome}
                        </p>
                      </div>
                      <div>
                        <span className="text-sm text-theme-text-muted">CF Rappresentante:</span>
                        <p className="text-sm text-theme-text-primary font-medium font-mono">{viewingCustomerDetails.metadata?.rappresentante?.cf || '-'}</p>
                      </div>
                      <div>
                        <span className="text-sm text-theme-text-muted">Ruolo:</span>
                        <p className="text-sm text-theme-text-primary font-medium">{viewingCustomerDetails.metadata?.rappresentante?.ruolo || '-'}</p>
                      </div>
                    </div>
                    <div className="mt-2">
                      <p className="text-xs text-gray-500 mb-1">Documento Identità:</p>
                      <p className="text-sm text-theme-text-primary">
                        {viewingCustomerDetails.metadata?.rappresentante?.documento?.tipo} n. {viewingCustomerDetails.metadata?.rappresentante?.documento?.numero}
                      </p>
                      <p className="text-xs text-theme-text-muted">
                        Rilasciato il {viewingCustomerDetails.metadata?.rappresentante?.documento?.rilascio} a {viewingCustomerDetails.metadata?.rappresentante?.documento?.luogo}
                        {viewingCustomerDetails.metadata?.rappresentante?.documento?.scadenza && (
                          <span className="block text-theme-text-muted mt-1">
                            Scadenza: <span className="text-theme-text-primary">{viewingCustomerDetails.metadata?.rappresentante?.documento?.scadenza}</span>
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Pubblica Amministrazione Details */}
              {viewingCustomerDetails.tipo_cliente === 'pubblica_amministrazione' && (
                <div className="bg-theme-bg-tertiary rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-theme-text-secondary mb-3 border-b border-theme-border pb-2">
                    Dati Pubblica Amministrazione
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="md:col-span-2">
                      <span className="text-sm text-theme-text-muted">Ente o Ufficio:</span>
                      <p className="text-sm text-theme-text-primary font-medium">{viewingCustomerDetails.ente_ufficio || viewingCustomerDetails.denominazione || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-theme-text-muted">Codice Univoco:</span>
                      <p className="text-sm text-theme-text-primary font-medium font-mono">{viewingCustomerDetails.codice_univoco || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-theme-text-muted">Codice Fiscale:</span>
                      <p className="text-sm text-theme-text-primary font-medium font-mono">{viewingCustomerDetails.codice_fiscale_pa || viewingCustomerDetails.codice_fiscale || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-theme-text-muted">Codice IPA:</span>
                      <p className="text-sm text-theme-text-primary font-medium font-mono">{viewingCustomerDetails.codice_ipa || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-theme-text-muted">Citta:</span>
                      <p className="text-sm text-theme-text-primary font-medium">{viewingCustomerDetails.citta || '-'}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Common Contact Information */}
              <div className="bg-theme-bg-tertiary rounded-lg p-4">
                <h4 className="text-sm font-semibold text-theme-text-secondary mb-3 border-b border-theme-border pb-2">
                  Informazioni di Contatto
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <span className="text-sm text-theme-text-muted">Email:</span>
                    <p className="text-sm text-theme-text-primary font-medium">{viewingCustomerDetails.email || '-'}</p>
                  </div>
                  <div>
                    <span className="text-sm text-theme-text-muted">Telefono:</span>
                    <p className="text-sm text-theme-text-primary font-medium">{viewingCustomerDetails.telefono || viewingCustomerDetails.phone || '-'}</p>
                  </div>
                  <div>
                    <span className="text-sm text-theme-text-muted">Numero Patente:</span>
                    <p className="text-sm text-theme-text-primary font-medium font-mono">{viewingCustomerDetails.patente || viewingCustomerDetails.driver_license_number || '-'}</p>
                  </div>
                  <div>
                    <span className="text-sm text-theme-text-muted">Nazione:</span>
                    <p className="text-sm text-theme-text-primary font-medium">{viewingCustomerDetails.nazione || '-'}</p>
                  </div>
                  <div>
                    <span className="text-sm text-theme-text-muted">Residenza (Zona):</span>
                    <p className="text-sm text-theme-text-primary font-medium">
                      {viewingCustomerDetails.residency_zone === 'RESIDENTE_CAGLIARI_SUD_SARDEGNA'
                        ? 'RESIDENTE CAGLIARI–SUD SARDEGNA'
                        : viewingCustomerDetails.residency_zone === 'NON_RESIDENTE'
                          ? 'NON RESIDENTE'
                          : '—'}
                    </p>
                  </div>
                  <div>
                    <span className="text-sm text-theme-text-muted">Fonte:</span>
                    <p className="text-sm text-theme-text-primary font-medium">
                      {viewingCustomerDetails.source === 'admin' ? 'Pannello Admin' : viewingCustomerDetails.source === 'website' ? 'Sito Web' : '-'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Metadata */}
              <div className="bg-theme-bg-tertiary rounded-lg p-4">
                <h4 className="text-sm font-semibold text-theme-text-secondary mb-3 border-b border-theme-border pb-2">
                  Metadata
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <span className="text-sm text-theme-text-muted">Data Creazione:</span>
                    <p className="text-sm text-theme-text-primary font-medium">
                      {new Date(viewingCustomerDetails.created_at).toLocaleString('it-IT')}
                    </p>
                  </div>
                  <div>
                    <span className="text-sm text-theme-text-muted">Ultimo Aggiornamento:</span>
                    <p className="text-sm text-theme-text-primary font-medium">
                      {new Date(viewingCustomerDetails.updated_at).toLocaleString('it-IT')}
                    </p>
                  </div>
                </div>
              </div>


              {/* Note */}
              {(viewingCustomerDetails.notes || (viewingCustomerDetails.metadata as any)?.note || (viewingCustomerDetails as any).note) && (
                <div className="bg-theme-bg-tertiary rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-theme-text-secondary mb-3 border-b border-theme-border pb-2">
                    Note
                  </h4>
                  <p className="text-sm text-theme-text-primary whitespace-pre-wrap">
                    {viewingCustomerDetails.notes || (viewingCustomerDetails.metadata as any)?.note || (viewingCustomerDetails as any).note}
                  </p>
                </div>
              )}

              {/* Action Button */}
              <div className="flex justify-end pt-4 border-t border-theme-border">
                <Button
                  onClick={() => setViewingCustomerDetails(null)}
                  variant="secondary"
                >
                  Chiudi
                </Button>
              </div>
            </div>
          </div>
        </div>
      )
      }

      {/* Documents Modal */}
      {
        viewingDocuments && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-theme-bg-secondary border border-theme-border rounded-lg max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
              <div className="flex-shrink-0 bg-theme-bg-secondary border-b border-theme-border p-6 flex justify-between items-center">
                <h3 className="text-xl font-bold text-theme-text-primary">
                  Documenti - {viewingDocuments.full_name}
                </h3>
                <button
                  onClick={() => setViewingDocuments(null)}
                  className="text-theme-text-muted hover:text-theme-text-primary"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* Customer Info */}
                <div className="bg-theme-bg-tertiary rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-theme-text-secondary mb-3">Informazioni Cliente</h4>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-theme-text-muted">Email:</span>
                      <span className="text-sm text-theme-text-primary">{viewingDocuments.email || '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-theme-text-muted">Telefono:</span>
                      <span className="text-sm text-theme-text-primary">{viewingDocuments.phone || '-'}</span>
                    </div>
                  </div>
                </div>

                {/* Uploaded Documents */}
                <div className="bg-theme-bg-tertiary rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-theme-text-secondary mb-3">Documenti Caricati</h4>
                  {loadingDocuments ? (
                    <div className="text-center py-4">
                      <p className="text-theme-text-muted">Caricamento documenti...</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Driver's License */}
                      <div className="border border-theme-border rounded-lg p-3">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-sm font-medium text-theme-text-secondary">
                            📄 Patente di Guida ({documentsUrls.licenses.length}/2)
                          </span>
                        </div>
                        {documentsUrls.licenses.length > 0 ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                            {documentsUrls.licenses.map((doc, index) => (
                              <div key={index} className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs text-theme-text-muted">
                                    {index === 0 ? 'Fronte' : index === 1 ? 'Retro' : `Documento ${index + 1}`}
                                  </span>
                                  <div className="flex gap-2">
                                    <a
                                      href={doc.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs text-blue-400 hover:text-blue-300"
                                    >
                                      👁️ Apri
                                    </a>
                                    <button
                                      onClick={() => viewingDocuments?.id && handleDeleteLicense(doc.fileName, viewingDocuments.id)}
                                      className="text-xs text-red-400 hover:text-red-300"
                                    >
                                      ×
                                    </button>
                                  </div>
                                </div>
                                <img
                                  src={doc.url}
                                  alt={`Patente di guida - ${index === 0 ? 'Fronte' : 'Retro'}`}
                                  className="w-full rounded border border-theme-border-light"
                                />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500 italic mb-3">Nessun documento caricato</p>
                        )}
                        {/* Upload Section */}
                        {viewingDocuments.id && viewingDocuments.id.length > 10 && (
                          <div className="mt-3 pt-3 border-t border-theme-border">
                            <label className="block">
                              <input
                                type="file"
                                accept="image/*,.pdf"
                                onChange={(e) => {
                                  const file = e.target.files?.[0]
                                  if (file && viewingDocuments.id) {
                                    handleUploadLicense(file, viewingDocuments.id)
                                    e.target.value = '' // Reset input to allow same file again
                                  }
                                }}
                                className="hidden"
                                disabled={uploadingLicense}
                                id="license-upload"
                              />
                              <span className={`inline-block px-4 py-2 rounded-full text-sm font-medium text-center w-full cursor-pointer ${uploadingLicense
                                ? 'bg-gray-700 text-theme-text-muted cursor-not-allowed'
                                : 'bg-dr7-gold text-black hover:bg-dr7-gold/90'
                                }`}>
                                {uploadingLicense ? 'Caricamento...' : documentsUrls.licenses.length === 0 ? '📤 Carica Fronte Patente' : documentsUrls.licenses.length === 1 ? '📤 Carica Retro Patente' : '📤 Carica Altro Documento'}
                              </span>
                            </label>
                            {documentsUrls.licenses.length < 2 && (
                              <p className="text-xs text-yellow-400 mt-2 text-center">
                                ⚠️ Ricorda di caricare entrambi i lati della patente (fronte e retro)
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      {/* ID Card / Passport */}
                      <div className="border border-theme-border rounded-lg p-3">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-sm font-medium text-theme-text-secondary">
                            🆔 Carta d'Identità / Passaporto ({documentsUrls.ids.length}/2)
                          </span>
                        </div>
                        {documentsUrls.ids.length > 0 ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                            {documentsUrls.ids.map((doc, index) => (
                              <div key={index} className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs text-theme-text-muted">
                                    {index === 0 ? 'Fronte' : index === 1 ? 'Retro' : `Documento ${index + 1}`}
                                  </span>
                                  <div className="flex gap-2">
                                    <a
                                      href={doc.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs text-blue-400 hover:text-blue-300"
                                    >
                                      👁️ Apri
                                    </a>
                                    <button
                                      onClick={() => viewingDocuments?.id && handleDeleteId(doc.fileName, viewingDocuments.id)}
                                      className="text-xs text-red-400 hover:text-red-300"
                                    >
                                      ×
                                    </button>
                                  </div>
                                </div>
                                <img
                                  src={doc.url}
                                  alt={`Carta d'identità - ${index === 0 ? 'Fronte' : 'Retro'}`}
                                  className="w-full rounded border border-theme-border-light"
                                />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500 italic mb-3">Nessun documento caricato</p>
                        )}
                        {/* Upload Section */}
                        {viewingDocuments.id && viewingDocuments.id.length > 10 && (
                          <div className="mt-3 pt-3 border-t border-theme-border">
                            <label className="block">
                              <input
                                type="file"
                                accept="image/*,.pdf"
                                onChange={(e) => {
                                  const file = e.target.files?.[0]
                                  if (file && viewingDocuments.id) {
                                    handleUploadId(file, viewingDocuments.id)
                                    e.target.value = '' // Reset input to allow same file again
                                  }
                                }}
                                className="hidden"
                                disabled={uploadingId}
                                id="id-upload"
                              />
                              <span className={`inline-block px-4 py-2 rounded-full text-sm font-medium text-center w-full cursor-pointer ${uploadingId
                                ? 'bg-gray-700 text-theme-text-muted cursor-not-allowed'
                                : 'bg-dr7-gold text-black hover:bg-dr7-gold/90'
                                }`}>
                                {uploadingId ? 'Caricamento...' : documentsUrls.ids.length === 0 ? '📤 Carica Fronte Documento' : documentsUrls.ids.length === 1 ? '📤 Carica Retro Documento' : '📤 Carica Altro Documento'}
                              </span>
                            </label>
                            {documentsUrls.ids.length < 2 && (
                              <p className="text-xs text-yellow-400 mt-2 text-center">
                                ⚠️ Ricorda di caricare entrambi i lati del documento (fronte e retro)
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Codice Fiscale */}
                      <div className="border border-theme-border rounded-lg p-3">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-sm font-medium text-theme-text-secondary">
                            📋 Codice Fiscale ({documentsUrls.codiceFiscale.length}/2)
                          </span>
                        </div>
                        {documentsUrls.codiceFiscale.length > 0 ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                            {documentsUrls.codiceFiscale.map((doc, index) => (
                              <div key={index} className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs text-theme-text-muted">
                                    {index === 0 ? 'Fronte' : index === 1 ? 'Retro' : `Documento ${index + 1}`}
                                  </span>
                                  <div className="flex gap-2">
                                    <a
                                      href={doc.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs text-blue-400 hover:text-blue-300"
                                    >
                                      👁️ Apri
                                    </a>
                                    <button
                                      onClick={() => viewingDocuments?.id && handleDeleteCodiceFiscale(doc.fileName, viewingDocuments.id)}
                                      className="text-xs text-red-400 hover:text-red-300"
                                    >
                                      ×
                                    </button>
                                  </div>
                                </div>
                                <img
                                  src={doc.url}
                                  alt={`Codice Fiscale - ${index === 0 ? 'Fronte' : 'Retro'}`}
                                  className="w-full rounded border border-theme-border-light"
                                />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500 italic mb-3">Nessun documento caricato</p>
                        )}
                        {/* Upload Section */}
                        {viewingDocuments.id && viewingDocuments.id.length > 10 && (
                          <div className="mt-3 pt-3 border-t border-theme-border">
                            <label className="block">
                              <input
                                type="file"
                                accept="image/*,.pdf"
                                onChange={(e) => {
                                  const file = e.target.files?.[0]
                                  if (file && viewingDocuments.id) {
                                    handleUploadCodiceFiscale(file, viewingDocuments.id)
                                    e.target.value = '' // Reset input to allow same file again
                                  }
                                }}
                                className="hidden"
                                disabled={uploadingCodiceFiscale}
                                id="codice-fiscale-upload"
                              />
                              <span className={`inline-block px-4 py-2 rounded-full text-sm font-medium text-center w-full cursor-pointer ${uploadingCodiceFiscale
                                ? 'bg-gray-700 text-theme-text-muted cursor-not-allowed'
                                : 'bg-dr7-gold text-black hover:bg-dr7-gold/90'
                                }`}>
                                {uploadingCodiceFiscale ? 'Caricamento...' : documentsUrls.codiceFiscale.length === 0 ? '📤 Carica Fronte Codice Fiscale' : documentsUrls.codiceFiscale.length === 1 ? '📤 Carica Retro Codice Fiscale' : '📤 Carica Altro Documento'}
                              </span>
                            </label>
                            {documentsUrls.codiceFiscale.length < 2 && (
                              <p className="text-xs text-yellow-400 mt-2 text-center">
                                ⚠️ Ricorda di caricare entrambi i lati del Codice Fiscale (fronte e retro)
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Note */}
                {viewingDocuments.notes && (
                  <div className="bg-theme-bg-tertiary rounded-lg p-4">
                    <h4 className="text-sm font-semibold text-theme-text-secondary mb-2">Note</h4>
                    <p className="text-sm text-theme-text-primary whitespace-pre-wrap">{viewingDocuments.notes}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      }
      {/* Stats Card */}
      <div className="mb-6 bg-gradient-to-r from-dr7-gold/20 to-dr7-gold/5 border border-dr7-gold/30 rounded-full p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-theme-text-muted mb-1">Totale Clienti</p>
            <p className="text-4xl font-bold text-dr7-gold">{totalCustomers}</p>
          </div>
          <div className="text-dr7-gold">
            <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 mb-6">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold text-theme-text-primary">Clienti</h2>
          <div className="flex gap-3">
            {selectedCustomerIds.size > 0 && (
              <>


                <div className="flex gap-2 items-center border-l border-theme-border-light pl-4">
                  <span className="text-sm text-theme-text-muted">Cambia Status:</span>
                  <button
                    onClick={() => handleBulkStatusUpdate('blacklist')}
                    className="px-3 py-2 rounded-full text-sm font-medium bg-red-500/20 text-red-200 hover:bg-red-500/30 border border-red-400/20 backdrop-blur-sm transition-all"
                    title="Imposta come Blacklist"
                  >
                    ⛔ Blacklist
                  </button>
                  <button
                    onClick={() => handleBulkStatusUpdate('vip')}
                    className="px-3 py-2 rounded-full text-sm font-medium bg-yellow-500/20 text-yellow-200 hover:bg-yellow-500/30 border border-yellow-400/20 backdrop-blur-sm transition-all"
                    title="Imposta come VIP"
                  >
                    ⭐ VIP
                  </button>
                  <button
                    onClick={() => handleBulkStatusUpdate('has_rental')}
                    className="px-3 py-2 rounded-full text-sm font-medium bg-green-500/20 text-green-200 hover:bg-green-500/30 border border-green-400/20 backdrop-blur-sm transition-all"
                    title="Imposta come Fidelizzato"
                  >
                    ✓ Fidelizzato
                  </button>
                  <button
                    onClick={() => handleBulkStatusUpdate(null)}
                    className="px-3 py-2 rounded-full text-sm font-medium bg-gray-700/30 text-theme-text-primary/60 hover:bg-theme-bg-hover/50 border border-white/10 backdrop-blur-sm transition-all"
                    title="Rimuovi Status"
                  >
                    ✕ Rimuovi
                  </button>
                </div>
              </>
            )}
            <Button onClick={() => setShowNewClientModal(true)}>
              + Nuovo Cliente
            </Button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <input
            type="text"
            placeholder="Cerca cliente per nome, email o telefono..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-theme-bg-tertiary border border-theme-border rounded-full px-4 py-3 pl-10 text-theme-text-primary placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-dr7-gold focus:border-transparent"
          />
          <svg
            className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-theme-text-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-theme-text-muted hover:text-theme-text-primary"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>



      <div className="rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="">
              <tr>
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={selectedCustomerIds.size === customers.length && customers.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedCustomerIds(new Set(customers.map(c => c.id)))
                      } else {
                        setSelectedCustomerIds(new Set())
                      }
                    }}
                    className="w-4 h-4 rounded-full border-theme-border-light bg-gray-700 text-dr7-gold focus:ring-dr7-gold"
                  />
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Nome</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Pacchetto</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Tipo Cliente</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Email</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Telefono</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Azioni</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-theme-text-primary">Status</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr
                  key={customer.id}
                  className={`border-t border-theme-border hover:bg-white/5 transition-all duration-200 ${customer.status === 'blacklist'
                    ? 'border-l-4 border-l-red-500 bg-red-900/30'
                    : customer.status === 'vip'
                      ? 'border-l-4 border-l-yellow-500 bg-yellow-500/20'
                      : customer.status === 'has_rental'
                        ? 'border-l-4 border-l-green-500 bg-green-500/20'
                        : ''
                    }`}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedCustomerIds.has(customer.id)}
                      onChange={(e) => {
                        const newSet = new Set(selectedCustomerIds)
                        if (e.target.checked) {
                          newSet.add(customer.id)
                        } else {
                          newSet.delete(customer.id)
                        }
                        setSelectedCustomerIds(newSet)
                      }}
                      className="w-4 h-4 rounded-full border-theme-border-light bg-gray-700 text-dr7-gold focus:ring-dr7-gold"
                    />
                  </td>
                  <td className="px-4 py-3 text-sm text-theme-text-primary">
                    <div className="flex items-center gap-2">
                      <span>{customer.full_name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {(customer as any).active_membership ? (
                      <div className="flex flex-col">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold inline-block w-fit mb-1 ${(customer as any).active_membership.package_name === 'Argento' ? 'bg-gray-400 text-black' :
                          (customer as any).active_membership.package_name === 'Oro' ? 'bg-yellow-500 text-black' :
                            (customer as any).active_membership.package_name === 'Platino' ? 'bg-purple-500 text-theme-text-primary' :
                              'bg-blue-600 text-theme-text-primary'
                          }`}>
                          {(customer as any).active_membership.package_name}
                        </span>
                        <span className="text-[10px] text-theme-text-muted capitalize">
                          {(customer as any).active_membership.status === 'active' ? 'Attivo' : (customer as any).active_membership.status}
                        </span>
                      </div>
                    ) : (
                      <span className="text-gray-600 text-xs">Nessun pacchetto</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {customer.tipo_cliente ? (
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${customer.tipo_cliente === 'persona_fisica'
                        ? 'bg-blue-500/20 text-blue-400'
                        : customer.tipo_cliente === 'azienda'
                          ? 'bg-purple-500/20 text-purple-400'
                          : 'bg-green-500/20 text-green-400'
                        }`}>
                        {customer.tipo_cliente === 'persona_fisica' && 'Persona Fisica'}
                        {customer.tipo_cliente === 'azienda' && 'Azienda'}
                        {customer.tipo_cliente === 'pubblica_amministrazione' && 'PA'}
                      </span>
                    ) : (
                      <span className="text-gray-500">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-theme-text-primary">{customer.email || '-'}</td>
                  <td className="px-4 py-3 text-sm text-theme-text-primary">{customer.phone || '-'}</td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex gap-2 flex-wrap">
                      <Button
                        onClick={() => handleViewCustomerDetails(customer)}
                        variant="secondary"
                        className="text-xs py-1 px-3 bg-dr7-gold/20 hover:bg-dr7-gold/30 text-dr7-gold"
                      >
                        Dettagli Completi
                      </Button>
                      <Button
                        onClick={() => handleViewDocuments(customer)}
                        variant="secondary"
                        className="text-xs py-1 px-3 bg-blue-900 hover:bg-blue-800"
                      >
                        Documenti
                      </Button>
                      <Button
                        onClick={() => handleEdit(customer)}
                        variant="secondary"
                        className="text-xs py-1 px-3 bg-green-900 hover:bg-green-800"
                      >
                        Modifica
                      </Button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex gap-2 items-center justify-end">
                      {customer.status === 'blacklist' && (
                        <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-red-600 text-theme-text-primary border border-red-500 backdrop-blur-sm shadow-sm">
                          Blacklist
                        </span>
                      )}
                      {customer.status === 'vip' && (
                        <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-yellow-500/30 text-yellow-200 border border-yellow-400/30 backdrop-blur-sm">
                          VIP
                        </span>
                      )}
                      {customer.status === 'has_rental' && (
                        <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-green-500/30 text-green-200 border border-green-400/30 backdrop-blur-sm">
                          Fidelizzato
                        </span>
                      )}
                      {!customer.status && (
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => handleUpdateCustomerStatus(customer.id, 'blacklist')}
                            className="px-2.5 py-1.5 rounded-full text-xs font-medium bg-red-600/20 text-red-200/90 hover:bg-red-600/40 hover:text-theme-text-primary border border-red-500/30 backdrop-blur-sm transition-all"
                            title="Blacklist"
                          >
                            BL
                          </button>
                          <button
                            onClick={() => handleUpdateCustomerStatus(customer.id, 'vip')}
                            className="px-2.5 py-1.5 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-200/70 hover:bg-yellow-500/30 hover:text-yellow-200 border border-yellow-400/20 backdrop-blur-sm transition-all"
                            title="VIP"
                          >
                            VIP
                          </button>
                          <button
                            onClick={() => handleUpdateCustomerStatus(customer.id, 'has_rental')}
                            className="px-2.5 py-1.5 rounded-full text-xs font-medium bg-green-500/20 text-green-200/70 hover:bg-green-500/30 hover:text-green-200 border border-green-400/20 backdrop-blur-sm transition-all"
                            title="Fidelizzato"
                          >
                            FID
                          </button>
                        </div>
                      )}
                      {customer.status && (
                        <button
                          onClick={() => handleUpdateCustomerStatus(customer.id, null)}
                          className="px-2 py-1.5 rounded-full text-xs font-medium bg-gray-700/30 text-theme-text-primary/60 hover:bg-theme-bg-hover/50 hover:text-theme-text-primary border border-white/10 backdrop-blur-sm transition-all"
                          title="Rimuovi Status"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-right">
                    <Button
                      onClick={() => handleDelete(customer.id)}
                      variant="secondary"
                      className="text-xs py-1 px-3 bg-red-900 hover:bg-red-800"
                    >
                      ×
                    </Button>
                  </td>
                </tr>
              ))}
              {customers.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                    {searchQuery ? `Nessun cliente trovato per "${searchQuery}"` : 'Nessun cliente trovato'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-theme-border">
          <div className="text-sm text-theme-text-muted">
            Mostrando {((currentPage - 1) * CUSTOMERS_PER_PAGE) + 1} - {Math.min(currentPage * CUSTOMERS_PER_PAGE, totalCustomers)} di {totalCustomers} clienti
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="px-4 py-2 bg-theme-bg-tertiary text-theme-text-primary rounded-full hover:bg-theme-bg-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              ← Precedente
            </button>
            <div className="flex items-center gap-2 px-4 py-2 bg-theme-bg-tertiary text-theme-text-primary rounded-full">
              Pagina {currentPage} di {Math.ceil(totalCustomers / CUSTOMERS_PER_PAGE)}
            </div>
            <button
              onClick={() => setCurrentPage(prev => Math.min(Math.ceil(totalCustomers / CUSTOMERS_PER_PAGE), prev + 1))}
              disabled={currentPage >= Math.ceil(totalCustomers / CUSTOMERS_PER_PAGE)}
              className="px-4 py-2 bg-theme-bg-tertiary text-theme-text-primary rounded-full hover:bg-theme-bg-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Successiva →
            </button>
          </div>
        </div>
      </div>

      <NewClientModal
        isOpen={showNewClientModal}
        onClose={() => {
          setShowNewClientModal(false)
          // Defer resetting selectedCustomer to prevent race condition
          // The modal's useEffect depends on initialData, so if we reset it immediately,
          // it will trigger the "new mode" path and reset editingId
          setTimeout(() => setSelectedCustomer(null), 100)
        }}
        onClientCreated={() => {
          setShowNewClientModal(false)
          setSelectedCustomer(null)
          loadCustomers()
        }}
        initialData={selectedCustomer}
      />
    </div>
  )
}
