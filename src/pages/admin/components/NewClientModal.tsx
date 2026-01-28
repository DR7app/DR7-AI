import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'

interface NewClientModalProps {
  isOpen: boolean
  onClose: () => void
  onClientCreated?: (clientId: string) => void
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
  rappresentante_ruolo: string
  rappresentante_doc_tipo: string
  rappresentante_doc_numero: string
  rappresentante_doc_rilascio: string
  rappresentante_doc_scadenza: string
  rappresentante_doc_luogo: string

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
    rappresentante_ruolo: '',
    rappresentante_doc_tipo: '',
    rappresentante_doc_numero: '',
    rappresentante_doc_rilascio: '',
    rappresentante_doc_scadenza: '',
    rappresentante_doc_luogo: '',
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
        console.log('[NewClientModal] Populating modal with data:', initialData)
        console.log('[NewClientModal] Setting editingId to:', initialData.id)
        setEditingId(initialData.id || null)

        // Determine type
        let type: ClientType = initialData.tipo_cliente || 'persona_fisica'

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
          rappresentante_ruolo: metadata.rappresentante?.ruolo || '',
          rappresentante_doc_tipo: metadata.rappresentante?.documento?.tipo || '',
          rappresentante_doc_numero: metadata.rappresentante?.documento?.numero || '',
          rappresentante_doc_rilascio: metadata.rappresentante?.documento?.rilascio || '',
          rappresentante_doc_scadenza: metadata.rappresentante?.documento?.scadenza || '',
          rappresentante_doc_luogo: metadata.rappresentante?.documento?.luogo || '',

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
        console.log('[NewClientModal] Opening in NEW mode - resetting form')
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
          rappresentante_cf: '',
          rappresentante_ruolo: '',
          rappresentante_doc_tipo: '',
          rappresentante_doc_numero: '',
          rappresentante_doc_rilascio: '',
          rappresentante_doc_scadenza: '',
          rappresentante_doc_luogo: '',
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

  // Optional document uploads
  const [showDocumentSection, setShowDocumentSection] = useState(false)
  const [driversLicenseFront, setDriversLicenseFront] = useState<File | null>(null)
  const [driversLicenseBack, setDriversLicenseBack] = useState<File | null>(null)
  const [identityFront, setIdentityFront] = useState<File | null>(null)
  const [identityBack, setIdentityBack] = useState<File | null>(null)
  const [codiceFiscaleFront, setCodiceFiscaleFront] = useState<File | null>(null)
  const [codiceFiscaleBack, setCodiceFiscaleBack] = useState<File | null>(null)

  // Validation functions
  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email)
  }

  // Basic check for Italian tax code format
  const validateCodiceFiscale = (cf: string): boolean => {
    // 16 alphanumeric characters
    const cfRegex = /^[A-Z0-9]{16}$/i
    return cfRegex.test(cf.replace(/\s/g, ''))
  }

  const validatePartitaIVA = (piva: string): boolean => {
    // 11 digits
    const pivaRegex = /^[0-9]{11}$/
    return pivaRegex.test(piva)
  }

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    // 1. Common validations
    if (!formData.email) {
      newErrors.email = 'Email obbligatoria'
    } else if (!validateEmail(formData.email)) {
      newErrors.email = 'Formato email non valido'
    }

    if (!formData.telefono) {
      newErrors.telefono = 'Telefono obbligatorio'
    }

    if (!formData.nazione) {
      newErrors.nazione = 'Nazione obbligatoria'
    }

    // 2. Type-specific validations
    if (formData.tipo_cliente === 'persona_fisica') {
      if (!formData.nome) newErrors.nome = 'Nome obbligatorio'
      if (!formData.cognome) newErrors.cognome = 'Cognome obbligatorio'

      // CF mandatory for Italy
      if (formData.nazione === 'Italia') {
        if (!formData.codice_fiscale) {
          newErrors.codice_fiscale = 'Codice Fiscale obbligatorio per Italia'
        } else if (!validateCodiceFiscale(formData.codice_fiscale)) {
          newErrors.codice_fiscale = 'Formato Codice Fiscale non valido'
        }
      }

      if (!formData.indirizzo) newErrors.indirizzo = 'Indirizzo obbligatorio'
      if (!formData.citta_residenza) newErrors.citta_residenza = 'Città obbligatoria'
      if (!formData.codice_postale) newErrors.codice_postale = 'CAP obbligatorio'
      if (!formData.provincia_residenza) newErrors.provincia_residenza = 'Provincia obbligatoria'

    } else if (formData.tipo_cliente === 'azienda') {
      if (!formData.denominazione) newErrors.denominazione = 'Ragione Sociale obbligatoria'
      if (!formData.partita_iva) {
        newErrors.partita_iva = 'P.IVA obbligatoria'
      } else if (!validatePartitaIVA(formData.partita_iva)) {
        newErrors.partita_iva = 'P.IVA non valida (11 cifre)'
      }
      if (!formData.sede_legale) newErrors.sede_legale = 'Sede legale obbligatoria'

      // Rappresentante
      if (!formData.rappresentante_nome) newErrors.rappresentante_nome = 'Nome rappresentante obbligatorio'
      if (!formData.rappresentante_cognome) newErrors.rappresentante_cognome = 'Cognome rappresentante obbligatorio'
      if (!formData.rappresentante_cf) newErrors.rappresentante_cf = 'CF rappresentante obbligatorio'

    } else if (formData.tipo_cliente === 'pubblica_amministrazione') {
      if (!formData.ente_ufficio) newErrors.ente_ufficio = 'Ente/Ufficio obbligatorio'
      if (!formData.codice_univoco) newErrors.codice_univoco = 'Codice Univoco obbligatorio'
      if (!formData.cf_pa) newErrors.cf_pa = 'CF o P.IVA obbligatorio'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSave = async () => {
    if (!validateForm()) return

    setIsSaving(true)
    try {
      const customerData: any = {
        tipo_cliente: formData.tipo_cliente,
        email: formData.email,
        telefono: formData.telefono,
        nazione: formData.nazione,
        note: formData.note,
        source: 'admin',
        created_at: new Date().toISOString()
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
            ruolo: formData.rappresentante_ruolo,
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

      console.log('Saving customer data:', customerData)

      let resultData;
      let createdClientId: string | null = null;

      console.log('🔍 DEBUG: initialData:', initialData)
      console.log('🔍 DEBUG: initialData?.id:', initialData?.id)
      console.log('🔍 DEBUG: editingId state:', editingId)
      console.log('🔍 DEBUG: Will UPDATE?', !!editingId)

      if (editingId) {
        console.log('🔄 Updating existing customer:', initialData.id)
        console.log('📝 Customer data to save:', customerData)

        // 1. Update customers_extended via Netlify function (bypasses RLS)
        console.log('[NewClientModal] Updating customer via Netlify function with ID:', initialData.id)
        const updateResponse = await fetch('/.netlify/functions/save-customer', {
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

        console.log('✅ customers_extended updated successfully:', updateResult.customer)
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

        console.log('📝 Updating basic customers table with:', basicData)
        const { error: basicError } = await supabase
          .from('customers')
          .update(basicData)
          .eq('id', editingId)

        if (basicError) {
          console.warn('⚠️ Could not update basic customers table:', basicError)
        } else {
          console.log('✅ Basic customers table updated successfully')
        }

        alert('Cliente aggiornato con successo!')

        if (onClientCreated && resultData) {
          onClientCreated(resultData.id)
        }
        handleClose()
        return // Exit early - UPDATE complete
      }

      // CREATE NEW CUSTOMER
      if (!editingId) {
        // CREATE New via Netlify function (bypasses RLS)
        console.log('[NewClientModal] Creating customer via Netlify function')
        const createResponse = await fetch('/.netlify/functions/save-customer', {
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

          if (basicError) console.warn('Could not insert into basic customers table (non-fatal):', basicError)
        } catch (legacyError) {
          console.warn('Silent error saving to legacy customers table:', legacyError)
        }

        alert('Cliente creato con successo!')
      }

      // Upload documents if any were selected
      const hasAnyFile = driversLicenseFront || driversLicenseBack || identityFront || identityBack || codiceFiscaleFront || codiceFiscaleBack

      if (createdClientId && hasAnyFile) {
        console.log('Uploading documents for client:', createdClientId)

        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (!user || authError) {
          console.warn('Cannot upload documents: user not authenticated')
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
                  document_type: docType as any,
                  file_name: file.name,
                  file_path: filePath,
                  file_size: file.size,
                  mime_type: file.type,
                  bucket_id: bucketParams,
                  uploaded_by: user.id
                })

              console.log(`✅ ${docType}${suffix} uploaded successfully`)
              return true
            } catch (error: any) {
              console.error(`Error uploading ${docType}${suffix}:`, error)
              alert(`Errore caricamento ${docType}${suffix}: ${error.message}`)
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
        console.log('Linking bookings to customer:', createdClientId)
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
          //   console.log('✅ Bookings successfully linked to', createdClientId)
          // }
        }
      }

      if (onClientCreated && resultData) {
        onClientCreated(resultData.id)
      }
      handleClose()

    } catch (error: any) {
      console.error('❌ Error saving customer:', error)
      console.error('Error details:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      })

      // Provide specific error messages based on error type
      let errorMessage = 'Errore salvataggio cliente: '

      if (error.code === '42501') {
        // Permission denied - RLS policy issue
        errorMessage += 'Permessi insufficienti. Verifica che il tuo account abbia i permessi di amministratore.'
      } else if (error.code === '42703') {
        // Column does not exist
        errorMessage += `Colonna mancante nel database: ${error.message}. Esegui lo script update_customers_extended_schema.sql`
      } else if (error.message?.includes('duplicate key')) {
        errorMessage += 'Cliente già esistente con questa email o codice fiscale.'
      } else if (error.message?.includes('violates check constraint')) {
        errorMessage += 'Dati non validi. Verifica i campi obbligatori.'
      } else if (error.message?.includes('network')) {
        errorMessage += 'Errore di connessione. Verifica la tua connessione internet.'
      } else {
        errorMessage += error.message || 'Errore sconosciuto'
      }

      alert(errorMessage)
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

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-theme-bg-primary/80 flex items-center justify-center z-50 p-4">
      <div className="bg-theme-bg-secondary border border-theme-border rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-theme-bg-secondary border-b border-theme-border p-6 flex justify-between items-center z-10">
          <h2 className="text-2xl font-bold text-theme-text-primary">{initialData ? 'Modifica Cliente' : 'Nuovo Cliente'}</h2>
          <button onClick={handleClose} className="text-theme-text-muted hover:text-theme-text-primary text-3xl leading-none">&times;</button>
        </div>

        <div className="p-6 space-y-8">

          {/* 1. TIPO CLIENTE SELECTION */}
          <div>
            <label className="block text-sm font-bold text-theme-text-secondary mb-3 uppercase tracking-wider">
              1. Tipo Cliente
            </label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div
                onClick={() => setFormData({ ...formData, tipo_cliente: 'persona_fisica' })}
                className={`cursor-pointer border rounded-lg p-4 flex flex-col items-center justify-center gap-2 transition-all ${formData.tipo_cliente === 'persona_fisica'
                  ? 'bg-blue-600/20 border-blue-500 text-blue-400 ring-1 ring-blue-500'
                  : 'bg-theme-bg-tertiary border-theme-border text-theme-text-muted hover:bg-gray-750'
                  }`}
              >
                <span className="font-semibold">Persona Fisica</span>
              </div>

              <div
                onClick={() => setFormData({ ...formData, tipo_cliente: 'azienda' })}
                className={`cursor-pointer border rounded-lg p-4 flex flex-col items-center justify-center gap-2 transition-all ${formData.tipo_cliente === 'azienda'
                  ? 'bg-purple-600/20 border-purple-500 text-purple-400 ring-1 ring-purple-500'
                  : 'bg-theme-bg-tertiary border-theme-border text-theme-text-muted hover:bg-gray-750'
                  }`}
              >
                <span className="font-semibold">Azienda</span>
              </div>

              <div
                onClick={() => setFormData({ ...formData, tipo_cliente: 'pubblica_amministrazione' })}
                className={`cursor-pointer border rounded-lg p-4 flex flex-col items-center justify-center gap-2 transition-all ${formData.tipo_cliente === 'pubblica_amministrazione'
                  ? 'bg-green-600/20 border-green-500 text-green-400 ring-1 ring-green-500'
                  : 'bg-theme-bg-tertiary border-theme-border text-theme-text-muted hover:bg-gray-750'
                  }`}
              >
                <span className="font-semibold">Pubblica Amm.</span>
              </div>
            </div>
          </div>

          <hr className="border-theme-border" />

          {/* 2. FORM FIELDS BASED ON TYPE */}
          <div className="space-y-6">

            {/* --- PERSONA FISICA --- */}
            {formData.tipo_cliente === 'persona_fisica' && (
              <div className="animate-fadeIn space-y-6">
                <div>
                  <h3 className="text-lg font-medium text-theme-text-primary mb-4">Dati Anagrafici</h3>

                  {/* Nome & Cognome First */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-theme-text-muted mb-1">Nome *</label>
                      <input
                        type="text"
                        value={formData.nome}
                        onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none"
                        placeholder="Mario"
                      />
                      {errors.nome && <p className="text-red-500 text-xs mt-1">{errors.nome}</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-theme-text-muted mb-1">Cognome *</label>
                      <input
                        type="text"
                        value={formData.cognome}
                        onChange={(e) => setFormData({ ...formData, cognome: e.target.value })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none"
                        placeholder="Rossi"
                      />
                      {errors.cognome && <p className="text-red-500 text-xs mt-1">{errors.cognome}</p>}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    <div>
                      <label className="block text-sm font-medium text-theme-text-muted mb-1">Codice Fiscale {formData.nazione === 'Italia' ? '*' : ''}</label>
                      <input
                        type="text"
                        value={formData.codice_fiscale}
                        onChange={(e) => setFormData({ ...formData, codice_fiscale: e.target.value.toUpperCase() })}
                        maxLength={16}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none uppercase font-mono"
                      />
                      {errors.codice_fiscale && <p className="text-red-500 text-xs mt-1">{errors.codice_fiscale}</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-theme-text-muted mb-1">Sesso</label>
                      <select
                        value={formData.sesso}
                        onChange={(e) => setFormData({ ...formData, sesso: e.target.value as any })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none"
                      >
                        <option value="">Seleziona...</option>
                        <option value="M">Maschio</option>
                        <option value="F">Femmina</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                    <div>
                      <label className="block text-sm font-medium text-theme-text-muted mb-1">Data Nascita</label>
                      <input
                        type="date"
                        lang="it"
                        value={formData.data_nascita || ''}
                        onChange={(e) => setFormData({ ...formData, data_nascita: e.target.value })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-theme-text-muted mb-1">Luogo Nascita</label>
                      <input
                        type="text"
                        value={formData.luogo_nascita}
                        onChange={(e) => setFormData({ ...formData, luogo_nascita: e.target.value })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-theme-text-muted mb-1">Provincia</label>
                      <input
                        type="text"
                        value={formData.provincia_nascita}
                        onChange={(e) => setFormData({ ...formData, provincia_nascita: e.target.value.toUpperCase() })}
                        maxLength={2}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none uppercase"
                        placeholder="RM"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-medium text-theme-text-primary mb-4 border-t border-theme-border pt-4">Residenza</h3>
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-theme-text-muted mb-1">Indirizzo *</label>
                      <input
                        type="text"
                        value={formData.indirizzo}
                        onChange={(e) => setFormData({ ...formData, indirizzo: e.target.value })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none"
                      />
                      {errors.indirizzo && <p className="text-red-500 text-xs mt-1">{errors.indirizzo}</p>}
                    </div>
                    <div className="w-24">
                      <label className="block text-sm font-medium text-theme-text-muted mb-1">Civico</label>
                      <input
                        type="text"
                        value={formData.numero_civico}
                        onChange={(e) => setFormData({ ...formData, numero_civico: e.target.value })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                    <div>
                      <label className="block text-sm font-medium text-theme-text-muted mb-1">Città *</label>
                      <input
                        type="text"
                        value={formData.citta_residenza}
                        onChange={(e) => setFormData({ ...formData, citta_residenza: e.target.value })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-theme-text-muted mb-1">CAP *</label>
                      <input
                        type="text"
                        value={formData.codice_postale}
                        onChange={(e) => setFormData({ ...formData, codice_postale: e.target.value })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-theme-text-muted mb-1">Provincia *</label>
                      <input
                        type="text"
                        value={formData.provincia_residenza}
                        onChange={(e) => setFormData({ ...formData, provincia_residenza: e.target.value.toUpperCase() })}
                        maxLength={2}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none uppercase"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-medium text-theme-text-primary mb-4 border-t border-theme-border pt-4">Contatti</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-theme-text-muted mb-1">Email *</label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none"
                      />
                      {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-theme-text-muted mb-1">Telefono *</label>
                      <input
                        type="text"
                        value={formData.telefono}
                        onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none"
                      />
                      {errors.telefono && <p className="text-red-500 text-xs mt-1">{errors.telefono}</p>}
                    </div>
                  </div>
                  <div className="mt-4">
                    <label className="block text-sm font-medium text-theme-text-muted mb-1">PEC (Opzionale)</label>
                    <input
                      type="email"
                      value={formData.pec_persona}
                      onChange={(e) => setFormData({ ...formData, pec_persona: e.target.value })}
                      className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none"
                    />
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-medium text-theme-text-primary mb-4 border-t border-theme-border pt-4">Patente</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-theme-text-muted mb-1">Numero Patente</label>
                      <input
                        type="text"
                        value={formData.patente_numero}
                        onChange={(e) => setFormData({ ...formData, patente_numero: e.target.value.toUpperCase() })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none uppercase"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-theme-text-muted mb-1">Categoria</label>
                      <select
                        value={formData.patente_tipo}
                        onChange={(e) => setFormData({ ...formData, patente_tipo: e.target.value })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none"
                      >
                        <option value="">Seleziona...</option>
                        <option value="B">B</option>
                        <option value="A">A</option>
                        <option value="C">C</option>
                        <option value="D">D</option>
                        <option value="E">E</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-theme-text-muted mb-1">Emessa da (Ente)</label>
                      <input
                        type="text"
                        value={formData.patente_ente}
                        onChange={(e) => setFormData({ ...formData, patente_ente: e.target.value })}
                        placeholder="es. MIT-UCO o Comune"
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-theme-text-muted mb-1">Data Rilascio</label>
                      <input
                        type="date"
                        lang="it"
                        value={formData.patente_rilascio || ''}
                        onChange={(e) => setFormData({ ...formData, patente_rilascio: e.target.value })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-theme-text-muted mb-1">Scadenza</label>
                      <input
                        type="date"
                        lang="it"
                        value={formData.patente_scadenza || ''}
                        onChange={(e) => setFormData({ ...formData, patente_scadenza: e.target.value })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* --- AZIENDA --- */}
            {formData.tipo_cliente === 'azienda' && (
              <div className="animate-fadeIn space-y-6">
                <div>
                  <h3 className="text-lg font-medium text-theme-text-primary mb-4">Dati Aziendali</h3>
                  <div>
                    <label className="block text-sm font-medium text-theme-text-muted mb-1">Ragione Sociale *</label>
                    <input
                      type="text"
                      value={formData.denominazione}
                      onChange={(e) => setFormData({ ...formData, denominazione: e.target.value })}
                      className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none"
                    />
                    {errors.denominazione && <p className="text-red-500 text-xs mt-1">{errors.denominazione}</p>}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    <div>
                      <label className="block text-sm font-medium text-theme-text-muted mb-1">Partita IVA *</label>
                      <input
                        type="text"
                        value={formData.partita_iva}
                        onChange={(e) => setFormData({ ...formData, partita_iva: e.target.value })}
                        maxLength={11}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none font-mono"
                      />
                      {errors.partita_iva && <p className="text-red-500 text-xs mt-1">{errors.partita_iva}</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-theme-text-muted mb-1">Codice Fiscale</label>
                      <input
                        type="text"
                        value={formData.cf_azienda}
                        onChange={(e) => setFormData({ ...formData, cf_azienda: e.target.value.toUpperCase() })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none font-mono uppercase"
                      />
                    </div>
                  </div>

                  <div className="mt-4">
                    <label className="block text-sm font-medium text-theme-text-muted mb-1">Sede Legale *</label>
                    <input
                      type="text"
                      value={formData.sede_legale}
                      onChange={(e) => setFormData({ ...formData, sede_legale: e.target.value })}
                      className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none"
                    />
                    {errors.sede_legale && <p className="text-red-500 text-xs mt-1">{errors.sede_legale}</p>}
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-medium text-theme-text-primary mb-4 border-t border-theme-border pt-4">Contatti Azienda</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-theme-text-muted mb-1">Email *</label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-theme-text-muted mb-1">Telefono *</label>
                      <input
                        type="text"
                        value={formData.telefono}
                        onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-medium text-theme-text-primary mb-4 border-t border-theme-border pt-4">Rappresentante Legale</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-theme-text-muted mb-1">Nome *</label>
                      <input
                        type="text"
                        value={formData.rappresentante_nome}
                        onChange={(e) => setFormData({ ...formData, rappresentante_nome: e.target.value })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-theme-text-muted mb-1">Cognome *</label>
                      <input
                        type="text"
                        value={formData.rappresentante_cognome}
                        onChange={(e) => setFormData({ ...formData, rappresentante_cognome: e.target.value })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none"
                      />
                    </div>
                  </div>
                  <div className="mt-4">
                    <label className="block text-sm font-medium text-theme-text-muted mb-1">Codice Fiscale Rappresentante *</label>
                    <input
                      type="text"
                      value={formData.rappresentante_cf}
                      onChange={(e) => setFormData({ ...formData, rappresentante_cf: e.target.value.toUpperCase() })}
                      className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none uppercase font-mono"
                    />
                  </div>

                  <div className="mt-4">
                    <h4 className="text-sm font-medium text-theme-text-secondary mb-3">Documento Rappresentante</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-theme-text-muted mb-1">Tipo Documento</label>
                        <select
                          value={formData.rappresentante_doc_tipo}
                          onChange={(e) => setFormData({ ...formData, rappresentante_doc_tipo: e.target.value })}
                          className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none"
                        >
                          <option value="">Seleziona...</option>
                          <option value="Carta d'Identità">Carta d'Identità</option>
                          <option value="Patente">Patente</option>
                          <option value="Passaporto">Passaporto</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-theme-text-muted mb-1">Numero Documento</label>
                        <input
                          type="text"
                          value={formData.rappresentante_doc_numero}
                          onChange={(e) => setFormData({ ...formData, rappresentante_doc_numero: e.target.value.toUpperCase() })}
                          className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none uppercase"
                          placeholder="es. CA12345AB"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-theme-text-muted mb-1">Data Rilascio</label>
                        <input
                          type="date"
                          value={formData.rappresentante_doc_rilascio}
                          onChange={(e) => setFormData({ ...formData, rappresentante_doc_rilascio: e.target.value })}
                          className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-theme-text-muted mb-1">Data Scadenza</label>
                        <input
                          type="date"
                          value={formData.rappresentante_doc_scadenza}
                          onChange={(e) => setFormData({ ...formData, rappresentante_doc_scadenza: e.target.value })}
                          className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-theme-text-muted mb-1">Luogo Rilascio</label>
                        <input
                          type="text"
                          value={formData.rappresentante_doc_luogo}
                          onChange={(e) => setFormData({ ...formData, rappresentante_doc_luogo: e.target.value })}
                          className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none"
                          placeholder="es. Comune di Roma"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* --- PUBBLICA AMMINISTRAZIONE --- */}
            {formData.tipo_cliente === 'pubblica_amministrazione' && (
              <div className="animate-fadeIn space-y-6">
                <div>
                  <h3 className="text-lg font-medium text-theme-text-primary mb-4">Dati PA</h3>
                  <div>
                    <label className="block text-sm font-medium text-theme-text-muted mb-1">Ente / Ufficio *</label>
                    <input
                      type="text"
                      value={formData.ente_ufficio}
                      onChange={(e) => setFormData({ ...formData, ente_ufficio: e.target.value })}
                      className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none"
                    />
                    {errors.ente_ufficio && <p className="text-red-500 text-xs mt-1">{errors.ente_ufficio}</p>}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    <div>
                      <label className="block text-sm font-medium text-theme-text-muted mb-1">Codice Univoco *</label>
                      <input
                        type="text"
                        value={formData.codice_univoco}
                        onChange={(e) => setFormData({ ...formData, codice_univoco: e.target.value.toUpperCase() })}
                        maxLength={7}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none uppercase font-mono"
                      />
                      {errors.codice_univoco && <p className="text-red-500 text-xs mt-1">{errors.codice_univoco}</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-theme-text-muted mb-1">CF / P.IVA Ente *</label>
                      <input
                        type="text"
                        value={formData.cf_pa}
                        onChange={(e) => setFormData({ ...formData, cf_pa: e.target.value.toUpperCase() })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none uppercase font-mono"
                      />
                      {errors.cf_pa && <p className="text-red-500 text-xs mt-1">{errors.cf_pa}</p>}
                    </div>
                  </div>
                  <div className="mt-4">
                    <label className="block text-sm font-medium text-theme-text-muted mb-1">Città *</label>
                    <input
                      type="text"
                      value={formData.citta}
                      onChange={(e) => setFormData({ ...formData, citta: e.target.value })}
                      className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none"
                    />
                    {errors.citta && <p className="text-red-500 text-xs mt-1">{errors.citta}</p>}
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-medium text-theme-text-primary mb-4 border-t border-theme-border pt-4">Contatti PA</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-theme-text-muted mb-1">Email / PEC *</label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-theme-text-muted mb-1">Telefono *</label>
                      <input
                        type="text"
                        value={formData.telefono}
                        onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
                        className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>



          {/* Note Field - GLOBAL */}
          <div>
            <label className="block text-sm font-medium text-theme-text-muted mb-1">Note</label>
            <textarea
              value={formData.note}
              onChange={(e) => setFormData({ ...formData, note: e.target.value })}
              rows={3}
              className="w-full bg-theme-bg-tertiary border border-theme-border-light rounded p-2.5 text-theme-text-primary focus:border-dr7-gold outline-none resize-none"
              placeholder="Note interne sul cliente..."
            />
          </div>

          {/* OPTIONAL DOCUMENT UPLOAD SECTION */}
          <div className="border-t border-theme-border pt-6">
            <button
              type="button"
              onClick={() => setShowDocumentSection(!showDocumentSection)}
              className="w-full flex items-center justify-between p-4 bg-theme-bg-tertiary hover:bg-gray-750 rounded-full transition-colors"
            >
              <div className="flex items-center gap-3">
                <svg className="w-6 h-6 text-dr7-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                <div className="text-left">
                  <h3 className="text-lg font-medium text-theme-text-primary">Documenti (Opzionale)</h3>
                  <p className="text-sm text-theme-text-muted">Carica patente e documento d'identità se disponibili (Fronte/Retro)</p>
                </div>
              </div>
              <svg
                className={`w-5 h-5 text-theme-text-muted transition-transform ${showDocumentSection ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showDocumentSection && (
              <div className="mt-4 space-y-4 animate-fadeIn">

                {/* Driver's License Upload */}
                <div className="bg-theme-bg-tertiary border border-theme-border rounded-full p-4">
                  <h4 className="text-sm font-medium text-theme-text-secondary mb-3 flex items-center gap-2">
                    <svg className="w-4 h-4 text-dr7-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>
                    Patente di Guida
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-theme-text-muted mb-1">Fronte</label>
                      <input
                        type="file"
                        onChange={(e) => setDriversLicenseFront(e.target.files?.[0] || null)}
                        className="w-full px-3 py-2 bg-gray-700 border border-theme-border-light rounded text-theme-text-primary text-xs
                          file:mr-2 file:py-1 file:px-2 file:rounded file:border-0
                          file:text-xs file:font-semibold file:bg-dr7-gold file:text-black
                          hover:file:bg-yellow-500 file:cursor-pointer"
                        accept="image/*,.pdf"
                      />
                      {driversLicenseFront && (
                        <p className="text-xs text-green-400 mt-1 truncate">{driversLicenseFront.name}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs text-theme-text-muted mb-1">Retro</label>
                      <input
                        type="file"
                        onChange={(e) => setDriversLicenseBack(e.target.files?.[0] || null)}
                        className="w-full px-3 py-2 bg-gray-700 border border-theme-border-light rounded text-theme-text-primary text-xs
                          file:mr-2 file:py-1 file:px-2 file:rounded file:border-0
                          file:text-xs file:font-semibold file:bg-dr7-gold file:text-black
                          hover:file:bg-yellow-500 file:cursor-pointer"
                        accept="image/*,.pdf"
                      />
                      {driversLicenseBack && (
                        <p className="text-xs text-green-400 mt-1 truncate">{driversLicenseBack.name}</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Identity Document Upload */}
                <div className="bg-theme-bg-tertiary border border-theme-border rounded-full p-4">
                  <h4 className="text-sm font-medium text-theme-text-secondary mb-3 flex items-center gap-2">
                    <svg className="w-4 h-4 text-dr7-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
                    </svg>
                    Documento d'Identità
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-theme-text-muted mb-1">Fronte</label>
                      <input
                        type="file"
                        onChange={(e) => setIdentityFront(e.target.files?.[0] || null)}
                        className="w-full px-3 py-2 bg-gray-700 border border-theme-border-light rounded text-theme-text-primary text-xs
                          file:mr-2 file:py-1 file:px-2 file:rounded file:border-0
                          file:text-xs file:font-semibold file:bg-dr7-gold file:text-black
                          hover:file:bg-yellow-500 file:cursor-pointer"
                        accept="image/*,.pdf"
                      />
                      {identityFront && (
                        <p className="text-xs text-green-400 mt-1 truncate">{identityFront.name}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs text-theme-text-muted mb-1">Retro</label>
                      <input
                        type="file"
                        onChange={(e) => setIdentityBack(e.target.files?.[0] || null)}
                        className="w-full px-3 py-2 bg-gray-700 border border-theme-border-light rounded text-theme-text-primary text-xs
                          file:mr-2 file:py-1 file:px-2 file:rounded file:border-0
                          file:text-xs file:font-semibold file:bg-dr7-gold file:text-black
                          hover:file:bg-yellow-500 file:cursor-pointer"
                        accept="image/*,.pdf"
                      />
                      {identityBack && (
                        <p className="text-xs text-green-400 mt-1 truncate">{identityBack.name}</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Codice Fiscale Upload */}
                <div className="bg-theme-bg-tertiary border border-theme-border rounded-full p-4">
                  <h4 className="text-sm font-medium text-theme-text-secondary mb-3 flex items-center gap-2">
                    <svg className="w-4 h-4 text-dr7-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Codice Fiscale
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-theme-text-muted mb-1">Fronte</label>
                      <input
                        type="file"
                        onChange={(e) => setCodiceFiscaleFront(e.target.files?.[0] || null)}
                        className="w-full px-3 py-2 bg-gray-700 border border-theme-border-light rounded text-theme-text-primary text-xs
                          file:mr-2 file:py-1 file:px-2 file:rounded file:border-0
                          file:text-xs file:font-semibold file:bg-dr7-gold file:text-black
                          hover:file:bg-yellow-500 file:cursor-pointer"
                        accept="image/*,.pdf"
                      />
                      {codiceFiscaleFront && (
                        <p className="text-xs text-green-400 mt-1 truncate">{codiceFiscaleFront.name}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs text-theme-text-muted mb-1">Retro</label>
                      <input
                        type="file"
                        onChange={(e) => setCodiceFiscaleBack(e.target.files?.[0] || null)}
                        className="w-full px-3 py-2 bg-gray-700 border border-theme-border-light rounded text-theme-text-primary text-xs
                          file:mr-2 file:py-1 file:px-2 file:rounded file:border-0
                          file:text-xs file:font-semibold file:bg-dr7-gold file:text-black
                          hover:file:bg-yellow-500 file:cursor-pointer"
                        accept="image/*,.pdf"
                      />
                      {codiceFiscaleBack && (
                        <p className="text-xs text-green-400 mt-1 truncate">{codiceFiscaleBack.name}</p>
                      )}
                    </div>
                  </div>
                </div>

                {(driversLicenseFront || driversLicenseBack || identityFront || identityBack || codiceFiscaleFront || codiceFiscaleBack) && (
                  <div className="bg-green-900/20 border border-green-500/30 rounded-lg p-3">
                    <p className="text-sm text-green-300 flex items-center gap-2">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Documenti selezionati verranno caricati al salvataggio.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* FOOTER ACTIONS */}
          <div className="flex justify-end gap-3 pt-6 border-t border-theme-border">
            <button
              onClick={handleClose}
              disabled={isSaving}
              className="px-6 py-2.5 rounded-full text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-bg-tertiary transition-colors"
            >
              Annulla
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-8 py-2.5 rounded-full bg-dr7-gold text-black font-bold hover:bg-yellow-500 transition-colors shadow-lg disabled:opacity-50"
            >
              {isSaving ? 'Salvataggio...' : (initialData ? 'Aggiorna Cliente' : 'Crea Cliente')}
            </button>
          </div>

        </div>
      </div>
    </div >
  )
}
