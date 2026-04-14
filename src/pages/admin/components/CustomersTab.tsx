import { useState, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import Button from './Button'
import NewClientModal from './NewClientModal'
import { logger } from '../../../utils/logger'
import { authFetch } from '../../../utils/authFetch'
import ReportClienteModal from './ReportClienteModal'

interface Customer {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  driver_license_number: string | null
  notes: string | null
  created_at: string
  updated_at: string
  status?: 'blacklist' | 'member' | 'elite' | null
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
  user_id?: string
  nazione?: string
  telefono?: string
  residency_zone?: string
  // Membership fields
  membership_tier?: 'Argento' | 'Oro' | 'Platino' | null
  membership_expires_at?: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  const [reportCustomerId, setReportCustomerId] = useState<string | null>(null)

  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)

  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Gift Voucher feature
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<Set<string>>(new Set())
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  // Duplicates
  const [mergingDuplicates, setMergingDuplicates] = useState(false)

  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const [totalCustomers, setTotalCustomers] = useState(0)
  const CUSTOMERS_PER_PAGE = 30

  const [allCustomers, setAllCustomers] = useState<Customer[]>([])

  // Sorting
  type SortField = 'name' | 'email' | 'phone' | 'date' | 'wallet' | 'tipo'
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [walletBalances, setWalletBalances] = useState<Map<string, number>>(new Map())

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
    logger.log('[useEffect] allCustomers changed, count:', allCustomers.length)

    if (!allCustomers.length) {
      setCustomers([])
      setTotalCustomers(0)
      return
    }

    let result = [...allCustomers]

    // 1. Sort by selected field
    result.sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'name': cmp = (a.full_name || '').localeCompare(b.full_name || '', 'it'); break
        case 'email': cmp = (a.email || '').localeCompare(b.email || ''); break
        case 'phone': cmp = (a.phone || '').localeCompare(b.phone || ''); break
        case 'date': cmp = new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime(); break
        case 'wallet': cmp = (walletBalances.get(a.id) || 0) - (walletBalances.get(b.id) || 0); break
        case 'tipo': cmp = (a.tipo_cliente || '').localeCompare(b.tipo_cliente || ''); break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

    // 2. Apply search filter (split query into words so "Mario Rossi" matches "Mario Giuseppe Rossi")
    if (searchQuery) {
      const words = searchQuery.toLowerCase().split(/\s+/).filter(Boolean)
      result = result.filter((customer) => {
        const fullName = (customer.full_name || `${customer.nome || ''} ${customer.cognome || ''}`.trim()).toLowerCase()
        const fields = [
          fullName,
          customer.email?.toLowerCase() || '',
          customer.phone?.toLowerCase() || '',
          customer.nome?.toLowerCase() || '',
          customer.cognome?.toLowerCase() || '',
          customer.ragione_sociale?.toLowerCase() || '',
          customer.denominazione?.toLowerCase() || '',
          customer.telefono?.toLowerCase() || ''
        ].join(' ')

        return words.every(word => fields.includes(word))
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
      logger.log('[CustomersTab] Updated view:', {
        total: result.length,
        page: currentPage,
        displayed: paginatedCustomers.length
      })
    }

  }, [allCustomers, searchQuery, currentPage, sortField, sortDir, walletBalances])

  async function exportCustomersCSV() {
    setExporting(true)
    try {
      const csvHeaders = [
        'Nome', 'Cognome', 'Email', 'Telefono', 'Tipo Cliente',
        'Codice Fiscale', 'Partita IVA', 'Indirizzo', 'CAP', 'Città',
        'Provincia', 'Nazione', 'Data Nascita', 'Luogo Nascita',
        'Ragione Sociale', 'Denominazione', 'Numero Patente',
        'Tipo Patente', 'Scadenza Patente', 'Note', 'Status',
        'Membership', 'Creato il'
      ]

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const escapeCSV = (val: any) => {
        if (val == null) return ''
        const str = String(val)
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`
        }
        return str
      }

      const rows = allCustomers.map(c => [
        c.nome || '', c.cognome || '', c.email || '', c.telefono || c.phone || '',
        c.tipo_cliente || '', c.codice_fiscale || '', c.partita_iva || '',
        c.indirizzo || '', c.codice_postale || '', c.citta_residenza || c.citta || '',
        c.provincia_residenza || '', c.nazione || '', c.data_nascita || '',
        c.luogo_nascita || '', c.ragione_sociale || '', c.denominazione || '',
        c.numero_patente || c.metadata?.patente?.numero || '',
        c.tipo_patente || c.metadata?.patente?.tipo || '',
        c.scadenza_patente || c.metadata?.patente?.scadenza || '',
        c.notes || '', c.status || '', c.membership_tier || '',
        c.created_at ? new Date(c.created_at).toLocaleDateString('it-IT') : ''
      ].map(escapeCSV))

      const csvContent = [csvHeaders.join(','), ...rows.map(r => r.join(','))].join('\n')
      const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })

      // Zip if > 5MB
      if (blob.size > 5 * 1024 * 1024) {
        const { default: JSZip } = await import('jszip')
        const zip = new JSZip()
        zip.file('clienti_dr7.csv', csvContent)
        const zipBlob = await zip.generateAsync({ type: 'blob' })
        const url = URL.createObjectURL(zipBlob)
        const a = document.createElement('a')
        a.href = url
        a.download = `clienti_dr7_${new Date().toISOString().slice(0, 10)}.zip`
        a.click()
        URL.revokeObjectURL(url)
      } else {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `clienti_dr7_${new Date().toISOString().slice(0, 10)}.csv`
        a.click()
        URL.revokeObjectURL(url)
      }

      toast.success(`${allCustomers.length} clienti esportati!`)
    } catch (err: unknown) {
      console.error('Export error:', err)
      toast.error('Errore durante esportazione')
    } finally {
      setExporting(false)
    }
  }

  async function importCustomersCSV(file: File) {
    setImporting(true)
    try {
      const text = await file.text()
      const lines = text.split(/\r?\n/).filter(l => l.trim())
      if (lines.length < 2) {
        toast.error('File vuoto o senza dati')
        return
      }

      // Parse header row
      const parseCSVLine = (line: string): string[] => {
        const result: string[] = []
        let current = ''
        let inQuotes = false
        for (let i = 0; i < line.length; i++) {
          const ch = line[i]
          if (inQuotes) {
            if (ch === '"' && line[i + 1] === '"') {
              current += '"'
              i++
            } else if (ch === '"') {
              inQuotes = false
            } else {
              current += ch
            }
          } else {
            if (ch === '"') {
              inQuotes = true
            } else if (ch === ',' || ch === ';') {
              result.push(current.trim())
              current = ''
            } else {
              current += ch
            }
          }
        }
        result.push(current.trim())
        return result
      }

      const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'))

      // Map CSV headers to customers_extended columns
      const headerMap: Record<string, string> = {
        'nome': 'nome', 'cognome': 'cognome', 'email': 'email',
        'telefono': 'telefono', 'phone': 'telefono',
        'tipo_cliente': 'tipo_cliente', 'codice_fiscale': 'codice_fiscale',
        'partita_iva': 'partita_iva', 'indirizzo': 'indirizzo',
        'cap': 'codice_postale', 'codice_postale': 'codice_postale',
        'città': 'citta_residenza', 'citta': 'citta_residenza', 'citta_residenza': 'citta_residenza',
        'provincia': 'provincia_residenza', 'provincia_residenza': 'provincia_residenza',
        'nazione': 'nazione', 'data_nascita': 'data_nascita',
        'luogo_nascita': 'luogo_nascita',
        'ragione_sociale': 'ragione_sociale', 'denominazione': 'denominazione',
        'numero_patente': 'numero_patente', 'tipo_patente': 'tipo_patente',
        'scadenza_patente': 'scadenza_patente', 'note': 'note',
      }

      let imported = 0
      let skipped = 0
      const errors: string[] = []

      for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i])
        if (values.every(v => !v)) continue // skip empty rows

        const customerData: Record<string, string> = { source: 'csv_import' }
        headers.forEach((header, idx) => {
          const dbCol = headerMap[header]
          if (dbCol && values[idx]) {
            customerData[dbCol] = values[idx]
          }
        })

        // Need at least nome or email or ragione_sociale
        if (!customerData.nome && !customerData.email && !customerData.ragione_sociale && !customerData.denominazione) {
          skipped++
          continue
        }

        // Default tipo_cliente
        if (!customerData.tipo_cliente) {
          customerData.tipo_cliente = customerData.ragione_sociale || customerData.denominazione
            ? 'azienda' : 'persona_fisica'
        }

        // Normalize phone
        if (customerData.telefono) {
          let phone = customerData.telefono.replace(/[\s\-+()]/g, '')
          if (phone.startsWith('00')) phone = phone.substring(2)
          if (phone.length === 10) phone = '39' + phone
          customerData.telefono = phone
        }

        try {
          const response = await authFetch('/.netlify/functions/save-customer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customerData })
          })
          if (response.ok) {
            imported++
          } else {
            const err = await response.json()
            errors.push(`Riga ${i + 1}: ${err.error || 'Errore'}`)
            skipped++
          }
        } catch {
          errors.push(`Riga ${i + 1}: Errore di rete`)
          skipped++
        }
      }

      if (imported > 0) {
        toast.success(`${imported} clienti importati!${skipped > 0 ? ` (${skipped} saltati)` : ''}`)
        loadCustomers()
      } else {
        toast.error(`Nessun cliente importato. ${skipped} righe saltate.`)
      }

      if (errors.length > 0) {
        logger.warn('Import errors:', errors)
      }
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      console.error('Import error:', err)
      toast.error('Errore durante importazione: ' + (_errMsg || ''))
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function loadCustomers() {
    setLoading(true)
    try {
      logger.log('[CustomersTab] Loading customers from DB...')

      // Check current user
      const { data: { user } } = await supabase.auth.getUser()
      logger.log('[CustomersTab] Current user:', user?.email)

      // Use customers_extended as the SINGLE source of truth (no more bookings merge = no duplicates)
      const customerMap = new Map<string, Customer>()

      // Get customers from customers_extended table via Netlify function (bypasses RLS)
      logger.log('[CustomersTab] Fetching customers_extended via Netlify function...')

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let customersExtendedData: any[] | null = null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let customersExtendedError: any = null

      try {
        const response = await fetch('/.netlify/functions/list-customers')
        const result = await response.json()
        if (!response.ok) {
          customersExtendedError = { code: result.code, message: result.error }
          console.error('[CustomersTab] ❌ ERROR loading customers_extended:', customersExtendedError)
        } else {
          customersExtendedData = result.customers
          logger.log('[CustomersTab] ✅ Successfully loaded customers_extended:', customersExtendedData?.length)
        }
      } catch (e: unknown) {
        const _errMsg = e instanceof Error ? e.message : String(e)
        customersExtendedError = { code: 'FETCH_ERROR', message: _errMsg }
        console.error('[CustomersTab] ❌ ERROR loading customers_extended:', e)
      }

      // DEBUG: Log counts
      logger.log('STATS:', {
        bookings: 0,
        customers_extended: customersExtendedData?.length || 0,
        unique_map_size: customerMap.size
      })

      if (!customersExtendedError && customersExtendedData) {
        logger.log('[CustomersTab] Customers from customers_extended:', customersExtendedData.length)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        customersExtendedData.forEach((customer: any) => {
          // Use customer ID as unique key — no duplicates possible
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
            note: customer.note,
            source: 'db', // Flag to know this is from DB

            // CRITICAL: Include nome/cognome for form pre-population
            nome: customer.nome,
            cognome: customer.cognome,

            // Extended fields
            tipo_cliente: customer.tipo_cliente,
            codice_fiscale: customer.codice_fiscale,
            partita_iva: customer.partita_iva,
            ragione_sociale: customer.ragione_sociale,
            denominazione: customer.denominazione,
            indirizzo: customer.indirizzo,
            citta: customer.citta,
            cap: customer.cap,
            data_nascita: customer.data_nascita,
            luogo_nascita: customer.luogo_nascita,
            provincia_nascita: customer.provincia_nascita,
            sesso: customer.sesso,

            // Licenses - all fields for form
            numero_patente: customer.numero_patente,
            patente: customer.numero_patente || customer.patente,
            tipo_patente: customer.tipo_patente,
            rilasciata_da: customer.rilasciata_da,
            emessa_da: customer.emessa_da || customer.rilasciata_da,
            data_rilascio: customer.data_rilascio,
            data_rilascio_patente: customer.data_rilascio_patente || customer.data_rilascio,
            scadenza_patente: customer.scadenza_patente,

            // Common
            nazione: customer.nazione,
            telefono: customer.telefono,
            pec: customer.pec,

            // Address fields
            citta_residenza: customer.citta_residenza,
            provincia_residenza: customer.provincia_residenza,
            codice_postale: customer.codice_postale,
            numero_civico: customer.numero_civico,

            // Company fields
            sede_legale: customer.sede_legale,
            codice_destinatario: customer.codice_destinatario,
            indirizzo_azienda: customer.indirizzo_azienda,
            indirizzo_ddt: customer.indirizzo_ddt,
            contatti_cliente: customer.contatti_cliente,

            // PA fields
            codice_univoco: customer.codice_univoco,
            ente_ufficio: customer.ente_ufficio,

            // Membership
            membership_tier: customer.membership_tier,
            membership_expires_at: customer.membership_expires_at,
            status: customer.status,

            // CRITICAL: Include metadata for form pre-population
            metadata: customer.metadata
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          customerMap.set(canonicalKey, extendedData as any)
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
      logger.log('[CustomersTab] Fetching customer_memberships...')
      const { data: membershipsData, error: membershipsError } = await supabase
        .from('customer_memberships')
        .select('*')
        .eq('status', 'active')
      // Let's fetch all active ones to show current package.
      // Ideally we fetch all and sort by date, but specifically we want the *active* one.

      if (!membershipsError && membershipsData) {
        logger.log('[CustomersTab] Memberships found:', membershipsData.length)

        // Map memberships to customers
        const membershipMap = new Map()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
          logger.warn('customer_memberships table missing, skipping.')
        }
      }

      // [NEW] Fetch DR7 Club subscriptions
      try {
        const { data: clubSubs } = await supabase
          .from('dr7_club_subscriptions')
          .select('user_id, plan, status, expires_at')
          .eq('status', 'active')

        if (clubSubs && clubSubs.length > 0) {
          // Map user_id → club subscription
          const clubMap = new Map<string, { plan: string; expires_at: string }>()
          clubSubs.forEach((s: { user_id: string; plan: string; expires_at: string }) => {
            clubMap.set(s.user_id, { plan: s.plan, expires_at: s.expires_at })
          })
          // Match via customers_extended.user_id
          customerMap.forEach((customer, key) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const userId = (customer as any).user_id as string | null
            if (userId && clubMap.has(userId)) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              customerMap.set(key, { ...customer, dr7_club: clubMap.get(userId) } as any)
            }
          })
        }
      } catch {
        // dr7_club_subscriptions table may not exist — ignore
      }

      // Initial cleanup of loading state
      const customersArray = Array.from(customerMap.values())

      // Store all customers
      setAllCustomers(customersArray)

      // Load wallet balances (non-blocking)
      const userIds = customersArray.map(c => c.user_id).filter(Boolean)
      if (userIds.length > 0) {
        supabase.from('user_credit_balance').select('user_id, balance').in('user_id', userIds)
          .then(({ data }) => {
            if (data) {
              const map = new Map<string, number>()
              data.forEach(row => {
                const cust = customersArray.find(c => c.user_id === row.user_id)
                if (cust) map.set(cust.id, parseFloat(row.balance) || 0)
              })
              setWalletBalances(map)
            }
          })
      }

    } catch (error) {
      console.error('[CustomersTab] ❌ Failed to load customers:', error)
    } finally {
      setLoading(false)
    }
  }



  async function handleRemoveDuplicates() {
    setMergingDuplicates(true)

    // Group by normalized email — phone alone is NOT enough (family members can share phones)
    const emailGroups = new Map<string, Customer[]>()

    allCustomers.forEach(c => {
      if (c.id.startsWith('temp-')) return
      const email = (c.email || '').trim().toLowerCase()
      if (email) {
        if (!emailGroups.has(email)) emailGroups.set(email, [])
        emailGroups.get(email)!.push(c)
      }
    })

    const seenIds = new Set<string>()
    const groups: Customer[][] = []

    const normName = (c: Customer) => {
      const n = (c.nome || '').trim().toLowerCase()
      const cog = (c.cognome || '').trim().toLowerCase()
      return `${n}|${cog}`
    }

    const addGroup = (group: Customer[]) => {
      if (group.some(c => seenIds.has(c.id))) return
      // Split by tipo_cliente — never merge azienda with persona_fisica
      const byType = new Map<string, Customer[]>()
      group.forEach(c => {
        const tipo = c.tipo_cliente || 'persona_fisica'
        if (!byType.has(tipo)) byType.set(tipo, [])
        byType.get(tipo)!.push(c)
      })
      byType.forEach(subGroup => {
        if (subGroup.length < 2) return
        // Further split by name — only merge customers with matching nome+cognome
        const byName = new Map<string, Customer[]>()
        subGroup.forEach(c => {
          const name = normName(c)
          // Skip customers with no name — can't safely match them
          if (name === '|') return
          if (!byName.has(name)) byName.set(name, [])
          byName.get(name)!.push(c)
        })
        byName.forEach(nameGroup => {
          if (nameGroup.length < 2) return
          if (nameGroup.some(c => seenIds.has(c.id))) return
          nameGroup.forEach(c => seenIds.add(c.id))
          groups.push(nameGroup)
        })
      })
    }

    emailGroups.forEach(group => { if (group.length >= 2) addGroup(group) })

    if (groups.length === 0) {
      toast.success('Nessun duplicato trovato!')
      setMergingDuplicates(false)
      return
    }

    // Confirmation: show user what will be merged
    const totalToRemove = groups.reduce((s, g) => s + g.length - 1, 0)
    const summary = groups.slice(0, 10).map(g => {
      const sorted = [...g].sort((a, b) => getCompleteness(b) - getCompleteness(a))
      const keeper = sorted[0]
      const dups = sorted.slice(1)
      return `• "${keeper.nome || ''} ${keeper.cognome || ''}" (${keeper.email || 'no email'}) — mantieni, rimuovi ${dups.length} duplicat${dups.length === 1 ? 'o' : 'i'}`
    }).join('\n')

    const confirmMsg = `Trovati ${groups.length} gruppi di duplicati (${totalToRemove} da rimuovere).\n\nPrenotazioni e dati verranno trasferiti al profilo più completo.\n\n${summary}${groups.length > 10 ? `\n... e altri ${groups.length - 10} gruppi` : ''}\n\nProcedere?`

    if (!window.confirm(confirmMsg)) {
      setMergingDuplicates(false)
      toast('Unificazione annullata')
      return
    }

    let merged = 0
    let failed = 0

    for (const group of groups) {
      const ok = await mergeDuplicateGroup(group)
      if (ok) merged++
      else failed++
    }

    setMergingDuplicates(false)
    toast.success(`${totalToRemove} duplicati rimossi (${merged} gruppi unificati)${failed > 0 ? ` — ${failed} errori` : ''}`)
    loadCustomers()
  }

  // Count non-null fields to determine completeness
  function getCompleteness(c: Customer): number {
    const fields = [
      c.email, c.phone, c.telefono, c.nome, c.cognome,
      c.codice_fiscale, c.data_nascita, c.luogo_nascita,
      c.indirizzo, c.citta_residenza, c.codice_postale,
      c.numero_patente, c.tipo_patente, c.scadenza_patente,
      c.partita_iva, c.ragione_sociale, c.pec,
      c.nazione, c.provincia_nascita, c.provincia_residenza,
      c.sesso, c.notes
    ]
    return fields.filter(f => f != null && String(f).trim() !== '').length
  }

  async function mergeDuplicateGroup(group: Customer[]) {
    // Sort by completeness — most complete first
    const sorted = [...group].sort((a, b) => getCompleteness(b) - getCompleteness(a))
    const keeper = sorted[0]
    const toDelete = sorted.slice(1)

    // Merge missing fields from less complete records into keeper
    const mergeFields: (keyof Customer)[] = [
      'email', 'phone', 'telefono', 'nome', 'cognome',
      'codice_fiscale', 'data_nascita', 'luogo_nascita',
      'indirizzo', 'citta_residenza', 'codice_postale',
      'numero_patente', 'tipo_patente', 'scadenza_patente',
      'emessa_da', 'data_rilascio_patente',
      'partita_iva', 'ragione_sociale', 'denominazione',
      'pec', 'nazione', 'provincia_nascita', 'provincia_residenza',
      'sesso', 'notes', 'numero_civico', 'tipo_cliente',
      'codice_destinatario', 'indirizzo_azienda'
    ]

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = {}
    for (const donor of toDelete) {
      for (const field of mergeFields) {
        const keeperVal = keeper[field]
        const donorVal = donor[field]
        if ((!keeperVal || String(keeperVal).trim() === '') && donorVal && String(donorVal).trim() !== '') {
          updates[field] = donorVal
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(keeper as any)[field] = donorVal
        }
      }
    }

    try {
      // Single call: update keeper fields + reassign all data from duplicates + delete duplicate shells
      const response = await authFetch('/.netlify/functions/manage-customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'mergeDuplicate',
          keeperId: keeper.id,
          duplicateIds: toDelete.map(d => d.id),
          updates: Object.keys(updates).length > 0 ? updates : undefined
        })
      })
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Errore merge')
      }

      return true
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      console.error('Merge error:', err)
      toast.error(`Errore merge: ${_errMsg}`)
      return false
    }
  }

  async function handleDelete(id: string) {
    logger.log('[handleDelete] Starting delete for ID:', id)

    try {
      const response = await authFetch('/.netlify/functions/manage-customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', customerId: id })
      })

      const result = await response.json()
      logger.log('[handleDelete] API response:', result)

      if (!response.ok) {
        throw new Error(result.error || 'Errore durante l\'eliminazione')
      }

      if (!result.success) {
        throw new Error(result.error || result.message || 'Eliminazione fallita')
      }

      logger.log('[handleDelete] Success! Removing from state. Current allCustomers count:', allCustomers.length)

      // Remove from allCustomers - the useEffect will update customers automatically
      setAllCustomers(prevAll => {
        const newAll = prevAll.filter(c => c.id !== id)
        logger.log('[handleDelete] New allCustomers count:', newAll.length)
        return newAll
      })

      // Success - no popup needed, the customer disappears from the list
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : String(error)
      console.error('[handleDelete] Failed:', error)
      alert('Impossibile eliminare il cliente: ' + (_errMsg || 'Errore sconosciuto'))
    }
  }



  async function handleEdit(customer: Customer) {
    logger.log('[handleEdit] Customer object:', customer)
    logger.log('[handleEdit] Customer ID:', customer.id)
    logger.log('[handleEdit] Customer keys:', Object.keys(customer))

    // CRITICAL FIX: Fetch fresh data from database before opening edit modal
    // This ensures ALL fields are populated, not just the cached/merged data
    if (customer.id && customer.id.length > 10) {
      try {
        logger.log('[handleEdit] 🔄 Fetching fresh data from customers_extended for ID:', customer.id)
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
          logger.log('[handleEdit] ✅ Fresh data loaded from DB:', freshCustomerData)
          logger.log('[handleEdit] 📊 Fields in fresh data:', Object.keys(freshCustomerData))

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

          logger.log('[handleEdit] 🎯 Passing fresh customer to modal:', freshCustomer)
          setSelectedCustomer(freshCustomer)
        }
      } catch (err) {
        console.error('[handleEdit] ❌ Exception fetching fresh data:', err)
        // Fallback to cached data
        setSelectedCustomer(customer)
      }
    } else {
      // No valid ID, use cached data (shouldn't happen for real customers)
      logger.warn('[handleEdit] ⚠️ No valid customer ID, using cached data')
      setSelectedCustomer(customer)
    }

    setShowNewClientModal(true)
  }

  async function fetchCustomerDocuments(userId: string) {
    setLoadingDocuments(true)
    setDocumentsUrls({ licenses: [], ids: [], codiceFiscale: [] })

    try {
      logger.log('[CustomersTab] Fetching documents via Netlify function for:', userId)
      const response = await authFetch('/.netlify/functions/get-customer-documents', {
        method: 'POST',
        body: JSON.stringify({ userId }),
        headers: { 'Content-Type': 'application/json' }
      })

      if (!response.ok) {
        throw new Error(`Function failed with status ${response.status}`)
      }

      const result = await response.json()

      if (result.success && result.documents) {
        logger.log('[CustomersTab] Documents loaded:', result.documents)
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
          logger.log('[handleViewCustomerDetails] Raw DB Fetch:', freshCustomerData)
          logger.log('[handleViewCustomerDetails] CF from DB:', freshCustomerData.codice_fiscale)
          logger.log('[handleViewCustomerDetails] Indirizzo from DB:', freshCustomerData.indirizzo)

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
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : String(error)
      console.error('Error uploading license:', error)
      alert('Errore nel caricamento della patente: ' + (_errMsg || JSON.stringify(error)))
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
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : String(error)
      console.error('Error uploading ID:', error)
      alert('Errore nel caricamento del documento: ' + (_errMsg || JSON.stringify(error)))
    } finally {
      setUploadingId(false)
    }
  }

  async function handleDeleteLicense(fileName: string, userId: string) {
    try {
      const { error } = await supabase.storage
        .from('driver-licenses')
        .remove([`${userId}/${fileName}`])

      if (error) throw error

      alert('✅ Documento eliminato con successo!')
      await fetchCustomerDocuments(userId)
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : String(error)
      console.error('Error deleting license:', error)
      alert('❌ Errore nell\'eliminazione: ' + (_errMsg || JSON.stringify(error)))
    }
  }

  async function handleDeleteId(fileName: string, userId: string) {
    try {
      const { error } = await supabase.storage
        .from('driver-ids')
        .remove([`${userId}/${fileName}`])

      if (error) throw error

      alert('✅ Documento eliminato con successo!')
      await fetchCustomerDocuments(userId)
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : String(error)
      console.error('Error deleting ID:', error)
      alert('❌ Errore nell\'eliminazione: ' + (_errMsg || JSON.stringify(error)))
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
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : String(error)
      console.error('Error uploading Codice Fiscale:', error)
      alert('Errore nel caricamento del Codice Fiscale: ' + (_errMsg || JSON.stringify(error)))
    } finally {
      setUploadingCodiceFiscale(false)
    }
  }

  async function handleDeleteCodiceFiscale(fileName: string, userId: string) {
    try {
      const { error } = await supabase.storage
        .from('codice-fiscale')
        .remove([`${userId}/${fileName}`])

      if (error) throw error

      alert('✅ Documento eliminato con successo!')
      await fetchCustomerDocuments(userId)
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : String(error)
      console.error('Error deleting Codice Fiscale:', error)
      alert('❌ Errore nell\'eliminazione: ' + (_errMsg || JSON.stringify(error)))
    }
  }

  async function handleUpdateCustomerStatus(customerId: string, newStatus: 'blacklist' | 'member' | 'elite' | null) {
    const statusLabel = newStatus === 'blacklist' ? 'Blacklist' :
      newStatus === 'elite' ? 'Elite' :
        newStatus === 'member' ? 'Member' : 'Nessuno'

    try {
      const response = await authFetch('/.netlify/functions/manage-customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'updateStatus', customerId, status: newStatus })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Errore durante l\'aggiornamento')
      }

      // Update local state
      setCustomers(customers.map(c =>
        c.id === customerId ? { ...c, status: newStatus } : c
      ))
      setAllCustomers(prev => prev.map(c =>
        c.id === customerId ? { ...c, status: newStatus } : c
      ))

      alert(`Status aggiornato a: ${statusLabel}`)
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : String(error)
      console.error('Error updating customer status:', error)
      alert('Errore nell\'aggiornamento dello status: ' + (_errMsg || 'Errore sconosciuto'))
    }
  }

  async function handleBulkStatusUpdate(newStatus: 'blacklist' | 'member' | 'elite' | null) {
    try {
      const customerIds = Array.from(selectedCustomerIds)

      const response = await authFetch('/.netlify/functions/manage-customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bulkUpdateStatus', customerIds, status: newStatus })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Errore durante l\'aggiornamento')
      }

      // Update local state
      setCustomers(customers.map(c =>
        selectedCustomerIds.has(c.id) ? { ...c, status: newStatus } : c
      ))
      setAllCustomers(prev => prev.map(c =>
        selectedCustomerIds.has(c.id) ? { ...c, status: newStatus } : c
      ))

      // Clear selection
      setSelectedCustomerIds(new Set())

      let message = `Status aggiornato per ${result.message || selectedCustomerIds.size + ' clienti'}`
      if (result.skippedTemp > 0) {
        message += ` (${result.skippedTemp} clienti temporanei ignorati)`
      }
      alert(message)
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : String(error)
      console.error('Error updating customer statuses:', error)
      alert('Errore nell\'aggiornamento degli status: ' + (_errMsg || 'Errore sconosciuto'))
    }
  }

  async function handleBulkDelete() {
    setBulkDeleting(true)
    try {
      const customerIds = Array.from(selectedCustomerIds)

      const response = await authFetch('/.netlify/functions/manage-customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bulkDelete', customerIds })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Errore durante l\'eliminazione')
      }

      // Remove deleted customers from local state
      setAllCustomers(prev => prev.filter(c => !selectedCustomerIds.has(c.id)))
      setSelectedCustomerIds(new Set())
      setShowBulkDeleteModal(false)

      alert(`${result.message || customerIds.length + ' clienti eliminati'}`)
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : String(error)
      console.error('Error bulk deleting customers:', error)
      alert('Errore nell\'eliminazione: ' + (_errMsg || 'Errore sconosciuto'))
    } finally {
      setBulkDeleting(false)
    }
  }

  if (loading) {
    return <div className="text-center py-8 text-theme-text-muted">Caricamento...</div>
  }

  return (
    <div>
      {/* Bulk Delete Confirmation Modal */}
      {showBulkDeleteModal && (
        <div className="fixed inset-0 bg-theme-overlay backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-theme-bg-secondary border border-red-600/50 rounded-none sm:rounded-lg w-full sm:max-w-lg h-full sm:h-auto overflow-hidden flex flex-col">
            <div className="bg-red-900/30 border-b border-red-600/30 p-6">
              <h3 className="text-xl font-bold text-red-400 flex items-center gap-2">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                Elimina {selectedCustomerIds.size} Clienti
              </h3>
            </div>
            <div className="p-6">
              <p className="text-theme-text-secondary mb-4">
                Stai per eliminare <span className="font-bold text-red-400">{selectedCustomerIds.size}</span> clienti e tutti i loro dati associati (prenotazioni, contratti, fatture, cauzioni).
              </p>
              <div className="max-h-40 overflow-y-auto mb-4 bg-theme-bg-primary rounded-lg p-3 border border-theme-border">
                {Array.from(selectedCustomerIds).map(id => {
                  const c = customers.find(cu => cu.id === id) || allCustomers.find(cu => cu.id === id)
                  return (
                    <div key={id} className="py-1 text-sm text-theme-text-primary border-b border-theme-border/30 last:border-b-0">
                      {c?.full_name || id}
                      {c?.email ? <span className="text-theme-text-muted ml-2">({c.email})</span> : null}
                    </div>
                  )
                })}
              </div>
              <p className="text-red-400 text-sm font-semibold">Questa azione è irreversibile.</p>
            </div>
            <div className="flex justify-end gap-3 p-6 border-t border-theme-border">
              <button
                onClick={() => setShowBulkDeleteModal(false)}
                disabled={bulkDeleting}
                className="px-4 py-2 rounded-lg bg-theme-bg-tertiary text-theme-text-primary hover:bg-theme-bg-hover border border-theme-border transition-all"
              >
                Annulla
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="px-4 py-2 rounded-lg bg-red-700 text-white hover:bg-red-600 border border-red-500 transition-all font-bold flex items-center gap-2"
              >
                {bulkDeleting ? (
                  <>
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Eliminazione...
                  </>
                ) : (
                  `Elimina ${selectedCustomerIds.size} Clienti`
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer Details Modal - For Fattura Generation */}
      {viewingCustomerDetails && (
        <div className="fixed inset-0 bg-theme-overlay backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-theme-bg-secondary border border-theme-border rounded-none sm:rounded-lg w-full sm:max-w-3xl h-full sm:h-auto sm:max-h-[90vh] flex flex-col overflow-hidden">
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
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {(viewingCustomerDetails as any).active_membership && (
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    <span className={`px-2 py-0.5 rounded text-xs text-black font-bold ${(viewingCustomerDetails as any).active_membership.package_name === 'Argento' ? 'bg-theme-bg-hover' :
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      (viewingCustomerDetails as any).active_membership.package_name === 'Oro' ? 'bg-yellow-500' :
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        (viewingCustomerDetails as any).active_membership.package_name === 'Platino' ? 'bg-purple-500 text-theme-text-primary' : 'bg-blue-500 text-theme-text-primary'
                      }`}>
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      {(viewingCustomerDetails as any).active_membership.package_name}
                    </span>
                  )}
                </h4>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {(viewingCustomerDetails as any).active_membership ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <span className="text-sm text-theme-text-muted">Stato:</span>
                      <p className="text-sm text-theme-text-primary font-medium capitalize">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {(viewingCustomerDetails as any).active_membership.status === 'active' ? 'Attivo' : (viewingCustomerDetails as any).active_membership.status}
                      </p>
                    </div>
                    <div>
                      <span className="text-sm text-theme-text-muted">Data Attivazione:</span>
                      <p className="text-sm text-theme-text-primary font-medium">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {(viewingCustomerDetails as any).active_membership.start_date ? new Date((viewingCustomerDetails as any).active_membership.start_date).toLocaleDateString('it-IT') : '-'}
                      </p>
                    </div>
                    <div>
                      <span className="text-sm text-theme-text-muted">Data Scadenza:</span>
                      <p className="text-sm text-theme-text-primary font-medium">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {(viewingCustomerDetails as any).active_membership.end_date ? new Date((viewingCustomerDetails as any).active_membership.end_date).toLocaleDateString('it-IT') : 'Illimitato'}
                      </p>
                    </div>
                    <div>
                      <span className="text-sm text-theme-text-muted">Riferimento Ordine:</span>
                      <p className="text-sm text-theme-text-primary font-medium font-mono">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {(viewingCustomerDetails as any).active_membership.external_order_id || '-'}
                      </p>
                    </div>
                    <div>
                      <span className="text-sm text-theme-text-muted">Fonte:</span>
                      <p className="text-sm text-theme-text-primary font-medium">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {(viewingCustomerDetails as any).active_membership.source || 'dr7empire.com'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-theme-text-muted">Nessun pacchetto attivo</p>
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
                      <p className="text-xs text-theme-text-muted mb-1">Documento Identità:</p>
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
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {(viewingCustomerDetails.notes || (viewingCustomerDetails.metadata as any)?.note || (viewingCustomerDetails as any).note) && (
                <div className="bg-theme-bg-tertiary rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-theme-text-secondary mb-3 border-b border-theme-border pb-2">
                    Note
                  </h4>
                  <p className="text-sm text-theme-text-primary whitespace-pre-wrap">
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
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
          <div className="fixed inset-0 bg-theme-overlay backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-theme-bg-secondary border border-theme-border rounded-none sm:rounded-lg w-full sm:max-w-2xl h-full sm:h-auto sm:max-h-[90vh] flex flex-col overflow-hidden">
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
                          <p className="text-sm text-theme-text-muted italic mb-3">Nessun documento caricato</p>
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
                                ? 'bg-theme-bg-tertiary text-theme-text-muted cursor-not-allowed'
                                : 'bg-dr7-gold text-white hover:bg-dr7-gold/90'
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
                          <p className="text-sm text-theme-text-muted italic mb-3">Nessun documento caricato</p>
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
                                ? 'bg-theme-bg-tertiary text-theme-text-muted cursor-not-allowed'
                                : 'bg-dr7-gold text-white hover:bg-dr7-gold/90'
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
                          <p className="text-sm text-theme-text-muted italic mb-3">Nessun documento caricato</p>
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
                                ? 'bg-theme-bg-tertiary text-theme-text-muted cursor-not-allowed'
                                : 'bg-dr7-gold text-white hover:bg-dr7-gold/90'
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
      <div className="mb-4 lg:mb-6 bg-gradient-to-r from-dr7-gold/20 to-dr7-gold/5 border border-dr7-gold/30 rounded-lg lg:rounded-full p-3 lg:p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-theme-text-muted mb-1">Totale Clienti</p>
            <p className="text-2xl lg:text-4xl font-bold text-dr7-gold">{totalCustomers}</p>
          </div>
          <div className="text-dr7-gold">
            <svg className="w-10 h-10 lg:w-16 lg:h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:gap-4 mb-4 lg:mb-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <h2 className="text-2xl font-bold text-theme-text-primary">Clienti</h2>
          <div className="flex gap-2 lg:gap-3 items-center flex-wrap">
            <button
              onClick={() => selectedCustomerIds.size > 0 && setShowBulkDeleteModal(true)}
              disabled={selectedCustomerIds.size === 0}
              className={`px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 transition-all ${
                selectedCustomerIds.size > 0
                  ? 'bg-red-900 text-red-200 hover:bg-red-700 border border-red-600 cursor-pointer'
                  : 'bg-theme-bg-tertiary text-theme-text-muted border border-theme-border cursor-not-allowed opacity-60'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Elimina Multipla{selectedCustomerIds.size > 0 ? ` (${selectedCustomerIds.size})` : ''}
            </button>
            {selectedCustomerIds.size > 0 && (
              <div className="flex gap-2 items-center border-l border-theme-border-light pl-4 overflow-x-auto">
                <span className="text-sm text-theme-text-muted">Status:</span>
                <button
                  onClick={() => handleBulkStatusUpdate('blacklist')}
                  className="px-3 py-2 rounded-full text-sm font-bold bg-red-800 text-white hover:bg-red-600 border border-red-500 transition-all"
                  title="Imposta come Blacklist"
                >
                  Blacklist
                </button>
                <button
                  onClick={() => handleBulkStatusUpdate('member')}
                  className="px-3 py-2 rounded-full text-sm font-bold bg-blue-800 text-white hover:bg-blue-600 border border-blue-500 transition-all"
                  title="Imposta come Member"
                >
                  Member
                </button>
                <button
                  onClick={() => handleBulkStatusUpdate('elite')}
                  className="px-3 py-2 rounded-full text-sm font-bold bg-dr7-gold text-white hover:bg-[#247a6f] border border-dr7-gold transition-all"
                  title="Imposta come Elite"
                >
                  Elite
                </button>
                <button
                  onClick={() => handleBulkStatusUpdate(null)}
                  className="px-3 py-2 rounded-full text-sm font-bold bg-theme-bg-tertiary text-theme-text-primary hover:bg-theme-bg-hover border border-theme-border transition-all"
                  title="Rimuovi Status"
                >
                  Rimuovi
                </button>
              </div>
            )}
            <button
              onClick={handleRemoveDuplicates}
              disabled={allCustomers.length === 0 || mergingDuplicates}
              className="px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 transition-all bg-theme-bg-tertiary text-theme-text-primary hover:bg-theme-bg-hover border border-theme-border disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {mergingDuplicates ? 'Rimuovendo...' : 'Rimuovi Duplicati'}
            </button>
            <button
              onClick={exportCustomersCSV}
              disabled={exporting || allCustomers.length === 0}
              className="px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 transition-all bg-theme-bg-tertiary text-theme-text-primary hover:bg-theme-bg-hover border border-theme-border disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {exporting ? 'Esportando...' : 'Esporta CSV'}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 transition-all bg-theme-bg-tertiary text-theme-text-primary hover:bg-theme-bg-hover border border-theme-border disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              {importing ? 'Importando...' : 'Importa CSV'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) importCustomersCSV(file)
              }}
            />
            <Button onClick={() => {
              setSelectedCustomer(null)  // Clear any previous selection
              setShowNewClientModal(true)
            }}>
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
            className="w-full bg-theme-bg-tertiary border border-theme-border rounded-full px-4 py-3 pl-10 text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-dr7-gold focus:border-transparent"
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



      {/* Mobile Card View */}
      <div className="lg:hidden space-y-3">
        {customers.map((customer) => (
          <div
            key={customer.id}
            className={`bg-theme-bg-secondary rounded-lg border border-theme-border p-3 ${customer.status === 'blacklist'
              ? 'border-l-4 border-l-red-500 bg-red-900/30'
              : customer.status === 'elite'
                ? 'border-l-4 border-l-amber-500 bg-amber-500/20'
                : customer.status === 'member'
                  ? 'border-l-4 border-l-blue-500 bg-blue-500/20'
                  : ''
            }`}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 min-w-0">
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
                  className="w-5 h-5 flex-shrink-0"
                />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-theme-text-primary truncate">{customer.full_name}</div>
                  <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                    {customer.tipo_cliente && (
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${customer.tipo_cliente === 'persona_fisica'
                        ? 'bg-blue-500/20 text-blue-400'
                        : customer.tipo_cliente === 'azienda'
                          ? 'bg-purple-500/20 text-purple-400'
                          : 'bg-green-500/20 text-green-400'
                      }`}>
                        {customer.tipo_cliente === 'persona_fisica' ? 'PF' : customer.tipo_cliente === 'azienda' ? 'AZ' : 'PA'}
                      </span>
                    )}
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {(customer as any).active_membership && (
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${(customer as any).active_membership.package_name === 'Argento' ? 'bg-theme-bg-hover text-black' :
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        (customer as any).active_membership.package_name === 'Oro' ? 'bg-yellow-500 text-black' :
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          (customer as any).active_membership.package_name === 'Platino' ? 'bg-purple-500 text-theme-text-primary' :
                            'bg-blue-600 text-theme-text-primary'
                      }`}>
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {(customer as any).active_membership.package_name}
                      </span>
                    )}
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {(customer as any).dr7_club && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-dr7-gold text-white">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        DR7 Club {(customer as any).dr7_club.plan === 'annual' ? 'Annuale' : 'Mensile'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button
                  onClick={() => handleUpdateCustomerStatus(customer.id, 'blacklist')}
                  className={`px-1.5 py-1 rounded-full text-[10px] font-bold border ${
                    customer.status === 'blacklist'
                      ? 'bg-red-600 text-white border-red-400'
                      : 'bg-red-900/80 text-red-100 border-red-600'
                  }`}
                >BL</button>
                <button
                  onClick={() => handleUpdateCustomerStatus(customer.id, 'member')}
                  className={`px-1.5 py-1 rounded-full text-[10px] font-bold border ${
                    customer.status === 'member'
                      ? 'bg-blue-600 text-white border-blue-400'
                      : 'bg-blue-900/80 text-blue-100 border-blue-600'
                  }`}
                >MEM</button>
                <button
                  onClick={() => handleUpdateCustomerStatus(customer.id, 'elite')}
                  className={`px-1.5 py-1 rounded-full text-[10px] font-bold border ${
                    customer.status === 'elite'
                      ? 'bg-amber-500 text-white border-amber-300'
                      : 'bg-amber-900/80 text-amber-100 border-amber-600'
                  }`}
                >ELT</button>
              </div>
            </div>

            <div className="text-xs text-theme-text-muted space-y-0.5 mb-2">
              {customer.email && <div className="truncate">{customer.email}</div>}
              {customer.phone && <div>{customer.phone}</div>}
            </div>

            <div className="flex gap-2 flex-wrap">
              <button onClick={() => setReportCustomerId(customer.id)} className="text-xs py-1 px-2 bg-black hover:bg-gray-800 text-white rounded-full font-medium transition-colors flex-1">
                Report
              </button>
              <Button onClick={() => handleViewCustomerDetails(customer)} variant="secondary" className="text-xs py-1 px-2 bg-dr7-gold/20 hover:bg-dr7-gold/30 text-dr7-gold flex-1">
                Dettagli
              </Button>
              <Button onClick={() => handleViewDocuments(customer)} variant="secondary" className="text-xs py-1 px-2 bg-blue-900 hover:bg-blue-800 flex-1">
                Documenti
              </Button>
              <Button onClick={() => handleEdit(customer)} variant="secondary" className="text-xs py-1 px-2 bg-green-900 hover:bg-green-800 flex-1">
                Modifica
              </Button>
              <Button onClick={() => handleDelete(customer.id)} variant="secondary" className="text-xs py-1 px-2 bg-red-900 hover:bg-red-800">
                ×
              </Button>
            </div>
          </div>
        ))}
        {customers.length === 0 && (
          <div className="bg-theme-bg-secondary rounded-lg border border-theme-border p-8 text-center text-theme-text-muted">
            {searchQuery ? `Nessun cliente trovato per "${searchQuery}"` : 'Nessun cliente trovato'}
          </div>
        )}
      </div>

      <div className="hidden lg:block rounded-lg overflow-hidden">
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
                    className="w-4 h-4 rounded-full border-theme-border-light bg-theme-bg-tertiary text-dr7-gold focus:ring-dr7-gold"
                  />
                </th>
                {[
                  { field: 'name' as SortField, label: 'Nome' },
                  { field: 'tipo' as SortField, label: 'Tipo Cliente' },
                  { field: 'email' as SortField, label: 'Email' },
                  { field: 'phone' as SortField, label: 'Telefono' },
                  { field: 'wallet' as SortField, label: 'Wallet' },
                ].map(col => (
                  <th key={col.field}
                    className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary cursor-pointer select-none hover:text-dr7-gold transition-colors"
                    onClick={() => { if (sortField === col.field) { setSortDir(d => d === 'asc' ? 'desc' : 'asc') } else { setSortField(col.field); setSortDir('asc') }; setCurrentPage(1) }}
                  >
                    {col.label} {sortField === col.field ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </th>
                ))}
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Azioni</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-theme-text-primary">Status</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr
                  key={customer.id}
                  className={`border-t border-theme-border hover:bg-theme-text-primary/5 transition-all duration-200 ${customer.status === 'blacklist'
                    ? 'border-l-4 border-l-red-500 bg-red-900/30'
                    : customer.status === 'elite'
                      ? 'border-l-4 border-l-amber-500 bg-amber-500/20'
                      : customer.status === 'member'
                        ? 'border-l-4 border-l-blue-500 bg-blue-500/20'
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
                      className="w-4 h-4 rounded-full border-theme-border-light bg-theme-bg-tertiary text-dr7-gold focus:ring-dr7-gold"
                    />
                  </td>
                  <td className="px-4 py-3 text-sm text-theme-text-primary">
                    <div className="flex items-center gap-2">
                      <span>{customer.full_name}</span>
                    </div>
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
                      <span className="text-theme-text-muted">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-theme-text-primary">{customer.email || '-'}</td>
                  <td className="px-4 py-3 text-sm text-theme-text-primary">{customer.phone || '-'}</td>
                  <td className="px-4 py-3 text-sm font-medium text-dr7-gold">{walletBalances.has(customer.id) ? `€${walletBalances.get(customer.id)!.toFixed(2)}` : '-'}</td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={() => setReportCustomerId(customer.id)}
                        className="text-xs py-1 px-3 bg-black hover:bg-gray-800 text-white rounded-full font-medium transition-colors"
                      >
                        Report
                      </button>
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
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => handleUpdateCustomerStatus(customer.id, 'blacklist')}
                          className={`px-2.5 py-1.5 rounded-full text-xs font-bold border transition-all ${
                            customer.status === 'blacklist'
                              ? 'bg-red-600 text-white border-red-400 ring-2 ring-red-400'
                              : 'bg-red-900/80 text-red-100 hover:bg-red-700 border-red-600'
                          }`}
                          title="Blacklist"
                        >
                          BL
                        </button>
                        <button
                          onClick={() => handleUpdateCustomerStatus(customer.id, 'member')}
                          className={`px-2.5 py-1.5 rounded-full text-xs font-bold border transition-all ${
                            customer.status === 'member'
                              ? 'bg-blue-600 text-white border-blue-400 ring-2 ring-blue-400'
                              : 'bg-blue-900/80 text-blue-100 hover:bg-blue-700 border-blue-600'
                          }`}
                          title="Member"
                        >
                          MEM
                        </button>
                        <button
                          onClick={() => handleUpdateCustomerStatus(customer.id, 'elite')}
                          className={`px-2.5 py-1.5 rounded-full text-xs font-bold border transition-all ${
                            customer.status === 'elite'
                              ? 'bg-amber-500 text-white border-amber-300 ring-2 ring-amber-400'
                              : 'bg-amber-900/80 text-amber-100 hover:bg-amber-600 border-amber-600'
                          }`}
                          title="Elite"
                        >
                          ELT
                        </button>
                        {customer.status && (
                          <button
                            onClick={() => handleUpdateCustomerStatus(customer.id, null)}
                            className="px-2 py-1.5 rounded-full text-xs font-medium bg-theme-bg-tertiary/30 text-theme-text-primary/60 hover:bg-theme-bg-hover/50 hover:text-theme-text-primary border border-theme-border/50 backdrop-blur-sm transition-all"
                            title="Rimuovi Status"
                          >
                            ✕
                          </button>
                        )}
                      </div>
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
                  <td colSpan={5} className="px-4 py-8 text-center text-theme-text-muted">
                    {searchQuery ? `Nessun cliente trovato per "${searchQuery}"` : 'Nessun cliente trovato'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-3 lg:px-6 py-3 lg:py-4 border-t border-theme-border">
          <div className="hidden sm:block text-sm text-theme-text-muted">
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onClientCreated={(clientId: string, customerData?: any) => {
          logger.log('[onClientCreated] called with:', { clientId, hasData: !!customerData })
          setShowNewClientModal(false)
          setSelectedCustomer(null)
          // Don't update state manually — just reload from DB for consistency
          loadCustomers()
        }}
        initialData={selectedCustomer}
      />

      {/* Report Cliente Modal */}
      {reportCustomerId && (
        <ReportClienteModal
          customerId={reportCustomerId}
          onClose={() => setReportCustomerId(null)}
        />
      )}
    </div>
  )
}
