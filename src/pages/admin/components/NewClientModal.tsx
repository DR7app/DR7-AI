import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../../../supabaseClient'
import { getResidenceStatus, getProvinciaByCity, getCAPByCity } from '../../../data/sardegnaProvince'
import toast from 'react-hot-toast'
import { logger } from '../../../utils/logger'
import { authFetch } from '../../../utils/authFetch'
import CalcolaCFButton from '../../../components/CalcolaCFButton'
import CompilaButton, { type ExtractedData, type DataConflict } from '../../../components/CompilaButton'

interface NewClientModalProps {
  isOpen: boolean
  onClose: () => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onClientCreated?: (clientId: string, customerData?: any) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialData?: any // Can be Customer type, but using any for flexibility with the complex objects
}

type ClientType = 'persona_fisica' | 'azienda' | 'pubblica_amministrazione'

interface ClientFormData {
  tipo_cliente: ClientType
  // Global fields
  nazione: string
  telefono: string
  email: string

  // Persona Fisica
  nome: string
  cognome: string
  codice_fiscale: string
  sesso: 'M' | 'F' | 'Altro' | ''
  data_nascita: string
  luogo_nascita: string
  provincia_nascita: string
  indirizzo: string
  numero_civico: string
  codice_postale: string
  citta_residenza: string
  provincia_residenza: string
  pec_persona: string

  // Patente Persona Fisica
  patente_numero: string
  patente_tipo: string
  patente_ente: string
  patente_rilascio: string
  patente_scadenza: string

  // Azienda
  denominazione: string
  partita_iva: string
  codice_destinatario: string
  indirizzo_azienda: string
  sede_operativa: string
  cf_azienda: string
  sede_legale: string
  pec_azienda: string
  indirizzo_ddt: string
  contatti_cliente: string

  // Rappresentante Legale
  rappresentante_nome: string
  rappresentante_cognome: string
  rappresentante_cf: string
  rappresentante_data_nascita: string
  rappresentante_luogo_nascita: string
  rappresentante_ruolo: string
  rappresentante_doc_tipo: string
  rappresentante_doc_numero: string
  rappresentante_doc_rilascio: string
  rappresentante_doc_scadenza: string
  rappresentante_doc_luogo: string
  rappresentante_patente: string

  // Pubblica Amministrazione
  codice_univoco: string
  cf_pa: string
  ente_ufficio: string
  citta: string
  partita_iva_pa: string
  pec_pa: string
  note: string // Added note field
}

export default function NewClientModal({ isOpen, onClose, onClientCreated, initialData }: NewClientModalProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState<ClientFormData>({
    tipo_cliente: 'persona_fisica',
    nazione: 'Italia',
    telefono: '',
    email: '',
    nome: '',
    cognome: '',
    codice_fiscale: '',
    sesso: '',
    data_nascita: '',
    luogo_nascita: '',
    provincia_nascita: '',
    indirizzo: '',
    numero_civico: '',
    codice_postale: '',
    citta_residenza: '',
    provincia_residenza: '',
    pec_persona: '',
    patente_numero: '',
    patente_tipo: '',
    patente_ente: '',
    patente_rilascio: '',
    patente_scadenza: '',
    denominazione: '',
    partita_iva: '',
    codice_destinatario: '',
    indirizzo_azienda: '',
    sede_operativa: '',
    cf_azienda: '',
    sede_legale: '',
    pec_azienda: '',
    indirizzo_ddt: '',
    contatti_cliente: '',
    rappresentante_nome: '',
    rappresentante_cognome: '',
    rappresentante_cf: '',
    rappresentante_data_nascita: '',
    rappresentante_luogo_nascita: '',
    rappresentante_ruolo: '',
    rappresentante_doc_tipo: '',
    rappresentante_doc_numero: '',
    rappresentante_doc_rilascio: '',
    rappresentante_doc_scadenza: '',
    rappresentante_doc_luogo: '',
    rappresentante_patente: '',
    codice_univoco: '',
    cf_pa: '',
    ente_ufficio: '',
    citta: '',
    partita_iva_pa: '',
    pec_pa: '',
    note: ''
  })

  // Populate form data when initialData changes
  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        logger.log('[NewClientModal] Populating modal with data:', initialData)
        logger.log('[NewClientModal] Setting editingId to:', initialData.id)
        setEditingId(initialData.id || null)

        // Determine type
        const type: ClientType = initialData.tipo_cliente || 'persona_fisica'

        // Parse metadata safely
        const metadata = initialData.metadata || {}

        setFormData({
          tipo_cliente: type,
          // Global
          nazione: initialData.nazione || 'Italia',
          telefono: initialData.phone || initialData.telefono || '',
          email: initialData.email || '',

          // Persona Fisica
          nome: initialData.nome || (initialData.full_name ? initialData.full_name.split(' ')[0] : ''),
          cognome: initialData.cognome || (initialData.full_name ? initialData.full_name.split(' ').slice(1).join(' ') : ''),
          codice_fiscale: initialData.codice_fiscale || '',
          sesso: metadata.sesso || initialData.sesso || '',
          data_nascita: initialData.data_nascita || '',
          luogo_nascita: initialData.luogo_nascita || '',
          provincia_nascita: metadata.provincia_nascita || initialData.provincia_nascita || '',
          // Parse address to separate street number if needed
          indirizzo: (() => {
            const fullAddress = initialData.indirizzo || '';
            const numberMatch = fullAddress.match(/\s+(\d+[a-zA-Z]?)$/);
            // If there's a number at the end and no numero_civico, extract just the street
            if (numberMatch && !initialData.numero_civico) {
              return fullAddress.replace(/\s+\d+[a-zA-Z]?$/, '').trim();
            }
            return fullAddress;
          })(),
          numero_civico: (() => {
            // If numero_civico exists, use it
            if (initialData.numero_civico) {
              return initialData.numero_civico;
            }
            // Otherwise try to extract from indirizzo
            const fullAddress = initialData.indirizzo || '';
            const numberMatch = fullAddress.match(/\s+(\d+[a-zA-Z]?)$/);
            return numberMatch ? numberMatch[1] : '';
          })(),
          codice_postale: initialData.codice_postale || '',
          citta_residenza: initialData.citta_residenza || '',
          provincia_residenza: initialData.provincia_residenza || '',
          pec_persona: initialData.pec || '',

          // Patente
          patente_numero: metadata.patente?.numero || initialData.numero_patente || initialData.driver_license_number || initialData.patente || '',
          patente_tipo: metadata.patente?.tipo || initialData.tipo_patente || '',
          patente_ente: metadata.patente?.ente || initialData.emessa_da || '',
          patente_rilascio: metadata.patente?.rilascio || initialData.data_rilascio_patente || '',
          patente_scadenza: metadata.patente?.scadenza || initialData.scadenza_patente || '',

          // Azienda
          denominazione: initialData.ragione_sociale || initialData.denominazione || '',
          partita_iva: initialData.partita_iva || '',
          codice_destinatario: initialData.codice_destinatario || '',
          indirizzo_azienda: initialData.indirizzo_azienda || initialData.indirizzo || '',
          sede_operativa: metadata.sede_operativa || '',
          cf_azienda: initialData.codice_fiscale || '',
          sede_legale: initialData.sede_legale || initialData.indirizzo || '',
          pec_azienda: initialData.pec || '',
          indirizzo_ddt: metadata.indirizzo_ddt || initialData.indirizzo_ddt || '',
          contatti_cliente: metadata.contatti_cliente || initialData.contatti_cliente || '',

          // Rappresentante
          rappresentante_nome: metadata.rappresentante?.nome || '',
          rappresentante_cognome: metadata.rappresentante?.cognome || '',
          rappresentante_cf: metadata.rappresentante?.cf || '',
          rappresentante_data_nascita: metadata.rappresentante?.data_nascita || '',
          rappresentante_luogo_nascita: metadata.rappresentante?.luogo_nascita || '',
          rappresentante_ruolo: metadata.rappresentante?.ruolo || '',
          rappresentante_doc_tipo: metadata.rappresentante?.documento?.tipo || '',
          rappresentante_doc_numero: metadata.rappresentante?.documento?.numero || '',
          rappresentante_doc_rilascio: metadata.rappresentante?.documento?.rilascio || '',
          rappresentante_doc_scadenza: metadata.rappresentante?.documento?.scadenza || '',
          rappresentante_doc_luogo: metadata.rappresentante?.documento?.luogo || '',
          rappresentante_patente: metadata.rappresentante?.patente || '',

          // PA
          codice_univoco: initialData.codice_univoco || '',
          cf_pa: initialData.codice_fiscale_pa || initialData.codice_fiscale || '',
          ente_ufficio: initialData.ente_ufficio || initialData.denominazione || '',
          citta: initialData.citta || '',
          partita_iva_pa: initialData.partita_iva || '',
          pec_pa: initialData.pec || '',
          note: initialData.notes || initialData.note || ''
        })
      } else {
        // Reset if opening in new mode
        logger.log('[NewClientModal] Opening in NEW mode - resetting form')
        setEditingId(null)
        setFormData({
          tipo_cliente: 'persona_fisica',
          nazione: 'Italia',
          telefono: '',
          email: '',
          nome: '',
          cognome: '',
          codice_fiscale: '',
          sesso: '',
          data_nascita: '',
          luogo_nascita: '',
          provincia_nascita: '',
          indirizzo: '',
          numero_civico: '',
          codice_postale: '',
          citta_residenza: '',
          provincia_residenza: '',
          pec_persona: '',
          patente_numero: '',
          patente_tipo: '',
          patente_ente: '',
          patente_rilascio: '',
          patente_scadenza: '',
          denominazione: '',
          partita_iva: '',
          codice_destinatario: '',
          indirizzo_azienda: '',
          sede_operativa: '',
          cf_azienda: '',
          sede_legale: '',
          pec_azienda: '',
          indirizzo_ddt: '',
          contatti_cliente: '',
          rappresentante_nome: '',
          rappresentante_cognome: '',
          rappresentante_data_nascita: '',
          rappresentante_luogo_nascita: '',
          rappresentante_cf: '',
          rappresentante_ruolo: '',
          rappresentante_doc_tipo: '',
          rappresentante_doc_numero: '',
          rappresentante_doc_rilascio: '',
          rappresentante_doc_scadenza: '',
          rappresentante_doc_luogo: '',
          rappresentante_patente: '',
          codice_univoco: '',
          cf_pa: '',
          ente_ufficio: '',
          citta: '',
          partita_iva_pa: '',
          pec_pa: '',
          note: ''
        })
      }
    }
  }, [initialData, isOpen])

  // Start with empty errors
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSaving, setIsSaving] = useState(false)
  // Scrollable modal body — after "Compila" lo riportiamo in cima cosi'
  // l'admin vede subito i campi (nome, cognome, ecc.) appena riempiti
  // dall'estrazione.
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  // Riassunto dei campi compilati dall'ultima estrazione, per evidenziare
  // a colpo d'occhio cosa ha letto Claude dai documenti. null = niente
  // estrazione recente.
  const [lastExtracted, setLastExtracted] = useState<string[] | null>(null)

  // Optional document uploads
  const [showDocumentSection, setShowDocumentSection] = useState(false)
  const [driversLicenseFront, setDriversLicenseFront] = useState<File | null>(null)
  const [driversLicenseBack, setDriversLicenseBack] = useState<File | null>(null)
  const [identityFront, setIdentityFront] = useState<File | null>(null)
  const [identityBack, setIdentityBack] = useState<File | null>(null)
  const [codiceFiscaleFront, setCodiceFiscaleFront] = useState<File | null>(null)
  const [codiceFiscaleBack, setCodiceFiscaleBack] = useState<File | null>(null)

  // Handle scanned files from Scanner tab
  useEffect(() => {
    if (isOpen && initialData?.scannedFiles) {
      const files = initialData.scannedFiles
      logger.log('[NewClientModal] Loading scanned files:', Object.keys(files))

      if (files.identityFront) {
        setIdentityFront(files.identityFront)
      }
      if (files.identityBack) {
        setIdentityBack(files.identityBack)
      }
      if (files.driversLicenseFront) {
        setDriversLicenseFront(files.driversLicenseFront)
      }
      if (files.driversLicenseBack) {
        setDriversLicenseBack(files.driversLicenseBack)
      }

      // Auto-expand document section if we have scanned files
      setShowDocumentSection(true)
    }
  }, [initialData, isOpen])

  // Validation functions
  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email)
  }

  // Basic check for Italian tax code format (16 chars for persona fisica, 11 digits for azienda)
  const validateCodiceFiscale = (cf: string): boolean => {
    const clean = cf.replace(/\s/g, '')
    return /^[A-Z0-9]{16}$/i.test(clean) || /^[0-9]{11}$/.test(clean)
  }

  const validatePartitaIVA = (piva: string): boolean => {
    // 11 digits
    const pivaRegex = /^[0-9]{11}$/
    return pivaRegex.test(piva)
  }

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    // Only validate format when a value is provided — no fields are mandatory
    if (formData.email && !validateEmail(formData.email)) {
      newErrors.email = 'Formato email non valido'
    }

    if (formData.codice_fiscale && !validateCodiceFiscale(formData.codice_fiscale)) {
      newErrors.codice_fiscale = 'Formato Codice Fiscale non valido'
    }

    if (formData.partita_iva && !validatePartitaIVA(formData.partita_iva)) {
      newErrors.partita_iva = 'P.IVA non valida (11 cifre)'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSave = async () => {
    if (!validateForm()) return

    setIsSaving(true)
    try {
      // Auto-detect residence status based on provincia/città di residenza
      const residenceStatus = getResidenceStatus(formData.provincia_residenza, formData.citta_residenza)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const customerData: any = {
        tipo_cliente: formData.tipo_cliente,
        email: formData.email,
        telefono: formData.telefono,
        nazione: formData.nazione,
        note: formData.note,
        source: 'admin',
        created_at: new Date().toISOString(),
        residence_status: residenceStatus
      }

      // Populate data based on type
      if (formData.tipo_cliente === 'persona_fisica') {
        customerData.nome = formData.nome
        customerData.cognome = formData.cognome
        customerData.codice_fiscale = formData.codice_fiscale.toUpperCase()
        if (formData.data_nascita) customerData.data_nascita = formData.data_nascita
        if (formData.luogo_nascita) customerData.luogo_nascita = formData.luogo_nascita
        if (formData.provincia_nascita) customerData.provincia_nascita = formData.provincia_nascita
        customerData.indirizzo = formData.indirizzo
        if (formData.numero_civico) customerData.numero_civico = formData.numero_civico
        if (formData.codice_postale) customerData.codice_postale = formData.codice_postale.trim().substring(0, 10)
        if (formData.citta_residenza) customerData.citta_residenza = formData.citta_residenza
        if (formData.provincia_residenza) customerData.provincia_residenza = formData.provincia_residenza
        if (formData.pec_persona) customerData.pec = formData.pec_persona

        if (formData.patente_numero) {
          customerData.patente = formData.patente_numero.toUpperCase()
          customerData.numero_patente = formData.patente_numero.toUpperCase()
        }
        if (formData.patente_rilascio) customerData.data_rilascio_patente = formData.patente_rilascio
        if (formData.patente_scadenza) customerData.scadenza_patente = formData.patente_scadenza

        if (formData.patente_ente) customerData.emessa_da = formData.patente_ente
        if (formData.sesso) customerData.sesso = formData.sesso

        // Metadata
        customerData.metadata = {
          sesso: formData.sesso,
          provincia_nascita: formData.provincia_nascita,
          patente: {
            numero: formData.patente_numero,
            tipo: formData.patente_tipo,
            ente: formData.patente_ente,
            rilascio: formData.patente_rilascio,
            scadenza: formData.patente_scadenza
          }
        }

      } else if (formData.tipo_cliente === 'azienda') {
        customerData.ragione_sociale = formData.denominazione
        customerData.partita_iva = formData.partita_iva
        if (formData.cf_azienda) customerData.codice_fiscale = formData.cf_azienda.toUpperCase()
        customerData.sede_legale = formData.sede_legale
        if (formData.sede_operativa) customerData.sede_operativa = formData.sede_operativa
        if (formData.codice_destinatario) customerData.codice_destinatario = formData.codice_destinatario
        if (formData.pec_azienda) customerData.pec = formData.pec_azienda

        customerData.metadata = {
          indirizzo_ddt: formData.indirizzo_ddt,
          contatti_cliente: formData.contatti_cliente,
          sede_operativa: formData.sede_operativa,
          rappresentante: {
            nome: formData.rappresentante_nome,
            cognome: formData.rappresentante_cognome,
            cf: formData.rappresentante_cf,
            data_nascita: formData.rappresentante_data_nascita,
            luogo_nascita: formData.rappresentante_luogo_nascita,
            ruolo: formData.rappresentante_ruolo,
            patente: formData.rappresentante_patente?.toUpperCase() || '',
            documento: {
              tipo: formData.rappresentante_doc_tipo,
              numero: formData.rappresentante_doc_numero,
              rilascio: formData.rappresentante_doc_rilascio,
              scadenza: formData.rappresentante_doc_scadenza,
              luogo: formData.rappresentante_doc_luogo
            }
          }
        }

      } else if (formData.tipo_cliente === 'pubblica_amministrazione') {
        customerData.denominazione = formData.ente_ufficio
        customerData.codice_univoco = formData.codice_univoco.toUpperCase()
        customerData.codice_fiscale = formData.cf_pa.toUpperCase()
        customerData.indirizzo = formData.citta
        if (formData.partita_iva_pa) customerData.partita_iva = formData.partita_iva_pa
        if (formData.pec_pa) customerData.pec = formData.pec_pa
      }

      logger.log('Saving customer data:', customerData)

      let resultData;
      let createdClientId: string | null = null;

      logger.log('🔍 DEBUG: initialData:', initialData)
      logger.log('🔍 DEBUG: initialData?.id:', initialData?.id)
      logger.log('🔍 DEBUG: editingId state:', editingId)
      logger.log('🔍 DEBUG: Will UPDATE?', !!editingId)

      if (editingId) {
        logger.log('🔄 Updating existing customer:', initialData.id)
        logger.log('📝 Customer data to save:', customerData)

        // 1. Update customers_extended via Netlify function (bypasses RLS)
        logger.log('[NewClientModal] Updating customer via Netlify function with ID:', initialData.id)
        const updateResponse = await authFetch('/.netlify/functions/save-customer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerData: { ...customerData, id: initialData.id },
            customerId: initialData.id
          })
        })

        const updateResult = await updateResponse.json()
        if (!updateResponse.ok) {
          console.error('❌ Error updating customer:', updateResult)
          throw { message: updateResult.error, code: updateResult.code }
        }

        logger.log('✅ customers_extended updated successfully:', updateResult.customer)
        resultData = updateResult.customer
        createdClientId = editingId

        // 2. Also update basic 'customers' table to keep sync
        const basicData = {
          full_name: customerData.tipo_cliente === 'persona_fisica'
            ? `${customerData.nome} ${customerData.cognome}`
            : (customerData.ragione_sociale || customerData.denominazione),
          email: customerData.email,
          phone: customerData.telefono,
          driver_license_number: customerData.metadata?.patente?.numero || null,
          tipo_cliente: customerData.tipo_cliente,
          updated_at: new Date().toISOString()
        }

        logger.log('📝 Updating basic customers table with:', basicData)
        const { error: basicError } = await supabase
          .from('customers')
          .update(basicData)
          .eq('id', editingId)

        if (basicError) {
          logger.warn('⚠️ Could not update basic customers table:', basicError)
        } else {
          logger.log('✅ Basic customers table updated successfully')
        }

        toast.success('Cliente aggiornato con successo!')

        if (onClientCreated && resultData) {
          onClientCreated(resultData.id, resultData)
        }
        handleClose()
        return // Exit early - UPDATE complete
      }

      // CREATE NEW CUSTOMER
      if (!editingId) {
        // CREATE New via Netlify function (bypasses RLS)
        logger.log('[NewClientModal] Creating customer via Netlify function')
        const createResponse = await authFetch('/.netlify/functions/save-customer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customerData })
        })

        const createResult = await createResponse.json()
        if (!createResponse.ok) {
          console.error('❌ Error creating customer:', createResult)
          throw { message: createResult.error, code: createResult.code }
        }

        resultData = createResult.customer
        createdClientId = createResult.customer.id

        // Also insert into basic 'customers' table for backward compatibility
        try {
          const basicData = {
            id: createdClientId, // Use the same ID
            full_name: customerData.tipo_cliente === 'persona_fisica'
              ? `${customerData.nome} ${customerData.cognome}`
              : (customerData.ragione_sociale || customerData.denominazione),
            email: customerData.email,
            phone: customerData.telefono,
            driver_license_number: customerData.metadata?.patente?.numero || null,
            tipo_cliente: customerData.tipo_cliente,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }

          const { error: basicError } = await supabase
            .from('customers')
            .insert([basicData])

          if (basicError) logger.warn('Could not insert into basic customers table (non-fatal):', basicError)
        } catch (legacyError) {
          logger.warn('Silent error saving to legacy customers table:', legacyError)
        }

        toast.success('Cliente creato con successo!')
      }

      // Upload documents if any were selected
      const hasAnyFile = driversLicenseFront || driversLicenseBack || identityFront || identityBack || codiceFiscaleFront || codiceFiscaleBack

      if (createdClientId && hasAnyFile) {
        logger.log('Uploading documents for client:', createdClientId)

        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (!user || authError) {
          logger.warn('Cannot upload documents: user not authenticated')
        } else {
          // Helper function to upload a single file
          const uploadFile = async (file: File, bucketParams: string, docType: string, suffix: string = '') => {
            try {
              const fileExt = file.name.split('.').pop()
              const fileName = `${docType}${suffix}_${Date.now()}.${fileExt}`
              const filePath = `${createdClientId}/${fileName}`

              const { error: uploadError } = await supabase.storage
                .from(bucketParams)
                .upload(filePath, file, {
                  cacheControl: '3600',
                  upsert: true
                })

              if (uploadError) throw uploadError

              await supabase
                .from('customer_documents')
                .insert({
                  customer_id: createdClientId,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  document_type: docType as any,
                  file_name: file.name,
                  file_path: filePath,
                  file_size: file.size,
                  mime_type: file.type,
                  bucket_id: bucketParams,
                  uploaded_by: user.id
                })

              logger.log(`✅ ${docType}${suffix} uploaded successfully`)
              return true
            } catch (error: unknown) {
              const _errMsg = error instanceof Error ? error.message : String(error)
              console.error(`Error uploading ${docType}${suffix}:`, error)
              toast.error(`Errore caricamento ${docType}${suffix}: ${_errMsg}`)
              return false
            }
          }

          // Upload Drivers License
          if (driversLicenseFront) await uploadFile(driversLicenseFront, 'driver-licenses', 'drivers_license', '_front')
          if (driversLicenseBack) await uploadFile(driversLicenseBack, 'driver-licenses', 'drivers_license', '_back')

          // Upload Identity
          if (identityFront) await uploadFile(identityFront, 'customer-documents', 'identity_document', '_front')
          if (identityBack) await uploadFile(identityBack, 'customer-documents', 'identity_document', '_back')

          // Upload Codice Fiscale
          if (codiceFiscaleFront) await uploadFile(codiceFiscaleFront, 'codice-fiscale', 'codice_fiscale', '_front')
          if (codiceFiscaleBack) await uploadFile(codiceFiscaleBack, 'codice-fiscale', 'codice_fiscale', '_back')
        }
      }

      // [FIX] LINK BOOKINGS TO NEW/UPDATED CUSTOMER
      // Now that we have a valid createdClientId (UUID), we must find any bookings 
      // with this customer's email (or phone) and update their user_id to this UUID.
      // This ensures the "temp" customer merges into this real one in the UI.
      if (createdClientId && (formData.email || formData.telefono)) {
        logger.log('Linking bookings to customer:', createdClientId)
        const conditions = []
        if (formData.email) conditions.push(`customer_email.eq.${formData.email}`)
        // Optional: also link by phone if email is missing in booking, but email is safer
        // if (formData.telefono) conditions.push(`customer_phone.eq.${formData.telefono}`)

        if (conditions.length > 0) {
          // const orQuery = conditions.join(',')
          // DISABLED: This causes foreign key constraint errors
          // const { error: linkError } = await supabase
          //   .from('bookings')
          //   .update({ user_id: createdClientId })
          //   .or(orQuery)

          // if (linkError) {
          //   console.error('Error linking bookings:', linkError)
          // } else {
          //   logger.log('✅ Bookings successfully linked to', createdClientId)
          // }
        }
      }

      if (onClientCreated && resultData) {
        onClientCreated(resultData.id, resultData)
      }
      handleClose()

    } catch (error: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const errObj = error as Record<string, any> | null
      const _errMsg = error instanceof Error
        ? error.message
        : (errObj && typeof errObj === 'object' && 'message' in errObj && errObj.message != null
            ? (typeof errObj.message === 'string' ? errObj.message : JSON.stringify(errObj.message))
            : String(error))
      const errCode = typeof errObj === 'object' && errObj !== null ? String(errObj.code ?? '') : ''
      console.error('❌ Error saving customer:', error)
      console.error('Error details:', {
        message: _errMsg,
        code: errCode,
        details: errObj && typeof errObj === 'object' ? errObj.details : undefined,
        hint: errObj && typeof errObj === 'object' ? errObj.hint : undefined
      })

      // Provide specific error messages based on error type
      let errorMessage = 'Errore salvataggio cliente: '

      if (errCode === '42501') {
        // Permission denied - RLS policy issue
        errorMessage += 'Permessi insufficienti. Verifica che il tuo account abbia i permessi di amministratore.'
      } else if (errCode === '42703') {
        // Column does not exist
        errorMessage += `Colonna mancante nel database: ${_errMsg}. Esegui lo script update_customers_extended_schema.sql`
      } else if (_errMsg?.includes('duplicate key')) {
        errorMessage += 'Cliente già esistente con questa email o codice fiscale.'
      } else if (_errMsg?.includes('violates check constraint')) {
        errorMessage += 'Dati non validi. Verifica i campi obbligatori.'
      } else if (_errMsg?.includes('network')) {
        errorMessage += 'Errore di connessione. Verifica la tua connessione internet.'
      } else {
        errorMessage += _errMsg || 'Errore sconosciuto'
      }

      toast.error(errorMessage)
    } finally {
      setIsSaving(false)
    }
  }

  const handleClose = () => {
    // Reset essential fields or all
    setErrors({})
    setShowDocumentSection(false)
    setDriversLicenseFront(null)
    setDriversLicenseBack(null)
    setIdentityFront(null)
    setIdentityBack(null)
    setCodiceFiscaleFront(null)
    setCodiceFiscaleBack(null)
    onClose()
  }

  // Live preview/score for the right-hand sidebar. NON persiste — solo
  // contatori derivati dai campi gia' compilati per dare un'idea di
  // completezza prima del salvataggio.
  // 2026-05-28: questo useMemo DEVE stare prima dell'early return `if
  // (!isOpen) return null` (sotto), altrimenti React lancia error #310
  // "Rendered more hooks than during the previous render" quando la
  // modale viene chiusa.
  const filledScore = useMemo(() => {
    const required: Array<string> = formData.tipo_cliente === 'persona_fisica'
      ? [formData.nome, formData.cognome, formData.codice_fiscale, formData.data_nascita, formData.indirizzo, formData.citta_residenza, formData.codice_postale, formData.email, formData.telefono, formData.patente_numero]
      : formData.tipo_cliente === 'azienda'
        ? [formData.denominazione, formData.partita_iva, formData.sede_legale, formData.email, formData.telefono, formData.rappresentante_nome, formData.rappresentante_cognome, formData.rappresentante_cf, formData.rappresentante_doc_numero]
        : [formData.ente_ufficio, formData.codice_univoco, formData.cf_pa, formData.citta, formData.email, formData.telefono]
    const filled = required.filter(v => v && v.trim().length > 0).length
    return Math.round((filled / required.length) * 100)
  }, [formData])

  if (!isOpen) return null

  // ── New layout helpers (2026-05-22 redesign) ────────────────────────────
  // Section anchors for the top progress strip + Indietro/Avanti footer nav.
  // Sezione 4 ("Documenti") e' incollata alla sezione 3 nello stesso row del
  // grid principale, quindi non ha un id separato per scrollare — il click
  // su step 4 scorre direttamente alla card documenti.
  const SECTIONS: Array<{ id: string; label: string }> = [
    { id: 'sec-identificazione', label: 'Identificazione' },
    { id: 'sec-dati', label: 'Dati Personali' },
    { id: 'sec-contatti', label: 'Contatti & Indirizzo' },
    { id: 'sec-documenti', label: 'Documenti' },
    { id: 'sec-pagamenti', label: 'Pagamenti & IBAN' },
    { id: 'sec-profilo', label: 'Profilo & Preferenze' },
    { id: 'sec-note', label: 'Note & Rischio' },
  ]
  const scrollToSection = (id: string) => {
    const el = document.getElementById(id)
    if (el && scrollContainerRef.current) {
      const container = scrollContainerRef.current
      const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 90
      container.scrollTo({ top, behavior: 'smooth' })
    }
  }
  const previewName = formData.tipo_cliente === 'persona_fisica'
    ? `${formData.nome} ${formData.cognome}`.trim()
    : formData.tipo_cliente === 'azienda' ? formData.denominazione : formData.ente_ufficio
  const docsCount = [driversLicenseFront, identityFront, codiceFiscaleFront].filter(Boolean).length
  const docsTotal = formData.tipo_cliente === 'persona_fisica' ? 3 : 1
  const scoreLabel = filledScore >= 80 ? 'Eccellente' : filledScore >= 60 ? 'Buono' : filledScore >= 30 ? 'In corso' : 'Da compilare'
  const scoreColor = filledScore >= 80 ? 'text-emerald-600' : filledScore >= 60 ? 'text-amber-600' : filledScore >= 30 ? 'text-orange-600' : 'text-rose-600'
  const scoreRing = filledScore >= 80 ? 'stroke-emerald-500' : filledScore >= 60 ? 'stroke-amber-500' : filledScore >= 30 ? 'stroke-orange-500' : 'stroke-rose-500'

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-0 sm:p-4">
      <div ref={scrollContainerRef} className="bg-theme-bg-secondary border border-theme-border rounded-none sm:rounded-2xl w-full sm:max-w-[1400px] h-full sm:h-auto sm:max-h-[95vh] overflow-y-auto shadow-2xl flex flex-col">
        {/* ── Sticky header: breadcrumb + 7-step progress strip ────────── */}
        <div className="sticky top-0 bg-theme-bg-secondary border-b border-theme-border z-20">
          <div className="flex items-center justify-between px-5 py-3">
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-theme-text-muted hidden sm:inline">Lead & Clienti</span>
              <span className="text-theme-text-muted hidden sm:inline">/</span>
              <span className="font-bold text-theme-text-primary truncate">{initialData ? 'Modifica Cliente' : 'Nuovo Cliente'}</span>
              {!initialData && (
                <span className="px-2 py-0.5 rounded-full bg-dr7-gold/15 text-dr7-gold text-[10px] font-semibold uppercase tracking-wide shrink-0">Nuovo</span>
              )}
            </div>
            <button onClick={handleClose} className="text-theme-text-muted hover:text-theme-text-primary text-2xl leading-none w-10 h-10 flex items-center justify-center rounded-full hover:bg-theme-bg-hover">&times;</button>
          </div>
          <div className="px-5 pb-3 flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
            {SECTIONS.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => scrollToSection(s.id)}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors text-theme-text-muted hover:bg-theme-bg-hover hover:text-theme-text-primary"
              >
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-theme-bg-tertiary text-[10px] font-bold text-theme-text-primary">{i + 1}</span>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Body ─────────────────────────────────────────────────────── */}
        <div className="p-5 space-y-4 flex-1">

          {/* Compila banner — unchanged behaviour from previous version */}
          {lastExtracted && lastExtracted.length > 0 && (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <h4 className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                    Dati estratti dai documenti — verifica:
                  </h4>
                </div>
                <button type="button" onClick={() => setLastExtracted(null)} className="text-theme-text-muted hover:text-theme-text-primary text-xl leading-none" aria-label="Nascondi riassunto">&times;</button>
              </div>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-theme-text-primary">
                {lastExtracted.map((line, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className="text-emerald-500 mt-0.5">·</span>
                    <span className="truncate" title={line}>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Row 1: Identificazione Rapida | Anteprima | Riepilogo ─── */}
          <div id="sec-identificazione" className="grid grid-cols-1 xl:grid-cols-3 gap-4">

            {/* ── Identificazione Rapida ───────────────────────────── */}
            <div className="bg-theme-bg-primary border border-theme-border rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-dr7-gold/15 text-dr7-gold text-[10px] font-bold">1</span>
                <h3 className="text-sm font-bold text-theme-text-primary uppercase tracking-wide">Identificazione Rapida</h3>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-3">
                <button type="button" onClick={() => setFormData({ ...formData, tipo_cliente: 'persona_fisica' })}
                  className={`px-2 py-2 rounded-lg text-xs font-semibold border transition-colors ${formData.tipo_cliente === 'persona_fisica' ? 'bg-dr7-gold/15 border-dr7-gold text-dr7-gold' : 'bg-theme-bg-tertiary border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover'}`}>
                  Persona Fisica
                </button>
                <button type="button" onClick={() => setFormData({ ...formData, tipo_cliente: 'azienda' })}
                  className={`px-2 py-2 rounded-lg text-xs font-semibold border transition-colors ${formData.tipo_cliente === 'azienda' ? 'bg-dr7-gold/15 border-dr7-gold text-dr7-gold' : 'bg-theme-bg-tertiary border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover'}`}>
                  Azienda
                </button>
                <button type="button" onClick={() => setFormData({ ...formData, tipo_cliente: 'pubblica_amministrazione' })}
                  className={`px-2 py-2 rounded-lg text-xs font-semibold border transition-colors ${formData.tipo_cliente === 'pubblica_amministrazione' ? 'bg-dr7-gold/15 border-dr7-gold text-dr7-gold' : 'bg-theme-bg-tertiary border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover'}`}>
                  Pubblica Amm.
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Telefono</label>
                  <input type="tel" value={formData.telefono} onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
                    placeholder="+39 333 123 4567"
                    className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none" />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Email</label>
                  <input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="cliente@email.com"
                    className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none" />
                  {errors.email && <p className="text-red-500 text-[11px] mt-1">{errors.email}</p>}
                </div>
                <div className="pt-2 border-t border-theme-border">
                  <p className="text-[11px] text-theme-text-muted">Sezione documenti in basso supporta auto-compilazione tramite Compila — bastano patente / carta d'identita' scansionate.</p>
                </div>
              </div>
            </div>

            {/* ── Anteprima Cliente ───────────────────────────────── */}
            <div className="bg-theme-bg-primary border border-theme-border rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-theme-text-primary uppercase tracking-wide">Anteprima Cliente</h3>
                {previewName && <span className="px-2 py-0.5 rounded-full bg-dr7-gold/15 text-dr7-gold text-[10px] font-bold uppercase">VIP</span>}
              </div>
              <div className="flex flex-col items-center text-center py-2">
                <div className="w-16 h-16 rounded-full bg-theme-bg-tertiary flex items-center justify-center text-2xl font-bold text-theme-text-muted mb-2">
                  {(previewName || '?').split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase()).join('') || '?'}
                </div>
                <div className="font-bold text-theme-text-primary truncate w-full">{previewName || 'Nuovo cliente'}</div>
                <div className="text-xs text-theme-text-muted mt-0.5 truncate w-full">{formData.telefono || '—'}</div>
                <div className="text-xs text-theme-text-muted truncate w-full">{formData.email || '—'}</div>
                <div className="mt-3 text-[11px] text-theme-text-muted px-2">
                  L'anteprima riflette in tempo reale i dati inseriti nel form.
                </div>
              </div>
            </div>

            {/* ── Riepilogo Cliente ───────────────────────────────── */}
            <div className="bg-theme-bg-primary border border-theme-border rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-theme-text-primary uppercase tracking-wide">Riepilogo Cliente</h3>
                <span className="text-[10px] text-theme-text-muted">Score compilazione</span>
              </div>
              <div className="flex items-center gap-4">
                {/* Donut score */}
                <div className="relative w-20 h-20 shrink-0">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="15.915" fill="none" stroke="currentColor" strokeWidth="3" className="text-theme-bg-tertiary" />
                    <circle cx="18" cy="18" r="15.915" fill="none" strokeWidth="3" strokeDasharray={`${filledScore}, 100`} strokeLinecap="round" className={scoreRing} />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-lg font-bold text-theme-text-primary leading-none">{filledScore}</span>
                    <span className={`text-[9px] font-semibold ${scoreColor} uppercase`}>{scoreLabel}</span>
                  </div>
                </div>
                <div className="flex-1 min-w-0 space-y-1 text-[11px]">
                  <div className="flex items-center justify-between"><span className="text-theme-text-muted">Stato</span><span className="font-semibold text-emerald-600">Attivo</span></div>
                  <div className="flex items-center justify-between"><span className="text-theme-text-muted">Rischio</span><span className="font-semibold text-emerald-600">Basso</span></div>
                  <div className="flex items-center justify-between"><span className="text-theme-text-muted">Documenti</span><span className="font-semibold text-theme-text-primary">{docsCount}/{docsTotal}</span></div>
                  <div className="flex items-center justify-between"><span className="text-theme-text-muted">Wallet</span><span className="font-semibold text-theme-text-primary">€ 0,00</span></div>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-theme-border">
                <div className="text-[10px] text-theme-text-muted">Data inserimento</div>
                <div className="text-xs font-semibold text-theme-text-primary">{new Date().toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            </div>

          </div>

          {/* ── Row 2: 4-column main form (adapts per tipo_cliente) ───── */}
          <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">

            {/* ── COLUMN 1: Dati Personali / Azienda / PA ──────────── */}
            <div id="sec-dati" className="bg-theme-bg-primary border border-theme-border rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-dr7-gold/15 text-dr7-gold text-[10px] font-bold">2</span>
                <h3 className="text-sm font-bold text-theme-text-primary uppercase tracking-wide">
                  {formData.tipo_cliente === 'persona_fisica' ? 'Dati Personali' : formData.tipo_cliente === 'azienda' ? 'Dati Azienda' : 'Dati Ente'}
                </h3>
              </div>

              {formData.tipo_cliente === 'persona_fisica' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Nome*</label>
                      <input type="text" value={formData.nome} onChange={(e) => setFormData({ ...formData, nome: e.target.value })} placeholder="Mario"
                        className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Cognome*</label>
                      <input type="text" value={formData.cognome} onChange={(e) => setFormData({ ...formData, cognome: e.target.value })} placeholder="Rossi"
                        className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Data Nascita*</label>
                      <input type="date" lang="it" value={formData.data_nascita || ''} onChange={(e) => setFormData({ ...formData, data_nascita: e.target.value })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Sesso</label>
                      <select value={formData.sesso} onChange={(e) => setFormData({ ...formData, sesso: e.target.value as typeof formData.sesso })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold outline-none">
                        {!formData.sesso && <option value="">Seleziona…</option>}
                        <option value="M">Maschio</option>
                        <option value="F">Femmina</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Codice Fiscale*</label>
                    <div className="flex gap-1.5">
                      <input type="text" value={formData.codice_fiscale} onChange={(e) => setFormData({ ...formData, codice_fiscale: e.target.value.toUpperCase() })} maxLength={16}
                        className="flex-1 bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none uppercase font-mono" />
                      <CalcolaCFButton config={{
                        getCognome: () => formData.cognome, getNome: () => formData.nome,
                        getDataNascita: () => formData.data_nascita, getSesso: () => formData.sesso,
                        getLuogoNascita: () => formData.luogo_nascita, getCodiceFiscale: () => formData.codice_fiscale,
                        setCodiceFiscale: (v) => setFormData(p => ({ ...p, codice_fiscale: v })),
                        setSesso: (v) => setFormData(p => ({ ...p, sesso: v as typeof p.sesso })),
                        setDataNascita: (v) => setFormData(p => ({ ...p, data_nascita: v })),
                        setLuogoNascita: (v) => setFormData(p => ({ ...p, luogo_nascita: v })),
                        setProvinciaNascita: (v) => setFormData(p => ({ ...p, provincia_nascita: v })),
                      }} />
                    </div>
                    {errors.codice_fiscale && <p className="text-red-500 text-[11px] mt-1">{errors.codice_fiscale}</p>}
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Nazione*</label>
                    <input type="text" value={formData.nazione} onChange={(e) => setFormData({ ...formData, nazione: e.target.value })}
                      className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Luogo Nascita*</label>
                      <input type="text" value={formData.luogo_nascita} onChange={(e) => {
                        const city = e.target.value
                        const prov = getProvinciaByCity(city)
                        setFormData({ ...formData, luogo_nascita: city, ...(prov ? { provincia_nascita: prov } : {}) })
                      }} placeholder="es. Cagliari"
                        className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Provincia</label>
                      <input type="text" value={formData.provincia_nascita} onChange={(e) => setFormData({ ...formData, provincia_nascita: e.target.value.toUpperCase() })} maxLength={2} placeholder="CA"
                        className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none uppercase" />
                    </div>
                  </div>
                </div>
              )}

              {formData.tipo_cliente === 'azienda' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Ragione Sociale*</label>
                    <input type="text" value={formData.denominazione} onChange={(e) => setFormData({ ...formData, denominazione: e.target.value })}
                      className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Partita IVA*</label>
                      <input type="text" value={formData.partita_iva} onChange={(e) => setFormData({ ...formData, partita_iva: e.target.value })} maxLength={11}
                        className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none font-mono" />
                      {errors.partita_iva && <p className="text-red-500 text-[11px] mt-1">{errors.partita_iva}</p>}
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Codice Fiscale</label>
                      <input type="text" value={formData.cf_azienda} onChange={(e) => setFormData({ ...formData, cf_azienda: e.target.value.toUpperCase() })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none font-mono uppercase" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Sede Legale*</label>
                    <input type="text" value={formData.sede_legale} onChange={(e) => setFormData({ ...formData, sede_legale: e.target.value })}
                      className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Sede Operativa</label>
                    <input type="text" value={formData.sede_operativa} onChange={(e) => setFormData({ ...formData, sede_operativa: e.target.value })}
                      className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Codice Destinatario</label>
                      <input type="text" value={formData.codice_destinatario} onChange={(e) => setFormData({ ...formData, codice_destinatario: e.target.value })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none font-mono" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-theme-text-muted mb-1">PEC</label>
                      <input type="email" value={formData.pec_azienda} onChange={(e) => setFormData({ ...formData, pec_azienda: e.target.value })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Indirizzo DDT</label>
                    <input type="text" value={formData.indirizzo_ddt} onChange={(e) => setFormData({ ...formData, indirizzo_ddt: e.target.value })}
                      className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none" />
                  </div>
                </div>
              )}

              {formData.tipo_cliente === 'pubblica_amministrazione' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Ente / Ufficio*</label>
                    <input type="text" value={formData.ente_ufficio} onChange={(e) => setFormData({ ...formData, ente_ufficio: e.target.value })}
                      className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Codice Univoco*</label>
                      <input type="text" value={formData.codice_univoco} onChange={(e) => setFormData({ ...formData, codice_univoco: e.target.value.toUpperCase() })} maxLength={7}
                        className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none uppercase font-mono" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-theme-text-muted mb-1">CF / P.IVA*</label>
                      <input type="text" value={formData.cf_pa} onChange={(e) => setFormData({ ...formData, cf_pa: e.target.value.toUpperCase() })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none uppercase font-mono" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Città*</label>
                    <input type="text" value={formData.citta} onChange={(e) => setFormData({ ...formData, citta: e.target.value })}
                      className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-theme-text-muted mb-1">PEC</label>
                    <input type="email" value={formData.pec_pa} onChange={(e) => setFormData({ ...formData, pec_pa: e.target.value })}
                      className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none" />
                  </div>
                </div>
              )}
            </div>

            {/* ── COLUMN 2: Contatti & Indirizzo (or Rappresentante per azienda) ─ */}
            <div id="sec-contatti" className="bg-theme-bg-primary border border-theme-border rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-dr7-gold/15 text-dr7-gold text-[10px] font-bold">3</span>
                <h3 className="text-sm font-bold text-theme-text-primary uppercase tracking-wide">
                  {formData.tipo_cliente === 'azienda' ? 'Rappresentante Legale' : 'Contatti & Indirizzo'}
                </h3>
              </div>

              {formData.tipo_cliente === 'persona_fisica' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Indirizzo</label>
                    <div className="flex gap-1.5">
                      <input type="text" value={formData.indirizzo} onChange={(e) => setFormData({ ...formData, indirizzo: e.target.value })} placeholder="Via..."
                        className="flex-1 bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none" />
                      <input type="text" value={formData.numero_civico} onChange={(e) => setFormData({ ...formData, numero_civico: e.target.value })} placeholder="N."
                        className="w-16 bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-theme-text-muted mb-1">CAP</label>
                      <input type="text" value={formData.codice_postale} onChange={(e) => setFormData({ ...formData, codice_postale: e.target.value })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Provincia</label>
                      <input type="text" value={formData.provincia_residenza} onChange={(e) => setFormData({ ...formData, provincia_residenza: e.target.value.toUpperCase() })} maxLength={2}
                        className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none uppercase" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Città</label>
                    <input type="text" value={formData.citta_residenza} onChange={(e) => {
                      const city = e.target.value
                      const prov = getProvinciaByCity(city)
                      const cap = getCAPByCity(city)
                      setFormData({ ...formData, citta_residenza: city, ...(prov ? { provincia_residenza: prov } : {}), ...(cap ? { codice_postale: cap } : {}) })
                    }} placeholder="es. Cagliari"
                      className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-theme-text-muted mb-1">PEC (opzionale)</label>
                    <input type="email" value={formData.pec_persona} onChange={(e) => setFormData({ ...formData, pec_persona: e.target.value })}
                      className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none" />
                  </div>
                </div>
              )}

              {formData.tipo_cliente === 'azienda' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Nome</label>
                      <input type="text" value={formData.rappresentante_nome} onChange={(e) => setFormData({ ...formData, rappresentante_nome: e.target.value })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Cognome</label>
                      <input type="text" value={formData.rappresentante_cognome} onChange={(e) => setFormData({ ...formData, rappresentante_cognome: e.target.value })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Codice Fiscale</label>
                    <input type="text" value={formData.rappresentante_cf} onChange={(e) => setFormData({ ...formData, rappresentante_cf: e.target.value.toUpperCase() })}
                      className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none uppercase font-mono" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Data Nascita</label>
                      <input type="date" value={formData.rappresentante_data_nascita} onChange={(e) => setFormData({ ...formData, rappresentante_data_nascita: e.target.value })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Luogo Nascita</label>
                      <input type="text" value={formData.rappresentante_luogo_nascita} onChange={(e) => setFormData({ ...formData, rappresentante_luogo_nascita: e.target.value })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Ruolo</label>
                    <input type="text" value={formData.rappresentante_ruolo} onChange={(e) => setFormData({ ...formData, rappresentante_ruolo: e.target.value })}
                      placeholder="es. Amministratore Unico"
                      className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Patente</label>
                    <input type="text" value={formData.rappresentante_patente} onChange={(e) => setFormData({ ...formData, rappresentante_patente: e.target.value.toUpperCase() })}
                      placeholder="es. CA1234567X"
                      className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none uppercase font-mono" />
                  </div>
                </div>
              )}

              {formData.tipo_cliente === 'pubblica_amministrazione' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-medium text-theme-text-muted mb-1">P.IVA aggiuntiva</label>
                    <input type="text" value={formData.partita_iva_pa} onChange={(e) => setFormData({ ...formData, partita_iva_pa: e.target.value })}
                      className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none font-mono" />
                  </div>
                  <p className="text-[11px] text-theme-text-muted">Per gli enti pubblici la sezione contatti coincide con i dati principali. Telefono ed email rimangono quelli inseriti in Identificazione Rapida.</p>
                </div>
              )}
            </div>

            {/* ── COLUMN 3: Documenti Obbligatori (or Documento Rappresentante per azienda) ─ */}
            <div id="sec-documenti" className="bg-theme-bg-primary border border-theme-border rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-dr7-gold/15 text-dr7-gold text-[10px] font-bold">4</span>
                <h3 className="text-sm font-bold text-theme-text-primary uppercase tracking-wide">
                  {formData.tipo_cliente === 'azienda' ? 'Documento Rappresentante' : 'Documenti Obbligatori'}
                </h3>
              </div>

              {formData.tipo_cliente === 'persona_fisica' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Patente n.*</label>
                    <input type="text" value={formData.patente_numero} onChange={(e) => setFormData({ ...formData, patente_numero: e.target.value.toUpperCase() })}
                      className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none uppercase font-mono" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Categoria</label>
                      <input type="text" value={formData.patente_tipo} onChange={(e) => setFormData({ ...formData, patente_tipo: e.target.value.toUpperCase() })} placeholder="B"
                        className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none uppercase" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Emessa da</label>
                      <input type="text" value={formData.patente_ente} onChange={(e) => setFormData({ ...formData, patente_ente: e.target.value })} placeholder="MIT-UCO"
                        className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Data rilascio</label>
                      <input type="date" lang="it" value={formData.patente_rilascio || ''} onChange={(e) => setFormData({ ...formData, patente_rilascio: e.target.value })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Scadenza</label>
                      <input type="date" lang="it" value={formData.patente_scadenza || ''} onChange={(e) => setFormData({ ...formData, patente_scadenza: e.target.value })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none" />
                    </div>
                  </div>

                  {/* Toggle uploads */}
                  <button type="button" onClick={() => setShowDocumentSection(!showDocumentSection)}
                    className="w-full inline-flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-theme-bg-tertiary hover:bg-theme-bg-hover text-xs font-medium text-theme-text-secondary mt-2">
                    <span className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-dr7-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                      Upload scansioni
                    </span>
                    <svg className={`w-4 h-4 transition-transform ${showDocumentSection ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>

                  {showDocumentSection && (
                    <div className="space-y-3 mt-2">
                      <DocUploadGroup label="Patente">
                        <DocFileInput value={driversLicenseFront} onChange={setDriversLicenseFront} placeholder="Fronte" />
                        <DocFileInput value={driversLicenseBack} onChange={setDriversLicenseBack} placeholder="Retro" />
                      </DocUploadGroup>
                      <DocUploadGroup label="Carta d'identità">
                        <DocFileInput value={identityFront} onChange={setIdentityFront} placeholder="Fronte" />
                        <DocFileInput value={identityBack} onChange={setIdentityBack} placeholder="Retro" />
                      </DocUploadGroup>
                      <DocUploadGroup label="Codice Fiscale">
                        <DocFileInput value={codiceFiscaleFront} onChange={setCodiceFiscaleFront} placeholder="Fronte" />
                        <DocFileInput value={codiceFiscaleBack} onChange={setCodiceFiscaleBack} placeholder="Retro" />
                      </DocUploadGroup>

                      {(driversLicenseFront || driversLicenseBack || identityFront || identityBack || codiceFiscaleFront || codiceFiscaleBack) && (
                        <div className="pt-2">
                          <CompilaButton
                            documents={[
                              { file: driversLicenseFront, label: 'Patente Fronte' },
                              { file: driversLicenseBack, label: 'Patente Retro' },
                              { file: identityFront, label: 'Carta Identità Fronte' },
                              { file: identityBack, label: 'Carta Identità Retro' },
                              { file: codiceFiscaleFront, label: 'Codice Fiscale Fronte' },
                              { file: codiceFiscaleBack, label: 'Codice Fiscale Retro' },
                            ]}
                            currentData={formData as unknown as Record<string, string | undefined | null>}
                            onDataExtracted={(data: ExtractedData, _conflicts: DataConflict[]) => {
                              const FIELD_LABELS: Record<string, string> = {
                                nome: 'Nome', cognome: 'Cognome', sesso: 'Sesso',
                                data_nascita: 'Data di nascita', luogo_nascita: 'Luogo di nascita',
                                provincia_nascita: 'Provincia nascita', codice_fiscale: 'Codice fiscale',
                                indirizzo: 'Indirizzo', numero_civico: 'N. civico', codice_postale: 'CAP',
                                citta_residenza: 'Citta residenza', provincia_residenza: 'Provincia residenza',
                                patente_numero: 'N. patente', patente_tipo: 'Tipo patente',
                                patente_rilascio: 'Rilascio patente', patente_scadenza: 'Scadenza patente',
                                patente_ente: 'Ente patente',
                              }
                              const filled: string[] = []
                              const pushIf = (key: keyof typeof FIELD_LABELS, value: string | undefined) => {
                                if (value) filled.push(`${FIELD_LABELS[key as string]}: ${value}`)
                              }
                              pushIf('nome', data.nome); pushIf('cognome', data.cognome); pushIf('sesso', data.sesso)
                              pushIf('data_nascita', data.data_nascita); pushIf('luogo_nascita', data.luogo_nascita); pushIf('provincia_nascita', data.provincia_nascita)
                              pushIf('codice_fiscale', data.codice_fiscale); pushIf('indirizzo', data.indirizzo); pushIf('numero_civico', data.numero_civico)
                              pushIf('codice_postale', data.codice_postale); pushIf('citta_residenza', data.citta_residenza); pushIf('provincia_residenza', data.provincia_residenza)
                              pushIf('patente_numero', data.patente_numero); pushIf('patente_tipo', data.patente_tipo)
                              pushIf('patente_rilascio', data.patente_rilascio); pushIf('patente_scadenza', data.patente_scadenza); pushIf('patente_ente', data.patente_ente)
                              setFormData(prev => ({
                                ...prev,
                                ...(data.nome && { nome: data.nome }),
                                ...(data.cognome && { cognome: data.cognome }),
                                ...(data.sesso && { sesso: data.sesso as 'M' | 'F' | 'Altro' | '' }),
                                ...(data.data_nascita && { data_nascita: data.data_nascita }),
                                ...(data.luogo_nascita && { luogo_nascita: data.luogo_nascita }),
                                ...(data.provincia_nascita && { provincia_nascita: data.provincia_nascita }),
                                ...(data.codice_fiscale && { codice_fiscale: data.codice_fiscale }),
                                ...(data.indirizzo && { indirizzo: data.indirizzo }),
                                ...(data.numero_civico && { numero_civico: data.numero_civico }),
                                ...(data.codice_postale && { codice_postale: data.codice_postale }),
                                ...(data.citta_residenza && { citta_residenza: data.citta_residenza }),
                                ...(data.provincia_residenza && { provincia_residenza: data.provincia_residenza }),
                                ...(data.patente_numero && { patente_numero: data.patente_numero }),
                                ...(data.patente_tipo && { patente_tipo: data.patente_tipo }),
                                ...(data.patente_rilascio && { patente_rilascio: data.patente_rilascio }),
                                ...(data.patente_scadenza && { patente_scadenza: data.patente_scadenza }),
                                ...(data.patente_ente && { patente_ente: data.patente_ente }),
                              }))
                              setLastExtracted(filled.length > 0 ? filled : ['Nessun dato leggibile estratto'])
                              try { scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' }) } catch { /* ignore */ }
                              toast.success(`${filled.length} campi compilati dai documenti — verifica in cima al form`)
                            }}
                            onError={(err: string) => toast.error(err)}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {formData.tipo_cliente === 'azienda' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Tipo documento</label>
                    <select value={formData.rappresentante_doc_tipo} onChange={(e) => setFormData({ ...formData, rappresentante_doc_tipo: e.target.value })}
                      className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold outline-none">
                      <option value="">Seleziona…</option>
                      <option value="Carta d'Identità">Carta d'Identità</option>
                      <option value="Patente">Patente</option>
                      <option value="Passaporto">Passaporto</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Numero documento</label>
                    <input type="text" value={formData.rappresentante_doc_numero} onChange={(e) => setFormData({ ...formData, rappresentante_doc_numero: e.target.value.toUpperCase() })}
                      placeholder="CA12345AB"
                      className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none uppercase" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Rilascio</label>
                      <input type="date" value={formData.rappresentante_doc_rilascio} onChange={(e) => setFormData({ ...formData, rappresentante_doc_rilascio: e.target.value })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Scadenza</label>
                      <input type="date" value={formData.rappresentante_doc_scadenza} onChange={(e) => setFormData({ ...formData, rappresentante_doc_scadenza: e.target.value })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Luogo rilascio</label>
                    <input type="text" value={formData.rappresentante_doc_luogo} onChange={(e) => setFormData({ ...formData, rappresentante_doc_luogo: e.target.value })}
                      placeholder="es. Comune di Roma"
                      className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none" />
                  </div>
                </div>
              )}

              {formData.tipo_cliente === 'pubblica_amministrazione' && (
                <div className="space-y-3">
                  <p className="text-[11px] text-theme-text-muted">Per la PA non sono richiesti documenti aggiuntivi. La documentazione fiscale segue il flusso SDI / Codice Univoco.</p>
                  <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-[11px] text-emerald-700">
                    Codice Univoco: <strong>{formData.codice_univoco || 'da inserire'}</strong>
                  </div>
                </div>
              )}
            </div>

            {/* ── COLUMN 4: Dopo il Salvataggio (static checklist + tip) ─── */}
            <div className="space-y-4">
              <div className="bg-theme-bg-primary border border-theme-border rounded-2xl p-5">
                <h3 className="text-sm font-bold text-theme-text-primary uppercase tracking-wide mb-3">Dopo il salvataggio</h3>
                <ul className="space-y-2">
                  {[
                    'Apertura scheda cliente completa',
                    'Generazione Client Score',
                    'Verifica documenti e scadenze',
                    'Attivazione Wallet',
                    'Cronologia prenotazioni',
                  ].map(item => (
                    <li key={item} className="flex items-start gap-2 text-xs text-theme-text-secondary">
                      <svg className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <h4 className="text-xs font-bold text-amber-800 uppercase">Suggerimenti</h4>
                </div>
                <p className="text-[11px] text-amber-700">Clienti con documenti verificati hanno l'85% di prenotazioni in più rispetto alla media. Carica patente e identità in fase di creazione per attivare l'auto-compilazione contratti.</p>
              </div>
            </div>

          </div>

          {/* ── Row 3: Pagamenti & IBAN | Profilo & Preferenze | Note & Rischio ─ */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

            {/* Pagamenti — placeholder (gestito dalla scheda cliente dopo creazione) */}
            <div id="sec-pagamenti" className="bg-theme-bg-primary border border-theme-border rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-dr7-gold/15 text-dr7-gold text-[10px] font-bold">5</span>
                  <h3 className="text-sm font-bold text-theme-text-primary uppercase tracking-wide">Pagamenti & IBAN</h3>
                </div>
                <span className="text-[10px] text-theme-text-muted bg-theme-bg-tertiary px-2 py-0.5 rounded-full">Disponibile dopo creazione</span>
              </div>
              <div className="rounded-xl border border-dashed border-theme-border p-4 flex flex-col items-center justify-center text-center gap-2 min-h-[160px]">
                <svg className="w-8 h-8 text-theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M5 6h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z" /></svg>
                <p className="text-xs text-theme-text-secondary">Carte registrate, IBAN e ricarica wallet</p>
                <p className="text-[11px] text-theme-text-muted">Configurabili dalla scheda cliente dopo il salvataggio.</p>
              </div>
            </div>

            {/* Profilo & Preferenze — placeholder */}
            <div id="sec-profilo" className="bg-theme-bg-primary border border-theme-border rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-dr7-gold/15 text-dr7-gold text-[10px] font-bold">6</span>
                  <h3 className="text-sm font-bold text-theme-text-primary uppercase tracking-wide">Profilo & Preferenze</h3>
                </div>
                <span className="text-[10px] text-theme-text-muted bg-theme-bg-tertiary px-2 py-0.5 rounded-full">Disponibile dopo creazione</span>
              </div>
              <div className="rounded-xl border border-dashed border-theme-border p-4 flex flex-col items-center justify-center text-center gap-2 min-h-[160px]">
                <svg className="w-8 h-8 text-theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                <p className="text-xs text-theme-text-secondary">Segmentazione, servizi preferiti, spesa attesa</p>
                <p className="text-[11px] text-theme-text-muted">Configurabili dalla scheda cliente.</p>
              </div>
            </div>

            {/* Note & Rischio — wires existing formData.note */}
            <div id="sec-note" className="bg-theme-bg-primary border border-theme-border rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-dr7-gold/15 text-dr7-gold text-[10px] font-bold">7</span>
                <h3 className="text-sm font-bold text-theme-text-primary uppercase tracking-wide">Note & Controllo Rischio</h3>
              </div>
              <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Note interne</label>
              <textarea value={formData.note} onChange={(e) => setFormData({ ...formData, note: e.target.value })} rows={5}
                placeholder="Note operative, segnalazioni, restrizioni..."
                className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg p-3 text-sm text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none resize-none" />
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="text-center rounded-lg bg-emerald-50 border border-emerald-200 py-2">
                  <div className="text-[10px] text-emerald-700 uppercase font-bold">Basso</div>
                  <div className="text-[11px] text-emerald-700/80">consigliato</div>
                </div>
                <div className="text-center rounded-lg bg-theme-bg-tertiary border border-theme-border py-2">
                  <div className="text-[10px] text-theme-text-muted uppercase font-bold">Medio</div>
                  <div className="text-[11px] text-theme-text-muted">monitor.</div>
                </div>
                <div className="text-center rounded-lg bg-theme-bg-tertiary border border-theme-border py-2">
                  <div className="text-[10px] text-theme-text-muted uppercase font-bold">Alto</div>
                  <div className="text-[11px] text-theme-text-muted">limita</div>
                </div>
              </div>
            </div>

          </div>

        </div>

        {/* ── Sticky footer ───────────────────────────────────────────── */}
        <div className="sticky bottom-0 bg-theme-bg-secondary border-t border-theme-border p-4 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 z-10">
          <button onClick={handleClose} disabled={isSaving}
            className="px-5 py-2.5 min-h-[44px] rounded-full text-sm text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-bg-hover transition-colors">
            Annulla
          </button>
          <div className="flex items-center gap-2">
            <button type="button" disabled
              title="Funzione bozza in arrivo — per ora il salvataggio crea direttamente il cliente"
              className="hidden sm:inline-flex px-4 py-2 min-h-[44px] rounded-full text-sm text-theme-text-muted bg-theme-bg-tertiary opacity-60 cursor-not-allowed">
              Salva Bozza
            </button>
            <button onClick={handleSave} disabled={isSaving}
              className="px-6 py-2.5 min-h-[44px] rounded-full bg-dr7-gold text-white text-sm font-bold hover:opacity-90 transition-opacity shadow-sm disabled:opacity-50">
              {isSaving ? 'Salvataggio…' : (initialData ? 'Aggiorna Cliente' : 'Salva e Apri Scheda Cliente')}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}

// ── Layout helpers (used only in this file) ─────────────────────────────────
function DocUploadGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-theme-bg-tertiary border border-theme-border p-3">
      <div className="text-[10px] uppercase tracking-wide font-bold text-theme-text-secondary mb-2">{label}</div>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </div>
  )
}

function DocFileInput({ value, onChange, placeholder }: { value: File | null; onChange: (f: File | null) => void; placeholder: string }) {
  return (
    <label className="block">
      <span className="text-[10px] text-theme-text-muted">{placeholder}</span>
      <input type="file" accept="image/*,.pdf" onChange={(e) => onChange(e.target.files?.[0] || null)}
        className="mt-1 block w-full text-[10px] text-theme-text-secondary
          file:mr-2 file:py-1 file:px-2 file:rounded file:border-0
          file:text-[10px] file:font-semibold file:bg-dr7-gold/15 file:text-dr7-gold
          hover:file:bg-dr7-gold/25 file:cursor-pointer" />
      {value && <p className="text-[10px] text-emerald-600 mt-0.5 truncate" title={value.name}>{value.name}</p>}
    </label>
  )
}
