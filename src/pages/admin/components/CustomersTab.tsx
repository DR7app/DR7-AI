import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import Button from './Button'
import NewClientModal from './NewClientModal'
import GiftVoucherModal from './GiftVoucherModal'

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
  // Common fields
  nazione?: string
  telefono?: string
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
  const [showGiftVoucherModal, setShowGiftVoucherModal] = useState(false)

  useEffect(() => {
    loadCustomers()
  }, [])

  async function loadCustomers() {
    setLoading(true)
    try {
      console.log('[CustomersTab] Loading customers...')

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

      // Process bookings data to create unique customer entries
      if (bookingsData) {
        console.log('Total bookings:', bookingsData.length)
        bookingsData.forEach((booking: any) => {
          // Extract customer data from booking_details if available
          const details = booking.booking_details?.customer || {}

          // Get customer info from direct columns or booking_details
          const customerName = booking.customer_name || details.fullName || 'Cliente'
          const customerEmail = booking.customer_email || details.email || null
          const customerPhone = booking.customer_phone || details.phone || null

          // Debug log
          if (!customerPhone) {
            console.log('Missing phone for:', {
              customerName,
              customerEmail,
              booking_details: booking.booking_details,
              direct_phone: booking.customer_phone
            })
          }

          // Use email as primary key, fallback to phone or user_id
          const key = customerEmail || customerPhone || booking.user_id

          if (key) {
            // If customer already exists, update phone and email if missing
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
              // Create new customer entry
              customerMap.set(key, {
                id: booking.user_id || key,
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
        console.log('Unique customers:', customerMap.size)
      }

      // Also get customers from customers_extended table
      console.log('[CustomersTab] Fetching customers_extended...')
      const { data: customersExtendedData, error: customersExtendedError } = await supabase
        .from('customers_extended')
        .select('*')
        .order('created_at', { ascending: false })

      if (customersExtendedError) {
        console.error('[CustomersTab] ERROR loading customers_extended:', customersExtendedError)
      }

      if (!customersExtendedError && customersExtendedData) {
        console.log('[CustomersTab] Customers from customers_extended:', customersExtendedData.length)
        console.log('[CustomersTab] Sample customer:', customersExtendedData[0])
        customersExtendedData.forEach((customer: any) => {
          const key = customer.email || customer.telefono || customer.id

          // Create display name based on customer type
          let fullName = 'Cliente'
          if (customer.tipo_cliente === 'persona_fisica') {
            fullName = `${customer.nome || ''} ${customer.cognome || ''}`.trim()
          } else if (customer.tipo_cliente === 'azienda') {
            fullName = customer.ragione_sociale || customer.denominazione || 'Azienda'
          } else if (customer.tipo_cliente === 'pubblica_amministrazione') {
            fullName = customer.denominazione || customer.ente_ufficio || 'PA'
          }

          // Store ALL customer data (create new or update existing)
          const extendedData = {
            id: customer.id,
            full_name: fullName,
            email: customer.email,
            phone: customer.telefono,
            driver_license_number: customer.numero_patente || customer.patente || null,
            notes: null,
            created_at: customer.created_at,
            updated_at: customer.updated_at,
            // Include all extended fields
            tipo_cliente: customer.tipo_cliente,
            source: customer.source,
            // Persona Fisica
            nome: customer.nome,
            cognome: customer.cognome,
            codice_fiscale: customer.codice_fiscale,
            data_nascita: customer.data_nascita,
            luogo_nascita: customer.luogo_nascita,
            provincia_nascita: customer.provincia_nascita,
            sesso: customer.sesso || customer.metadata?.sesso,
            patente: customer.patente,
            numero_patente: customer.numero_patente, // Ensure all variants
            data_rilascio_patente: customer.data_rilascio_patente,
            scadenza_patente: customer.scadenza_patente,
            emessa_da: customer.emessa_da,
            tipo_patente: customer.tipo_patente,
            indirizzo: customer.indirizzo,
            pec: customer.pec,
            metadata: customer.metadata,
            // Azienda
            ragione_sociale: customer.ragione_sociale,
            denominazione: customer.denominazione,
            partita_iva: customer.partita_iva,
            codice_destinatario: customer.codice_destinatario,
            indirizzo_azienda: customer.indirizzo_azienda,
            indirizzo_ddt: customer.indirizzo_ddt,
            contatti_cliente: customer.contatti_cliente,
            // Pubblica Amministrazione
            codice_ipa: customer.codice_ipa,
            codice_univoco: customer.codice_univoco,
            codice_fiscale_pa: customer.codice_fiscale_pa,
            ente_ufficio: customer.ente_o_ufficio,
            citta: customer.citta,
            // Common
            nazione: customer.nazione,
            telefono: customer.telefono,
            // Additional fields
            citta_residenza: customer.citta_residenza,
            provincia_residenza: customer.provincia_residenza,
            codice_postale: customer.codice_postale,
            numero_civico: customer.numero_civico,
          }

          if (!customerMap.has(key)) {
            // Add new customer
            customerMap.set(key, extendedData)
          } else {
            // Update existing customer with extended data (merge)
            const existing = customerMap.get(key)!
            customerMap.set(key, {
              ...existing,
              ...extendedData,
              // Keep earlier created_at if it exists
              created_at: existing.created_at || extendedData.created_at
            })
          }
        })
      }

      // Also get customers from customers table if it exists
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

      // Get users who have uploaded documents to storage
      const usersWithDocuments = new Set<string>()

      // Check driver-licenses bucket
      try {
        const { data: licenseFiles, error: licenseError } = await supabase.storage
          .from('driver-licenses')
          .list()

        if (!licenseError && licenseFiles) {
          licenseFiles.forEach(folder => {
            if (folder.name && folder.name.length > 10) { // Folders are user IDs
              usersWithDocuments.add(folder.name)
            }
          })
        }
      } catch (e) {
        console.error('Error listing driver-licenses:', e)
      }

      // Check driver-ids bucket
      try {
        const { data: idFiles, error: idError } = await supabase.storage
          .from('driver-ids')
          .list()

        if (!idError && idFiles) {
          idFiles.forEach(folder => {
            if (folder.name && folder.name.length > 10) { // Folders are user IDs
              usersWithDocuments.add(folder.name)
            }
          })
        }
      } catch (e) {
        console.error('Error listing driver-ids:', e)
      }

      // Fetch user data for users with documents who aren't already in customerMap
      for (const userId of usersWithDocuments) {
        if (!customerMap.has(userId)) {
          try {
            const { data, error } = await supabase.auth.admin.getUserById(userId)
            if (!error && data?.user) {
              const metadata = data.user.user_metadata || {}
              customerMap.set(userId, {
                id: userId,
                full_name: metadata.full_name || metadata.fullName || data.user.email?.split('@')[0] || 'Cliente',
                email: data.user.email || metadata.email || null,
                phone: metadata.phone || null,
                driver_license_number: null,
                notes: null,
                created_at: data.user.created_at || new Date().toISOString(),
                updated_at: data.user.updated_at || new Date().toISOString(),
                verification: metadata.verification
              })
            }
          } catch (e) {
            console.error('Error fetching user with documents:', userId, e)
          }
        }
      }

      console.log('Users with uploaded documents:', usersWithDocuments.size)

      // Get verification status, phone, and documents from auth.users metadata
      const customersArray = Array.from(customerMap.values())
      const enrichedCustomers = await Promise.all(
        customersArray.map(async (customer) => {
          if (customer.id && customer.id.length > 10) { // Valid UUID
            try {
              const { data, error } = await supabase.auth.admin.getUserById(customer.id)
              if (!error && data?.user) {
                const metadata = data.user.user_metadata || {}
                return {
                  ...customer,
                  // Use phone from user_metadata if customer doesn't have one
                  phone: customer.phone || metadata.phone || null,
                  verification: metadata.verification
                }
              }
            } catch (e) {
              console.error('Error fetching verification for user:', customer.id, e)
            }
          }
          return customer
        })
      )

      setCustomers(enrichedCustomers)
    } catch (error) {
      console.error('Failed to load customers:', error)
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



  function handleEdit(customer: Customer) {
    setSelectedCustomer(customer)
    setShowNewClientModal(true)
  }

  async function fetchCustomerDocuments(userId: string) {
    setLoadingDocuments(true)
    setDocumentsUrls({ licenses: [], ids: [], codiceFiscale: [] })

    try {
      // FIRST: Check database for existing document records
      const { data: dbDocuments } = await supabase
        .from('user_documents')
        .select('*')
        .eq('user_id', userId)

      console.log('Database documents found:', dbDocuments?.length || 0, dbDocuments)

      // SECOND: List files in storage buckets
      const { data: licenseFiles, error: licenseError } = await supabase.storage
        .from('driver-licenses')
        .list(userId, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } })

      if (licenseError) {
        console.error('Error listing license files:', licenseError)
      }

      const { data: idFiles, error: idError } = await supabase.storage
        .from('driver-ids')
        .list(userId, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } })

      if (idError) {
        console.error('Error listing ID files:', idError)
      }

      const { data: codiceFiscaleFiles, error: codiceFiscaleError } = await supabase.storage
        .from('codice-fiscale')
        .list(userId, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } })

      if (codiceFiscaleError) {
        console.error('Error listing Codice Fiscale files:', codiceFiscaleError)
      }

      const licenseUrls: Array<{ url: string; fileName: string }> = []
      const idUrls: Array<{ url: string; fileName: string }> = []
      const codiceFiscaleUrls: Array<{ url: string; fileName: string }> = []

      // THIRD: Process database documents if they exist
      if (dbDocuments && dbDocuments.length > 0) {
        console.log('[CustomersTab] Processing database documents:', dbDocuments)

        for (const doc of dbDocuments) {
          // Use the bucket stored in the database record
          const bucket = (doc as any).bucket || 'driver-ids'

          console.log('[CustomersTab] Processing document:', {
            document_type: doc.document_type,
            bucket: bucket,
            file_path: doc.file_path,
            status: doc.status
          })

          // Get signed URL from the file_path stored in database
          const { data: signedUrl, error: urlError } = await supabase.storage
            .from(bucket)
            .createSignedUrl(doc.file_path, 3600)

          if (urlError) {
            console.error('[CustomersTab] Error creating signed URL:', urlError)
            continue
          }

          if (signedUrl?.signedUrl) {
            const fileName = doc.file_path.split('/').pop() || doc.document_type

            // Map to correct category based on bucket
            if (bucket === 'driver-licenses') {
              licenseUrls.push({ url: signedUrl.signedUrl, fileName })
            } else if (bucket === 'codice-fiscale') {
              codiceFiscaleUrls.push({ url: signedUrl.signedUrl, fileName })
            } else if (bucket === 'carta-identita' || bucket === 'driver-ids') {
              idUrls.push({ url: signedUrl.signedUrl, fileName })
            }
          }
        }

        console.log('[CustomersTab] Processed URLs:', {
          licenses: licenseUrls.length,
          ids: idUrls.length,
          codiceFiscale: codiceFiscaleUrls.length
        })
      }

      // FOURTH: Filter and process storage bucket files
      const actualLicenseFiles = licenseFiles?.filter(file => file.id && !file.name.includes('.emptyFolderPlaceholder')) || []
      const actualIdFiles = idFiles?.filter(file => file.id && !file.name.includes('.emptyFolderPlaceholder')) || []
      const actualCodiceFiscaleFiles = codiceFiscaleFiles?.filter(file => file.id && !file.name.includes('.emptyFolderPlaceholder')) || []

      console.log('Storage - License files found:', actualLicenseFiles.length, actualLicenseFiles)
      console.log('Storage - ID files found:', actualIdFiles.length, actualIdFiles)
      console.log('Storage - Codice Fiscale files found:', actualCodiceFiscaleFiles.length, actualCodiceFiscaleFiles)

      // FIFTH: Get signed URLs for storage files (avoid duplicates with database files)
      const existingFileNames = new Set([
        ...licenseUrls.map(u => u.fileName),
        ...idUrls.map(u => u.fileName),
        ...codiceFiscaleUrls.map(u => u.fileName)
      ])

      // Get signed URLs for driver licenses not already in database
      for (const licenseFile of actualLicenseFiles) {
        if (!existingFileNames.has(licenseFile.name)) {
          const { data: signedLicense, error: signError } = await supabase.storage
            .from('driver-licenses')
            .createSignedUrl(`${userId}/${licenseFile.name}`, 3600)

          if (signError) {
            console.error('Error creating signed URL for license:', signError)
          } else if (signedLicense?.signedUrl) {
            licenseUrls.push({ url: signedLicense.signedUrl, fileName: licenseFile.name })
          }
        }
      }

      // Get signed URLs for IDs not already in database
      for (const idFile of actualIdFiles) {
        if (!existingFileNames.has(idFile.name)) {
          const { data: signedId, error: signError } = await supabase.storage
            .from('driver-ids')
            .createSignedUrl(`${userId}/${idFile.name}`, 3600)

          if (signError) {
            console.error('Error creating signed URL for ID:', signError)
          } else if (signedId?.signedUrl) {
            idUrls.push({ url: signedId.signedUrl, fileName: idFile.name })
          }
        }
      }

      // Get signed URLs for Codice Fiscale not already in database
      for (const cfFile of actualCodiceFiscaleFiles) {
        if (!existingFileNames.has(cfFile.name)) {
          const { data: signedCF, error: signError } = await supabase.storage
            .from('codice-fiscale')
            .createSignedUrl(`${userId}/${cfFile.name}`, 3600)

          if (signError) {
            console.error('Error creating signed URL for Codice Fiscale:', signError)
          } else if (signedCF?.signedUrl) {
            codiceFiscaleUrls.push({ url: signedCF.signedUrl, fileName: cfFile.name })
          }
        }
      }

      console.log('Total documents loaded - Licenses:', licenseUrls.length, 'IDs:', idUrls.length, 'CF:', codiceFiscaleUrls.length)

      setDocumentsUrls({ licenses: licenseUrls, ids: idUrls, codiceFiscale: codiceFiscaleUrls })
    } catch (error) {
      console.error('Error fetching documents:', error)
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
          newStatus === 'has_rental' ? 'Ha Noleggiato' : 'Nessuno'
      alert(`✅ Status aggiornato a: ${statusLabel}`)
    } catch (error: any) {
      console.error('Error updating customer status:', error)
      alert('❌ Errore nell\'aggiornamento dello status')
    }
  }

  async function handleSendGiftVouchers(data: { subject: string; message: string; image: File | null }) {
    if (!data.image) {
      alert('Immagine richiesta')
      return
    }

    try {
      const selectedCustomers = customers.filter(c => selectedCustomerIds.has(c.id))

      const reader = new FileReader()
      const imageBase64 = await new Promise<string>((resolve, reject) => {
        reader.onloadend = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(data.image!)
      })

      const response = await fetch('/.netlify/functions/send-gift-voucher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customers: selectedCustomers.map(c => ({
            id: c.id,
            nome: c.nome || c.full_name.split(' ')[0],
            cognome: c.cognome || c.full_name.split(' ').slice(1).join(' '),
            email: c.email
          })),
          subject: data.subject,
          message: data.message,
          imageBase64,
          imageName: data.image.name
        })
      })

      const result = await response.json()

      if (result.success) {
        alert(`✅ Buoni regalo inviati con successo a ${result.sent} ${result.sent === 1 ? 'cliente' : 'clienti'}!`)
        setSelectedCustomerIds(new Set())
      } else {
        throw new Error(result.error || 'Errore sconosciuto')
      }
    } catch (error: any) {
      console.error('Error sending gift vouchers:', error)
      alert('❌ Errore nell\'invio dei buoni regalo: ' + (error.message || 'Errore sconosciuto'))
    }
  }

  if (loading) {
    return <div className="text-center py-8 text-gray-400">Caricamento...</div>
  }

  return (
    <div>
      {/* Customer Details Modal - For Fattura Generation */}
      {viewingCustomerDetails && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-gray-900 border-b border-gray-700 p-6 flex justify-between items-center">
              <h3 className="text-xl font-bold text-white">
                Dettagli Cliente Completi - {viewingCustomerDetails.full_name}
              </h3>
              <button
                onClick={() => setViewingCustomerDetails(null)}
                className="text-gray-400 hover:text-white"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-6">
              {/* Customer Type Badge */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Tipo Cliente:</span>
                <span className={`px-3 py-1 rounded text-sm font-medium ${viewingCustomerDetails.tipo_cliente === 'persona_fisica'
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

              {/* Persona Fisica Details */}
              {viewingCustomerDetails.tipo_cliente === 'persona_fisica' && (
                <div className="bg-gray-800 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-gray-300 mb-3 border-b border-gray-700 pb-2">
                    Dati Persona Fisica
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <span className="text-sm text-gray-400">Nome:</span>
                      <p className="text-sm text-white font-medium">{viewingCustomerDetails.nome || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-gray-400">Cognome:</span>
                      <p className="text-sm text-white font-medium">{viewingCustomerDetails.cognome || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-gray-400">Sesso:</span>
                      <p className="text-sm text-white font-medium">{viewingCustomerDetails.sesso || viewingCustomerDetails.metadata?.sesso || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-gray-400">Codice Fiscale:</span>
                      <p className="text-sm text-white font-medium font-mono">{viewingCustomerDetails.codice_fiscale || '-'}</p>
                    </div>
                    {/* Duplicate Sesso removed */}
                    <div>
                      <span className="text-sm text-gray-400">Data di Nascita:</span>
                      <p className="text-sm text-white font-medium">{viewingCustomerDetails.data_nascita || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-gray-400">Luogo di Nascita:</span>
                      <p className="text-sm text-white font-medium">
                        {viewingCustomerDetails.luogo_nascita ? `${viewingCustomerDetails.luogo_nascita} (${viewingCustomerDetails.metadata?.provincia_nascita || '-'})` : '-'}
                      </p>
                    </div>
                    <div>
                      <span className="text-sm text-gray-400">Numero Patente:</span>
                      <p className="text-sm text-white font-medium font-mono">{viewingCustomerDetails.patente || viewingCustomerDetails.driver_license_number || '-'}</p>
                    </div>
                    <div className="md:col-span-2">
                      <span className="text-sm text-gray-400">Indirizzo:</span>
                      <p className="text-sm text-white font-medium">
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
                      <span className="text-sm text-gray-400">Numero Civico:</span>
                      <p className="text-sm text-white font-medium">
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
                      <span className="text-sm text-gray-400">Città di Residenza:</span>
                      <p className="text-sm text-white font-medium">{viewingCustomerDetails.citta_residenza || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-gray-400">CAP:</span>
                      <p className="text-sm text-white font-medium">{viewingCustomerDetails.codice_postale || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-gray-400">PEC:</span>
                      <p className="text-sm text-white font-medium">{viewingCustomerDetails.pec || '-'}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Azienda Details */}
              {viewingCustomerDetails.tipo_cliente === 'azienda' && (
                <div className="bg-gray-800 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-gray-300 mb-3 border-b border-gray-700 pb-2">
                    Dati Azienda
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="md:col-span-2">
                      <span className="text-sm text-gray-400">Ragione Sociale / Denominazione:</span>
                      <p className="text-sm text-white font-medium">{viewingCustomerDetails.ragione_sociale || viewingCustomerDetails.denominazione || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-gray-400">Partita IVA:</span>
                      <p className="text-sm text-white font-medium font-mono">{viewingCustomerDetails.partita_iva || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-gray-400">Codice Fiscale:</span>
                      <p className="text-sm text-white font-medium font-mono">{viewingCustomerDetails.codice_fiscale || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-gray-400">Codice Destinatario:</span>
                      <p className="text-sm text-white font-medium font-mono">{viewingCustomerDetails.codice_destinatario || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-gray-400">PEC:</span>
                      <p className="text-sm text-white font-medium">{viewingCustomerDetails.pec || '-'}</p>
                    </div>
                    <div className="md:col-span-2">
                      <span className="text-sm text-gray-400">Indirizzo Sede Legale:</span>
                      <p className="text-sm text-white font-medium">{viewingCustomerDetails.indirizzo_azienda || viewingCustomerDetails.indirizzo || '-'}</p>
                    </div>
                    <div className="md:col-span-2">
                      <span className="text-sm text-gray-400">Sede Operativa:</span>
                      <p className="text-sm text-white font-medium">{viewingCustomerDetails.metadata?.sede_operativa || '-'}</p>
                    </div>
                    <div className="md:col-span-2">
                      <span className="text-sm text-gray-400">Indirizzo DDT:</span>
                      <p className="text-sm text-white font-medium">{viewingCustomerDetails.indirizzo_ddt || '-'}</p>
                    </div>
                    <div className="md:col-span-2">
                      <span className="text-sm text-gray-400">Contatti Cliente:</span>
                      <p className="text-sm text-white font-medium">{viewingCustomerDetails.contatti_cliente || '-'}</p>
                    </div>
                  </div>

                  {/* Rappresentante Legale Info */}
                  <div className="mt-4 border-t border-gray-700 pt-3">
                    <h5 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Rappresentante Legale</h5>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <span className="text-sm text-gray-400">Nome Completo:</span>
                        <p className="text-sm text-white font-medium">
                          {viewingCustomerDetails.metadata?.rappresentante?.nome} {viewingCustomerDetails.metadata?.rappresentante?.cognome}
                        </p>
                      </div>
                      <div>
                        <span className="text-sm text-gray-400">CF Rappresentante:</span>
                        <p className="text-sm text-white font-medium font-mono">{viewingCustomerDetails.metadata?.rappresentante?.cf || '-'}</p>
                      </div>
                      <div>
                        <span className="text-sm text-gray-400">Ruolo:</span>
                        <p className="text-sm text-white font-medium">{viewingCustomerDetails.metadata?.rappresentante?.ruolo || '-'}</p>
                      </div>
                    </div>
                    <div className="mt-2">
                      <p className="text-xs text-gray-500 mb-1">Documento Identità:</p>
                      <p className="text-sm text-white">
                        {viewingCustomerDetails.metadata?.rappresentante?.documento?.tipo} n. {viewingCustomerDetails.metadata?.rappresentante?.documento?.numero}
                      </p>
                      <p className="text-xs text-gray-400">
                        Rilasciato il {viewingCustomerDetails.metadata?.rappresentante?.documento?.rilascio} a {viewingCustomerDetails.metadata?.rappresentante?.documento?.luogo}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Pubblica Amministrazione Details */}
              {viewingCustomerDetails.tipo_cliente === 'pubblica_amministrazione' && (
                <div className="bg-gray-800 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-gray-300 mb-3 border-b border-gray-700 pb-2">
                    Dati Pubblica Amministrazione
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="md:col-span-2">
                      <span className="text-sm text-gray-400">Ente o Ufficio:</span>
                      <p className="text-sm text-white font-medium">{viewingCustomerDetails.ente_ufficio || viewingCustomerDetails.denominazione || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-gray-400">Codice Univoco:</span>
                      <p className="text-sm text-white font-medium font-mono">{viewingCustomerDetails.codice_univoco || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-gray-400">Codice Fiscale:</span>
                      <p className="text-sm text-white font-medium font-mono">{viewingCustomerDetails.codice_fiscale_pa || viewingCustomerDetails.codice_fiscale || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-gray-400">Codice IPA:</span>
                      <p className="text-sm text-white font-medium font-mono">{viewingCustomerDetails.codice_ipa || '-'}</p>
                    </div>
                    <div>
                      <span className="text-sm text-gray-400">Citta:</span>
                      <p className="text-sm text-white font-medium">{viewingCustomerDetails.citta || '-'}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Common Contact Information */}
              <div className="bg-gray-800 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-gray-300 mb-3 border-b border-gray-700 pb-2">
                  Informazioni di Contatto
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <span className="text-sm text-gray-400">Email:</span>
                    <p className="text-sm text-white font-medium">{viewingCustomerDetails.email || '-'}</p>
                  </div>
                  <div>
                    <span className="text-sm text-gray-400">Telefono:</span>
                    <p className="text-sm text-white font-medium">{viewingCustomerDetails.telefono || viewingCustomerDetails.phone || '-'}</p>
                  </div>
                  <div>
                    <span className="text-sm text-gray-400">Numero Patente:</span>
                    <p className="text-sm text-white font-medium font-mono">{viewingCustomerDetails.patente || viewingCustomerDetails.driver_license_number || '-'}</p>
                  </div>
                  <div>
                    <span className="text-sm text-gray-400">Nazione:</span>
                    <p className="text-sm text-white font-medium">{viewingCustomerDetails.nazione || '-'}</p>
                  </div>
                  <div>
                    <span className="text-sm text-gray-400">Fonte:</span>
                    <p className="text-sm text-white font-medium">
                      {viewingCustomerDetails.source === 'admin' ? 'Pannello Admin' : viewingCustomerDetails.source === 'website' ? 'Sito Web' : '-'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Metadata */}
              <div className="bg-gray-800 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-gray-300 mb-3 border-b border-gray-700 pb-2">
                  Metadata
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <span className="text-sm text-gray-400">Data Creazione:</span>
                    <p className="text-sm text-white font-medium">
                      {new Date(viewingCustomerDetails.created_at).toLocaleString('it-IT')}
                    </p>
                  </div>
                  <div>
                    <span className="text-sm text-gray-400">Ultimo Aggiornamento:</span>
                    <p className="text-sm text-white font-medium">
                      {new Date(viewingCustomerDetails.updated_at).toLocaleString('it-IT')}
                    </p>
                  </div>
                </div>
              </div>

              {/* Action Button */}
              <div className="flex justify-end pt-4 border-t border-gray-700">
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
      )}

      {/* Documents Modal */}
      {viewingDocuments && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-gray-900 border-b border-gray-700 p-6 flex justify-between items-center">
              <h3 className="text-xl font-bold text-white">
                Documenti - {viewingDocuments.full_name}
              </h3>
              <button
                onClick={() => setViewingDocuments(null)}
                className="text-gray-400 hover:text-white"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-6">
              {/* Customer Info */}
              <div className="bg-gray-800 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-gray-300 mb-3">Informazioni Cliente</h4>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-400">Email:</span>
                    <span className="text-sm text-white">{viewingDocuments.email || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-400">Telefono:</span>
                    <span className="text-sm text-white">{viewingDocuments.phone || '-'}</span>
                  </div>
                </div>
              </div>

              {/* Uploaded Documents */}
              <div className="bg-gray-800 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-gray-300 mb-3">Documenti Caricati</h4>
                {loadingDocuments ? (
                  <div className="text-center py-4">
                    <p className="text-gray-400">Caricamento documenti...</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Driver's License */}
                    <div className="border border-gray-700 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-medium text-gray-300">
                          📄 Patente di Guida ({documentsUrls.licenses.length}/2)
                        </span>
                      </div>
                      {documentsUrls.licenses.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                          {documentsUrls.licenses.map((doc, index) => (
                            <div key={index} className="space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-gray-400">
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
                                    🗑️ Elimina
                                  </button>
                                </div>
                              </div>
                              <img
                                src={doc.url}
                                alt={`Patente di guida - ${index === 0 ? 'Fronte' : 'Retro'}`}
                                className="w-full rounded border border-gray-600"
                              />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500 italic mb-3">Nessun documento caricato</p>
                      )}
                      {/* Upload Section */}
                      {viewingDocuments.id && viewingDocuments.id.length > 10 && (
                        <div className="mt-3 pt-3 border-t border-gray-700">
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
                            <span className={`inline-block px-4 py-2 rounded text-sm font-medium text-center w-full cursor-pointer ${uploadingLicense
                              ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
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
                    <div className="border border-gray-700 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-medium text-gray-300">
                          🆔 Carta d'Identità / Passaporto ({documentsUrls.ids.length}/2)
                        </span>
                      </div>
                      {documentsUrls.ids.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                          {documentsUrls.ids.map((doc, index) => (
                            <div key={index} className="space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-gray-400">
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
                                    🗑️ Elimina
                                  </button>
                                </div>
                              </div>
                              <img
                                src={doc.url}
                                alt={`Carta d'identità - ${index === 0 ? 'Fronte' : 'Retro'}`}
                                className="w-full rounded border border-gray-600"
                              />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500 italic mb-3">Nessun documento caricato</p>
                      )}
                      {/* Upload Section */}
                      {viewingDocuments.id && viewingDocuments.id.length > 10 && (
                        <div className="mt-3 pt-3 border-t border-gray-700">
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
                            <span className={`inline-block px-4 py-2 rounded text-sm font-medium text-center w-full cursor-pointer ${uploadingId
                              ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
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
                    <div className="border border-gray-700 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-medium text-gray-300">
                          📋 Codice Fiscale ({documentsUrls.codiceFiscale.length}/2)
                        </span>
                      </div>
                      {documentsUrls.codiceFiscale.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                          {documentsUrls.codiceFiscale.map((doc, index) => (
                            <div key={index} className="space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-gray-400">
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
                                    🗑️ Elimina
                                  </button>
                                </div>
                              </div>
                              <img
                                src={doc.url}
                                alt={`Codice Fiscale - ${index === 0 ? 'Fronte' : 'Retro'}`}
                                className="w-full rounded border border-gray-600"
                              />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500 italic mb-3">Nessun documento caricato</p>
                      )}
                      {/* Upload Section */}
                      {viewingDocuments.id && viewingDocuments.id.length > 10 && (
                        <div className="mt-3 pt-3 border-t border-gray-700">
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
                            <span className={`inline-block px-4 py-2 rounded text-sm font-medium text-center w-full cursor-pointer ${uploadingCodiceFiscale
                              ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
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
                <div className="bg-gray-800 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-gray-300 mb-2">Note</h4>
                  <p className="text-sm text-white whitespace-pre-wrap">{viewingDocuments.notes}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Stats Card */}
      <div className="mb-6 bg-gradient-to-r from-dr7-gold/20 to-dr7-gold/5 border border-dr7-gold/30 rounded-lg p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-400 mb-1">Totale Clienti</p>
            <p className="text-4xl font-bold text-dr7-gold">{customers.length}</p>
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
          <h2 className="text-2xl font-bold text-white">Clienti</h2>
          <div className="flex gap-3">
            {selectedCustomerIds.size > 0 && (
              <Button
                onClick={() => setShowGiftVoucherModal(true)}
                variant="secondary"
              >
                🎁 Invia Buono Regalo ({selectedCustomerIds.size})
              </Button>
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
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 pl-10 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-dr7-gold focus:border-transparent"
          />
          <svg
            className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>



      <div className="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-black">
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
                    className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-dr7-gold focus:ring-dr7-gold"
                  />
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-white">Nome</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-white">Tipo Cliente</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-white">Status</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-white">Email</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-white">Telefono</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-white">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {customers
                .filter((customer) => {
                  if (!searchQuery) return true
                  const query = searchQuery.toLowerCase()
                  return (
                    customer.full_name.toLowerCase().includes(query) ||
                    customer.email?.toLowerCase().includes(query) ||
                    customer.phone?.toLowerCase().includes(query)
                  )
                })
                .map((customer) => (
                  <tr key={customer.id} className="border-t border-gray-700 hover:bg-gray-800">
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
                        className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-dr7-gold focus:ring-dr7-gold"
                      />
                    </td>
                    <td className="px-4 py-3 text-sm text-white">{customer.full_name}</td>
                    <td className="px-4 py-3 text-sm">
                      {customer.tipo_cliente ? (
                        <span className={`px-2 py-1 rounded text-xs font-medium ${customer.tipo_cliente === 'persona_fisica'
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
                    <td className="px-4 py-3 text-sm">
                      <div className="flex gap-2 items-center">
                        {customer.status === 'blacklist' && (
                          <span className="px-2 py-1 rounded text-xs font-medium bg-black text-white border border-white">
                            ⛔ Blacklist
                          </span>
                        )}
                        {customer.status === 'vip' && (
                          <span className="px-2 py-1 rounded text-xs font-medium bg-yellow-500 text-black">
                            ⭐ VIP
                          </span>
                        )}
                        {customer.status === 'has_rental' && (
                          <span className="px-2 py-1 rounded text-xs font-medium bg-green-500 text-black">
                            ✓ Ha Noleggiato
                          </span>
                        )}
                        {!customer.status && (
                          <div className="flex gap-1">
                            <button
                              onClick={() => handleUpdateCustomerStatus(customer.id, 'blacklist')}
                              className="px-2 py-1 rounded text-xs bg-black text-white hover:bg-gray-800"
                              title="Blacklist"
                            >
                              ⛔
                            </button>
                            <button
                              onClick={() => handleUpdateCustomerStatus(customer.id, 'vip')}
                              className="px-2 py-1 rounded text-xs bg-yellow-500 text-black hover:bg-yellow-600"
                              title="VIP"
                            >
                              ⭐
                            </button>
                            <button
                              onClick={() => handleUpdateCustomerStatus(customer.id, 'has_rental')}
                              className="px-2 py-1 rounded text-xs bg-green-500 text-black hover:bg-green-600"
                              title="Ha Noleggiato"
                            >
                              ✓
                            </button>
                          </div>
                        )}
                        {customer.status && (
                          <button
                            onClick={() => handleUpdateCustomerStatus(customer.id, null)}
                            className="px-2 py-1 rounded text-xs bg-gray-700 text-white hover:bg-gray-600"
                            title="Rimuovi Status"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-white">{customer.email || '-'}</td>
                    <td className="px-4 py-3 text-sm text-white">{customer.phone || '-'}</td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex gap-2 flex-wrap">
                        <Button
                          onClick={() => setViewingCustomerDetails(customer)}
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
                          className="text-xs py-1 px-3"
                        >
                          Modifica
                        </Button>
                        <Button
                          onClick={() => handleDelete(customer.id)}
                          variant="secondary"
                          className="text-xs py-1 px-3 bg-red-900 hover:bg-red-800"
                        >
                          Elimina
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              {customers.filter((customer) => {
                if (!searchQuery) return true
                const query = searchQuery.toLowerCase()
                return (
                  customer.full_name.toLowerCase().includes(query) ||
                  customer.email?.toLowerCase().includes(query) ||
                  customer.phone?.toLowerCase().includes(query)
                )
              }).length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                      {searchQuery ? `Nessun cliente trovato per "${searchQuery}"` : 'Nessun cliente trovato'}
                    </td>
                  </tr>
                )}
            </tbody>
          </table>
        </div>
      </div>

      <NewClientModal
        isOpen={showNewClientModal}
        onClose={() => {
          setShowNewClientModal(false)
          setSelectedCustomer(null)
        }}
        onClientCreated={() => {
          setShowNewClientModal(false)
          setSelectedCustomer(null)
          loadCustomers()
        }}
        initialData={selectedCustomer}
      />

      <GiftVoucherModal
        isOpen={showGiftVoucherModal}
        onClose={() => setShowGiftVoucherModal(false)}
        selectedCustomers={customers.filter(c => selectedCustomerIds.has(c.id)).map(c => ({
          id: c.id,
          nome: c.nome,
          cognome: c.cognome,
          email: c.email
        }))}
        onSend={handleSendGiftVouchers}
      />
    </div>
  )
}
