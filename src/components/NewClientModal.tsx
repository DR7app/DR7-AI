import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { getResidenceStatus, getProvinciaByCity } from '../data/sardegnaProvince'
import toast from 'react-hot-toast'
import { logger } from '../utils/logger'
import CalcolaCFButton from './CalcolaCFButton'

interface NewClientModalProps {
  isOpen: boolean
  onClose: () => void
  onClientCreated?: (clientId: string) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialData?: any // Customer data for editing
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
  sesso: string
  data_nascita: string
  citta_nascita: string
  provincia_nascita: string
  indirizzo: string
  numero_civico: string
  codice_postale: string
  citta_residenza: string
  provincia_residenza: string
  pec_persona: string
  tipo_patente: string
  numero_patente: string
  emessa_da: string
  data_rilascio_patente: string
  scadenza_patente: string

  // Azienda
  denominazione: string
  partita_iva: string
  cf_azienda: string
  sede_legale: string
  sede_operativa: string
  codice_destinatario: string
  pec_azienda: string
  nome_rappresentante: string
  cognome_rappresentante: string
  data_nascita_rappresentante: string
  cf_rappresentante: string
  ruolo_rappresentante: string
  tipo_documento_rappresentante: string
  numero_documento_rappresentante: string
  data_rilascio_documento: string
  luogo_rilascio_documento: string
  indirizzo_ddt: string
  contatti_cliente: string

  // Pubblica Amministrazione
  codice_univoco: string
  cf_pa: string
  ente_ufficio: string
  citta: string
  partita_iva_pa: string
  pec_pa: string
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
    citta_nascita: '',
    provincia_nascita: '',
    indirizzo: '',
    numero_civico: '',
    codice_postale: '',
    citta_residenza: '',
    provincia_residenza: '',
    pec_persona: '',
    tipo_patente: '',
    numero_patente: '',
    emessa_da: '',
    data_rilascio_patente: '',
    scadenza_patente: '',
    denominazione: '',
    partita_iva: '',
    cf_azienda: '',
    sede_legale: '',
    sede_operativa: '',
    codice_destinatario: '',
    pec_azienda: '',
    nome_rappresentante: '',
    cognome_rappresentante: '',
    data_nascita_rappresentante: '',
    cf_rappresentante: '',
    ruolo_rappresentante: '',
    tipo_documento_rappresentante: '',
    numero_documento_rappresentante: '',
    data_rilascio_documento: '',
    luogo_rilascio_documento: '',
    indirizzo_ddt: '',
    contatti_cliente: '',
    codice_univoco: '',
    cf_pa: '',
    ente_ufficio: '',
    citta: '',
    partita_iva_pa: '',
    pec_pa: ''
  })

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSaving, setIsSaving] = useState(false)

  // Load initial data when editing
  useEffect(() => {
    if (isOpen) {
      logger.log('[NewClientModal] Modal opened. initialData:', initialData)
      if (initialData) {
        logger.log('[NewClientModal] Populating modal with data:', initialData)
        logger.log('[NewClientModal] initialData.id:', initialData.id)

        // CRITICAL: Check if this is a "new" customer placeholder from booking
        // If so, we want to CREATE a new record, not update the temp ID
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((initialData as any)._isNew) {
          logger.log('[NewClientModal] _isNew flag detected -> Force CREATE mode')
          setEditingId(null) // Force create mode
        } else {
          // If ID is a temp placeholder (starts with "temp-"), treat as CREATE 
          // so we get a real UUID from DB. 
          // The dedupe logic in CustomersTab will then hide the temp one.
          if (initialData.id && String(initialData.id).startsWith('temp-')) {
            logger.log('[NewClientModal] Temp ID detected -> Force CREATE mode to generate real UUID')
            setEditingId(null)
          } else {
            // Real UUID -> UPDATE mode
            setEditingId(initialData.id || null)
            logger.log('[NewClientModal] Setting editingId to:', initialData.id)
          }
        }

        setFormData({
          tipo_cliente: initialData.tipo_cliente || 'persona_fisica',
          nazione: initialData.nazione || 'Italia',
          telefono: initialData.telefono || '',
          email: initialData.email || '',
          nome: initialData.nome || '',
          cognome: initialData.cognome || '',
          codice_fiscale: initialData.codice_fiscale || '',
          sesso: initialData.sesso || '',
          data_nascita: initialData.data_nascita || '',
          citta_nascita: initialData.citta_nascita || '',
          provincia_nascita: initialData.provincia_nascita || '',
          indirizzo: initialData.indirizzo || '',
          numero_civico: initialData.numero_civico || '',
          codice_postale: initialData.codice_postale || '',
          citta_residenza: initialData.citta_residenza || '',
          provincia_residenza: initialData.provincia_residenza || '',
          pec_persona: initialData.pec || '',
          tipo_patente: initialData.tipo_patente || '',
          numero_patente: initialData.numero_patente || '',
          emessa_da: initialData.emessa_da || '',
          data_rilascio_patente: initialData.data_rilascio_patente || '',
          scadenza_patente: initialData.scadenza_patente || '',
          denominazione: initialData.ragione_sociale || initialData.denominazione || '',
          partita_iva: initialData.partita_iva || '',
          cf_azienda: initialData.tipo_cliente === 'azienda' ? (initialData.codice_fiscale || '') : '',
          sede_legale: initialData.sede_legale || '',
          sede_operativa: initialData.sede_operativa || '',
          codice_destinatario: initialData.codice_destinatario || '',
          pec_azienda: initialData.tipo_cliente === 'azienda' ? (initialData.pec || '') : '',
          nome_rappresentante: initialData.nome_rappresentante || '',
          cognome_rappresentante: initialData.cognome_rappresentante || '',
          data_nascita_rappresentante: initialData.data_nascita_rappresentante || '',
          cf_rappresentante: initialData.cf_rappresentante || '',
          ruolo_rappresentante: initialData.ruolo_rappresentante || '',
          tipo_documento_rappresentante: initialData.tipo_documento_rappresentante || '',
          numero_documento_rappresentante: initialData.numero_documento_rappresentante || '',
          data_rilascio_documento: initialData.data_rilascio_documento || '',
          luogo_rilascio_documento: initialData.luogo_rilascio_documento || '',
          indirizzo_ddt: initialData.metadata?.indirizzo_ddt || '',
          contatti_cliente: initialData.metadata?.contatti_cliente || '',
          codice_univoco: initialData.codice_univoco || '',
          cf_pa: initialData.tipo_cliente === 'pubblica_amministrazione' ? (initialData.codice_fiscale || '') : '',
          ente_ufficio: initialData.ente_o_ufficio || initialData.ente_ufficio || '',
          citta: initialData.citta || '',
          partita_iva_pa: initialData.tipo_cliente === 'pubblica_amministrazione' ? (initialData.partita_iva || '') : '',
          pec_pa: initialData.tipo_cliente === 'pubblica_amministrazione' ? (initialData.pec || '') : ''
        })
      } else {
        // Reset if opening in "New" mode (though handleClose usually does this, it's safer here too)
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
          citta_nascita: '',
          provincia_nascita: '',
          indirizzo: '',
          numero_civico: '',
          codice_postale: '',
          citta_residenza: '',
          provincia_residenza: '',
          pec_persona: '',
          tipo_patente: '',
          numero_patente: '',
          emessa_da: '',
          data_rilascio_patente: '',
          scadenza_patente: '',
          denominazione: '',
          partita_iva: '',
          cf_azienda: '',
          sede_legale: '',
          sede_operativa: '',
          codice_destinatario: '',
          pec_azienda: '',
          nome_rappresentante: '',
          cognome_rappresentante: '',
          data_nascita_rappresentante: '',
          cf_rappresentante: '',
          ruolo_rappresentante: '',
          tipo_documento_rappresentante: '',
          numero_documento_rappresentante: '',
          data_rilascio_documento: '',
          luogo_rilascio_documento: '',
          indirizzo_ddt: '',
          contatti_cliente: '',
          codice_univoco: '',
          cf_pa: '',
          ente_ufficio: '',
          citta: '',
          partita_iva_pa: '',
          pec_pa: ''
        })
      }
    }
  }, [isOpen, initialData])

  // Validation functions
  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email)
  }

  const validateItalianPhone = (phone: string): boolean => {
    // Italian phone: +39 or 0039 or direct, 9-13 digits
    const phoneRegex = /^(\+39|0039)?[\s]?[0-9]{9,13}$/
    return phoneRegex.test(phone.replace(/\s/g, ''))
  }

  const validateCodiceFiscale = (cf: string): boolean => {
    // Italian CF: 16 alphanumeric characters
    const cfRegex = /^[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]$/i
    return cf.length === 16 && cfRegex.test(cf.toUpperCase())
  }

  const validatePartitaIVA = (piva: string): boolean => {
    // Italian P.IVA: 11 digits
    const pivaRegex = /^[0-9]{11}$/
    return pivaRegex.test(piva)
  }

  const validateCodiceUnivoco = (codice: string): boolean => {
    // Codice Univoco: 6-7 alphanumeric characters
    return codice.length >= 6 && codice.length <= 7 && /^[A-Z0-9]+$/i.test(codice)
  }

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    // Global validations
    if (!formData.email) {
      newErrors.email = 'Email obbligatoria'
    } else if (!validateEmail(formData.email)) {
      newErrors.email = 'Formato email non valido'
    }

    if (!formData.telefono) {
      newErrors.telefono = 'Telefono obbligatorio'
    } else if (!validateItalianPhone(formData.telefono)) {
      newErrors.telefono = 'Formato telefono non valido'
    }

    if (!formData.nazione) {
      newErrors.nazione = 'Nazione obbligatoria'
    }

    // Type-specific validations
    if (formData.tipo_cliente === 'persona_fisica') {
      if (!formData.nome) newErrors.nome = 'Nome obbligatorio'
      if (!formData.cognome) newErrors.cognome = 'Cognome obbligatorio'

      // Codice Fiscale is mandatory only for Italian clients
      if (formData.nazione === 'Italia') {
        if (!formData.codice_fiscale) {
          newErrors.codice_fiscale = 'Codice Fiscale obbligatorio per clienti italiani'
        } else if (!validateCodiceFiscale(formData.codice_fiscale)) {
          newErrors.codice_fiscale = 'Codice Fiscale non valido (16 caratteri)'
        }
      } else if (formData.codice_fiscale && !validateCodiceFiscale(formData.codice_fiscale)) {
        // Optional validation if CF is provided for non-Italian clients
        newErrors.codice_fiscale = 'Codice Fiscale non valido (16 caratteri)'
      }

      if (!formData.indirizzo) newErrors.indirizzo = 'Indirizzo obbligatorio'
      if (!formData.citta_residenza) newErrors.citta_residenza = 'Città obbligatoria'
      if (!formData.codice_postale) newErrors.codice_postale = 'CAP obbligatorio'
      // provincia_residenza is optional (auto-detected from city)
    }

    if (formData.tipo_cliente === 'azienda') {
      if (!formData.denominazione) newErrors.denominazione = 'Denominazione obbligatoria'
      if (!formData.partita_iva) {
        newErrors.partita_iva = 'Partita IVA obbligatoria'
      } else if (!validatePartitaIVA(formData.partita_iva)) {
        newErrors.partita_iva = 'Partita IVA non valida (11 cifre)'
      }
      if (!formData.sede_legale) newErrors.sede_legale = 'Sede legale obbligatoria'

      // Legal representative validations
      if (!formData.nome_rappresentante) newErrors.nome_rappresentante = 'Nome rappresentante obbligatorio'
      if (!formData.cognome_rappresentante) newErrors.cognome_rappresentante = 'Cognome rappresentante obbligatorio'
      if (!formData.cf_rappresentante) {
        newErrors.cf_rappresentante = 'Codice Fiscale rappresentante obbligatorio'
      } else if (!validateCodiceFiscale(formData.cf_rappresentante)) {
        newErrors.cf_rappresentante = 'Codice Fiscale non valido (16 caratteri)'
      }
    }

    if (formData.tipo_cliente === 'pubblica_amministrazione') {
      if (!formData.codice_univoco) {
        newErrors.codice_univoco = 'Codice Univoco obbligatorio'
      } else if (!validateCodiceUnivoco(formData.codice_univoco)) {
        newErrors.codice_univoco = 'Codice Univoco non valido (6-7 caratteri)'
      }
      if (!formData.cf_pa) {
        newErrors.cf_pa = 'Codice Fiscale obbligatorio'
      } else if (!validateCodiceFiscale(formData.cf_pa)) {
        newErrors.cf_pa = 'Codice Fiscale non valido (16 caratteri)'
      }
      if (!formData.ente_ufficio) newErrors.ente_ufficio = 'Ente o Ufficio obbligatorio'
      if (!formData.citta) newErrors.citta = 'Città obbligatoria'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSave = async () => {
    logger.log('[NewClientModal] HandleSave triggered. FormData:', formData)
    if (!validateForm()) {
      logger.log('[NewClientModal] Validation failed. Errors:', errors)
      return
    }

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
        source: 'admin',
        residence_status: residenceStatus
      }

      // Only set created_at for new customers
      if (!editingId) {
        customerData.created_at = new Date().toISOString()
      } else {
        customerData.updated_at = new Date().toISOString()
      }

      // Add type-specific fields
      if (formData.tipo_cliente === 'persona_fisica') {
        customerData.nome = formData.nome
        customerData.cognome = formData.cognome
        customerData.codice_fiscale = formData.codice_fiscale.toUpperCase()
        if (formData.sesso) customerData.sesso = formData.sesso
        if (formData.data_nascita) customerData.data_nascita = formData.data_nascita
        if (formData.citta_nascita) customerData.citta_nascita = formData.citta_nascita
        if (formData.provincia_nascita) customerData.provincia_nascita = formData.provincia_nascita
        customerData.indirizzo = formData.indirizzo
        if (formData.numero_civico) customerData.numero_civico = formData.numero_civico
        if (formData.codice_postale) customerData.codice_postale = formData.codice_postale.trim().substring(0, 10)
        if (formData.citta_residenza) customerData.citta_residenza = formData.citta_residenza
        if (formData.provincia_residenza) customerData.provincia_residenza = formData.provincia_residenza
        if (formData.pec_persona) customerData.pec = formData.pec_persona
        if (formData.tipo_patente) customerData.tipo_patente = formData.tipo_patente
        if (formData.numero_patente) customerData.numero_patente = formData.numero_patente
        if (formData.emessa_da) customerData.emessa_da = formData.emessa_da
        if (formData.data_rilascio_patente) customerData.data_rilascio_patente = formData.data_rilascio_patente
        if (formData.scadenza_patente) customerData.scadenza_patente = formData.scadenza_patente
      } else if (formData.tipo_cliente === 'azienda') {
        customerData.ragione_sociale = formData.denominazione
        customerData.partita_iva = formData.partita_iva
        if (formData.cf_azienda) customerData.codice_fiscale = formData.cf_azienda.toUpperCase()
        customerData.sede_legale = formData.sede_legale
        if (formData.sede_operativa) customerData.sede_operativa = formData.sede_operativa
        if (formData.codice_destinatario) customerData.codice_destinatario = formData.codice_destinatario
        if (formData.pec_azienda) customerData.pec = formData.pec_azienda

        // Legal representative information
        customerData.nome_rappresentante = formData.nome_rappresentante
        customerData.cognome_rappresentante = formData.cognome_rappresentante
        if (formData.data_nascita_rappresentante) customerData.data_nascita_rappresentante = formData.data_nascita_rappresentante
        customerData.cf_rappresentante = formData.cf_rappresentante.toUpperCase()
        if (formData.ruolo_rappresentante) customerData.ruolo_rappresentante = formData.ruolo_rappresentante
        if (formData.tipo_documento_rappresentante) customerData.tipo_documento_rappresentante = formData.tipo_documento_rappresentante
        if (formData.numero_documento_rappresentante) customerData.numero_documento_rappresentante = formData.numero_documento_rappresentante
        if (formData.data_rilascio_documento) customerData.data_rilascio_documento = formData.data_rilascio_documento
        if (formData.luogo_rilascio_documento) customerData.luogo_rilascio_documento = formData.luogo_rilascio_documento

        if (formData.indirizzo_ddt || formData.contatti_cliente) {
          customerData.metadata = {
            indirizzo_ddt: formData.indirizzo_ddt,
            contatti_cliente: formData.contatti_cliente
          }
        }
      } else if (formData.tipo_cliente === 'pubblica_amministrazione') {
        customerData.denominazione = formData.ente_ufficio
        customerData.ente_ufficio = formData.ente_ufficio  // Also save to ente_ufficio field
        customerData.codice_univoco = formData.codice_univoco.toUpperCase()
        customerData.codice_fiscale = formData.cf_pa.toUpperCase()
        customerData.indirizzo = formData.citta
        customerData.citta = formData.citta  // Also save to citta field
        if (formData.partita_iva_pa) customerData.partita_iva = formData.partita_iva_pa
        if (formData.pec_pa) customerData.pec = formData.pec_pa
      }

      logger.log('[NewClientModal] Saving customer. editingId:', editingId)
      logger.log('[NewClientModal] Customer data to save:', customerData)

      let result
      if (editingId) {
        // UPDATE existing customer
        const { data: updatedClient, error } = await supabase
          .from('customers_extended')
          .update(customerData)
          .eq('id', editingId)
          .select()
          .single()

        if (error) throw error
        result = updatedClient
        toast.success('Cliente aggiornato con successo!')
      } else {
        // ===== DEDUP GUARD: Before INSERT, check if customer already exists =====
        let existingCustomerId: string | null = null

        // 1. Check by codice_fiscale (persona_fisica)
        if (!existingCustomerId && customerData.codice_fiscale?.trim()) {
          const { data } = await supabase
            .from('customers_extended')
            .select('id')
            .eq('codice_fiscale', customerData.codice_fiscale.trim().toUpperCase())
            .maybeSingle()
          if (data) existingCustomerId = data.id
        }

        // 2. Check by partita_iva (azienda)
        if (!existingCustomerId && customerData.partita_iva?.trim()) {
          const { data } = await supabase
            .from('customers_extended')
            .select('id')
            .eq('partita_iva', customerData.partita_iva.trim())
            .maybeSingle()
          if (data) existingCustomerId = data.id
        }

        // 3. Check by email
        if (!existingCustomerId && customerData.email?.trim()) {
          const { data } = await supabase
            .from('customers_extended')
            .select('id')
            .ilike('email', customerData.email.trim())
            .maybeSingle()
          if (data) existingCustomerId = data.id
        }

        // 4. Check by telefono
        if (!existingCustomerId && customerData.telefono?.trim()) {
          let normPhone = customerData.telefono.replace(/[\s\-+()]/g, '')
          if (normPhone.startsWith('00')) normPhone = normPhone.substring(2)
          if (normPhone.length === 10) normPhone = '39' + normPhone
          const { data } = await supabase
            .from('customers_extended')
            .select('id')
            .eq('telefono', normPhone)
            .maybeSingle()
          if (data) existingCustomerId = data.id
        }

        if (existingCustomerId) {
          // Customer already exists — UPDATE instead of creating a duplicate
          logger.log('[NewClientModal] DEDUP: Found existing customer', existingCustomerId, '— updating instead of creating')
          const { data: updatedClient, error } = await supabase
            .from('customers_extended')
            .update(customerData)
            .eq('id', existingCustomerId)
            .select()
            .single()

          if (error) throw error
          result = updatedClient
          toast.success('Cliente esistente aggiornato!')
        } else {
          // INSERT new customer — no existing match found
          const { data: newClient, error } = await supabase
            .from('customers_extended')
            .insert([customerData])
            .select()
            .single()

          if (error) throw error
          result = newClient
          toast.success('Cliente creato con successo!')
        }
      }

      if (onClientCreated && result) {
        onClientCreated(result.id)
      }

      handleClose()
    } catch (error) {
      console.error('Errore durante il salvataggio del cliente:', error)
      toast.error('Errore durante il salvataggio del cliente: ' + (error as Error).message)
    } finally {
      setIsSaving(false)
    }
  }

  const handleClose = () => {
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
      citta_nascita: '',
      provincia_nascita: '',
      indirizzo: '',
      numero_civico: '',
      codice_postale: '',
      citta_residenza: '',
      provincia_residenza: '',
      pec_persona: '',
      tipo_patente: '',
      numero_patente: '',
      emessa_da: '',
      data_rilascio_patente: '',
      scadenza_patente: '',
      denominazione: '',
      partita_iva: '',
      cf_azienda: '',
      sede_legale: '',
      sede_operativa: '',
      codice_destinatario: '',
      pec_azienda: '',
      nome_rappresentante: '',
      cognome_rappresentante: '',
      data_nascita_rappresentante: '',
      cf_rappresentante: '',
      ruolo_rappresentante: '',
      tipo_documento_rappresentante: '',
      numero_documento_rappresentante: '',
      data_rilascio_documento: '',
      luogo_rilascio_documento: '',
      indirizzo_ddt: '',
      contatti_cliente: '',
      codice_univoco: '',
      cf_pa: '',
      ente_ufficio: '',
      citta: '',
      partita_iva_pa: '',
      pec_pa: ''
    })
    setErrors({})
    setEditingId(null) // Reset editing mode
    onClose()
  }

  const isSaveDisabled = () => {
    // Log validation status for debugging
    const validationStatus = {
      email: !!formData.email && validateEmail(formData.email),
      phone: !!formData.telefono && validateItalianPhone(formData.telefono),
      nazione: !!formData.nazione,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type_checks: {} as any
    }

    // Check global fields
    if (!formData.email || !formData.telefono || !formData.nazione) {
      logger.log('[NewClientModal] Save disabled: Missing global fields', validationStatus)
      return true
    }
    if (!validateEmail(formData.email) || !validateItalianPhone(formData.telefono)) {
      logger.log('[NewClientModal] Save disabled: Invalid email or phone', validationStatus)
      return true
    }

    // Check type-specific fields
    if (formData.tipo_cliente === 'persona_fisica') {
      // Codice Fiscale is required only for Italian clients
      const cfRequired = formData.nazione === 'Italia' ? !formData.codice_fiscale : false

      validationStatus.type_checks = {
        nome: !!formData.nome,
        cognome: !!formData.cognome,
        cf_required: cfRequired
      }

      // RELAXED VALIDATION: Address fields are now optional for saving
      if (!formData.nome || !formData.cognome || cfRequired) {
        logger.log('[NewClientModal] Save disabled: Missing persona_fisica fields', validationStatus)
        return true
      }
    }

    if (formData.tipo_cliente === 'azienda') {
      validationStatus.type_checks = {
        denominazione: !!formData.denominazione,
        piva: !!formData.partita_iva
      }

      // RELAXED VALIDATION: Only Require Denominazione and P.IVA
      if (!formData.denominazione || !formData.partita_iva) {
        logger.log('[NewClientModal] Save disabled: Missing azienda fields', validationStatus)
        return true
      }
    }

    if (formData.tipo_cliente === 'pubblica_amministrazione') {
      if (!formData.codice_univoco || !formData.cf_pa || !formData.ente_ufficio || !formData.citta) return true
    }

    return false
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-theme-overlay backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-theme-text-primary rounded-lg max-w-2xl w-full my-8 shadow-2xl">
        {/* Header */}
        <div className="p-6 border-b border-theme-border">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold text-theme-text-primary">
              {editingId ? 'Modifica Cliente' : 'Nuovo Cliente'}
            </h2>
            <button
              onClick={handleClose}
              className="text-theme-text-muted hover:text-theme-text-muted transition-colors text-3xl leading-none"
            >
              ×
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          {/* Client Type Selection */}
          <div>
            <label className="block text-sm font-semibold text-theme-text-secondary mb-3">
              Tipo Cliente *
            </label>
            <div className="flex gap-4">
              <label className="flex items-center cursor-pointer">
                <input
                  type="radio"
                  name="tipo_cliente"
                  value="persona_fisica"
                  checked={formData.tipo_cliente === 'persona_fisica'}
                  onChange={(e) => setFormData({ ...formData, tipo_cliente: e.target.value as ClientType })}
                  className="mr-2 w-4 h-4 text-blue-600"
                />
                <span className="text-sm text-theme-text-secondary">Persona Fisica</span>
              </label>
              <label className="flex items-center cursor-pointer">
                <input
                  type="radio"
                  name="tipo_cliente"
                  value="azienda"
                  checked={formData.tipo_cliente === 'azienda'}
                  onChange={(e) => setFormData({ ...formData, tipo_cliente: e.target.value as ClientType })}
                  className="mr-2 w-4 h-4 text-blue-600"
                />
                <span className="text-sm text-theme-text-secondary">Azienda</span>
              </label>
              <label className="flex items-center cursor-pointer">
                <input
                  type="radio"
                  name="tipo_cliente"
                  value="pubblica_amministrazione"
                  checked={formData.tipo_cliente === 'pubblica_amministrazione'}
                  onChange={(e) => setFormData({ ...formData, tipo_cliente: e.target.value as ClientType })}
                  className="mr-2 w-4 h-4 text-blue-600"
                />
                <span className="text-sm text-theme-text-secondary">Pubblica Amministrazione</span>
              </label>
            </div>
          </div>

          {/* PERSONA FISICA FIELDS */}
          {formData.tipo_cliente === 'persona_fisica' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                    Nome *
                  </label>
                  <input
                    type="text"
                    value={formData.nome}
                    onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                    className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  {errors.nome && <p className="text-red-500 text-xs mt-1">{errors.nome}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                    Cognome *
                  </label>
                  <input
                    type="text"
                    value={formData.cognome}
                    onChange={(e) => setFormData({ ...formData, cognome: e.target.value })}
                    className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  {errors.cognome && <p className="text-red-500 text-xs mt-1">{errors.cognome}</p>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                    Codice Fiscale {formData.nazione === 'Italia' ? '*' : '(opzionale)'}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={formData.codice_fiscale}
                      onChange={(e) => setFormData({ ...formData, codice_fiscale: e.target.value.toUpperCase() })}
                      maxLength={16}
                      className="flex-1 px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 uppercase"
                      placeholder="RSSMRA80A01H501U"
                    />
                    <CalcolaCFButton config={{
                      getCognome: () => formData.cognome,
                      getNome: () => formData.nome,
                      getDataNascita: () => formData.data_nascita,
                      getSesso: () => formData.sesso,
                      getLuogoNascita: () => formData.citta_nascita,
                      getCodiceFiscale: () => formData.codice_fiscale,
                      setCodiceFiscale: (v) => setFormData(p => ({ ...p, codice_fiscale: v })),
                      setSesso: (v) => setFormData(p => ({ ...p, sesso: v })),
                      setDataNascita: (v) => setFormData(p => ({ ...p, data_nascita: v })),
                      setLuogoNascita: (v) => setFormData(p => ({ ...p, citta_nascita: v })),
                      setProvinciaNascita: (v) => setFormData(p => ({ ...p, provincia_nascita: v })),
                    }} />
                  </div>
                  {errors.codice_fiscale && <p className="text-red-500 text-xs mt-1">{errors.codice_fiscale}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                    Sesso
                  </label>
                  <select
                    value={formData.sesso}
                    onChange={(e) => setFormData({ ...formData, sesso: e.target.value })}
                    className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Seleziona</option>
                    <option value="M">Maschio</option>
                    <option value="F">Femmina</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                    Data di Nascita
                  </label>
                  <input
                    type="date"
                    value={formData.data_nascita}
                    onChange={(e) => setFormData({ ...formData, data_nascita: e.target.value })}
                    className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                    Provincia di Nascita
                  </label>
                  <input
                    type="text"
                    value={formData.provincia_nascita}
                    onChange={(e) => setFormData({ ...formData, provincia_nascita: e.target.value.toUpperCase() })}
                    maxLength={2}
                    className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 uppercase"
                    placeholder="es. CA, TO, MI..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                    Luogo di Nascita
                  </label>
                  <input
                    type="text"
                    value={formData.citta_nascita}
                    onChange={(e) => {
                      const city = e.target.value
                      const prov = getProvinciaByCity(city)
                      setFormData({ ...formData, citta_nascita: city, ...(prov ? { provincia_nascita: prov } : {}) })
                    }}
                    className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="es. Cagliari, Torino..."
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                    Indirizzo *
                  </label>
                  <input
                    type="text"
                    value={formData.indirizzo}
                    onChange={(e) => setFormData({ ...formData, indirizzo: e.target.value })}
                    className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Via Roma"
                  />
                  {errors.indirizzo && <p className="text-red-500 text-xs mt-1">{errors.indirizzo}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                    Numero Civico
                  </label>
                  <input
                    type="text"
                    value={formData.numero_civico}
                    onChange={(e) => setFormData({ ...formData, numero_civico: e.target.value })}
                    className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="123"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                    Città di Residenza *
                  </label>
                  <input
                    type="text"
                    value={formData.citta_residenza}
                    onChange={(e) => {
                      const city = e.target.value
                      const prov = getProvinciaByCity(city)
                      setFormData({ ...formData, citta_residenza: city, ...(prov ? { provincia_residenza: prov } : {}) })
                    }}
                    className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="es. Cagliari, Torino..."
                  />
                  {errors.citta_residenza && <p className="text-red-500 text-xs mt-1">{errors.citta_residenza}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                    Provincia di Residenza
                  </label>
                  <input
                    type="text"
                    value={formData.provincia_residenza}
                    onChange={(e) => setFormData({ ...formData, provincia_residenza: e.target.value.toUpperCase() })}
                    maxLength={2}
                    className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 uppercase"
                    placeholder="es. CA, TO, MI..."
                  />
                  {errors.provincia_residenza && <p className="text-red-500 text-xs mt-1">{errors.provincia_residenza}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                    CAP *
                  </label>
                  <input
                    type="text"
                    value={formData.codice_postale}
                    onChange={(e) => setFormData({ ...formData, codice_postale: e.target.value })}
                    maxLength={5}
                    className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="20100"
                  />
                  {errors.codice_postale && <p className="text-red-500 text-xs mt-1">{errors.codice_postale}</p>}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                  PEC
                </label>
                <input
                  type="email"
                  value={formData.pec_persona}
                  onChange={(e) => setFormData({ ...formData, pec_persona: e.target.value })}
                  className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* Driving License Section */}
              <div className="pt-4 border-t border-theme-border">
                <h4 className="font-semibold text-theme-text-primary mb-3">Patente di Guida</h4>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                      Tipo Patente
                    </label>
                    <select
                      value={formData.tipo_patente}
                      onChange={(e) => setFormData({ ...formData, tipo_patente: e.target.value })}
                      className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">Seleziona</option>
                      <option value="AM">AM</option>
                      <option value="A1">A1</option>
                      <option value="A2">A2</option>
                      <option value="A">A</option>
                      <option value="B1">B1</option>
                      <option value="B">B</option>
                      <option value="BE">BE</option>
                      <option value="C1">C1</option>
                      <option value="C">C</option>
                      <option value="CE">CE</option>
                      <option value="D1">D1</option>
                      <option value="D">D</option>
                      <option value="DE">DE</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                      Numero Patente
                    </label>
                    <input
                      type="text"
                      value={formData.numero_patente}
                      onChange={(e) => setFormData({ ...formData, numero_patente: e.target.value.toUpperCase() })}
                      className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 uppercase"
                      placeholder="U1AB123456"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                    Emessa da
                  </label>
                  <input
                    type="text"
                    value={formData.emessa_da}
                    onChange={(e) => setFormData({ ...formData, emessa_da: e.target.value })}
                    className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Motorizzazione Civile di Roma"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                      Data Rilascio
                    </label>
                    <input
                      type="date"
                      value={formData.data_rilascio_patente}
                      onChange={(e) => setFormData({ ...formData, data_rilascio_patente: e.target.value })}
                      className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                      Scadenza
                    </label>
                    <input
                      type="date"
                      value={formData.scadenza_patente}
                      onChange={(e) => setFormData({ ...formData, scadenza_patente: e.target.value })}
                      className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* AZIENDA FIELDS */}
          {formData.tipo_cliente === 'azienda' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                  Denominazione (Ragione Sociale) *
                </label>
                <input
                  type="text"
                  value={formData.denominazione}
                  onChange={(e) => setFormData({ ...formData, denominazione: e.target.value })}
                  className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                {errors.denominazione && <p className="text-red-500 text-xs mt-1">{errors.denominazione}</p>}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                    Partita IVA *
                  </label>
                  <input
                    type="text"
                    value={formData.partita_iva}
                    onChange={(e) => setFormData({ ...formData, partita_iva: e.target.value })}
                    maxLength={11}
                    className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="12345678901"
                  />
                  {errors.partita_iva && <p className="text-red-500 text-xs mt-1">{errors.partita_iva}</p>}
                </div>
                <div></div>
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                  Sede Legale *
                </label>
                <input
                  type="text"
                  value={formData.sede_legale}
                  onChange={(e) => setFormData({ ...formData, sede_legale: e.target.value })}
                  className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Via Roma 123, 20100 Milano (MI)"
                />
                {errors.sede_legale && <p className="text-red-500 text-xs mt-1">{errors.sede_legale}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                  Sede Operativa (se diversa)
                </label>
                <input
                  type="text"
                  value={formData.sede_operativa}
                  onChange={(e) => setFormData({ ...formData, sede_operativa: e.target.value })}
                  className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Via Torino 456, 20100 Milano (MI)"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                    Codice Destinatario / SDI
                  </label>
                  <input
                    type="text"
                    value={formData.codice_destinatario}
                    onChange={(e) => setFormData({ ...formData, codice_destinatario: e.target.value.toUpperCase() })}
                    maxLength={7}
                    className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 uppercase"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                    PEC
                  </label>
                  <input
                    type="email"
                    value={formData.pec_azienda}
                    onChange={(e) => setFormData({ ...formData, pec_azienda: e.target.value })}
                    className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Legal Representative Section */}
              <div className="pt-4 border-t border-theme-border">
                <h4 className="font-semibold text-theme-text-primary mb-3">Rappresentante Legale</h4>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                      Nome *
                    </label>
                    <input
                      type="text"
                      value={formData.nome_rappresentante}
                      onChange={(e) => setFormData({ ...formData, nome_rappresentante: e.target.value })}
                      className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    {errors.nome_rappresentante && <p className="text-red-500 text-xs mt-1">{errors.nome_rappresentante}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                      Cognome *
                    </label>
                    <input
                      type="text"
                      value={formData.cognome_rappresentante}
                      onChange={(e) => setFormData({ ...formData, cognome_rappresentante: e.target.value })}
                      className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    {errors.cognome_rappresentante && <p className="text-red-500 text-xs mt-1">{errors.cognome_rappresentante}</p>}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                      Data di Nascita
                    </label>
                    <input
                      type="date"
                      value={formData.data_nascita_rappresentante}
                      onChange={(e) => setFormData({ ...formData, data_nascita_rappresentante: e.target.value })}
                      className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                      Codice Fiscale *
                    </label>
                    <input
                      type="text"
                      value={formData.cf_rappresentante}
                      onChange={(e) => setFormData({ ...formData, cf_rappresentante: e.target.value.toUpperCase() })}
                      maxLength={16}
                      className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 uppercase"
                      placeholder="RSSMRA80A01H501U"
                    />
                    {errors.cf_rappresentante && <p className="text-red-500 text-xs mt-1">{errors.cf_rappresentante}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                      Ruolo in Azienda
                    </label>
                    <input
                      type="text"
                      value={formData.ruolo_rappresentante}
                      onChange={(e) => setFormData({ ...formData, ruolo_rappresentante: e.target.value })}
                      className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Amministratore Unico"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                      Tipo Documento
                    </label>
                    <select
                      value={formData.tipo_documento_rappresentante}
                      onChange={(e) => setFormData({ ...formData, tipo_documento_rappresentante: e.target.value })}
                      className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">Seleziona</option>
                      <option value="CI">Carta d'Identità</option>
                      <option value="Patente">Patente</option>
                      <option value="Passaporto">Passaporto</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                      Numero Documento
                    </label>
                    <input
                      type="text"
                      value={formData.numero_documento_rappresentante}
                      onChange={(e) => setFormData({ ...formData, numero_documento_rappresentante: e.target.value.toUpperCase() })}
                      className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 uppercase"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                      Data Rilascio
                    </label>
                    <input
                      type="date"
                      value={formData.data_rilascio_documento}
                      onChange={(e) => setFormData({ ...formData, data_rilascio_documento: e.target.value })}
                      className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                      Luogo Rilascio
                    </label>
                    <input
                      type="text"
                      value={formData.luogo_rilascio_documento}
                      onChange={(e) => setFormData({ ...formData, luogo_rilascio_documento: e.target.value })}
                      className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Comune di Roma"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                  Indirizzo per DDT
                </label>
                <input
                  type="text"
                  value={formData.indirizzo_ddt}
                  onChange={(e) => setFormData({ ...formData, indirizzo_ddt: e.target.value })}
                  className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                  Contatti Cliente
                </label>
                <textarea
                  value={formData.contatti_cliente}
                  onChange={(e) => setFormData({ ...formData, contatti_cliente: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          )}

          {/* PUBBLICA AMMINISTRAZIONE FIELDS */}
          {formData.tipo_cliente === 'pubblica_amministrazione' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                  Ente o Ufficio *
                </label>
                <input
                  type="text"
                  value={formData.ente_ufficio}
                  onChange={(e) => setFormData({ ...formData, ente_ufficio: e.target.value })}
                  className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Es: Comune di Roma"
                />
                {errors.ente_ufficio && <p className="text-red-500 text-xs mt-1">{errors.ente_ufficio}</p>}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                    Codice Univoco *
                  </label>
                  <input
                    type="text"
                    value={formData.codice_univoco}
                    onChange={(e) => setFormData({ ...formData, codice_univoco: e.target.value.toUpperCase() })}
                    maxLength={7}
                    className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 uppercase"
                    placeholder="ABC1234"
                  />
                  {errors.codice_univoco && <p className="text-red-500 text-xs mt-1">{errors.codice_univoco}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                    Codice Fiscale *
                  </label>
                  <input
                    type="text"
                    value={formData.cf_pa}
                    onChange={(e) => setFormData({ ...formData, cf_pa: e.target.value.toUpperCase() })}
                    maxLength={16}
                    className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 uppercase"
                  />
                  {errors.cf_pa && <p className="text-red-500 text-xs mt-1">{errors.cf_pa}</p>}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                  Città *
                </label>
                <input
                  type="text"
                  value={formData.citta}
                  onChange={(e) => setFormData({ ...formData, citta: e.target.value })}
                  className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                {errors.citta && <p className="text-red-500 text-xs mt-1">{errors.citta}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                  Partita IVA
                </label>
                <input
                  type="text"
                  value={formData.partita_iva_pa}
                  onChange={(e) => setFormData({ ...formData, partita_iva_pa: e.target.value })}
                  maxLength={11}
                  className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                  PEC
                </label>
                <input
                  type="email"
                  value={formData.pec_pa}
                  onChange={(e) => setFormData({ ...formData, pec_pa: e.target.value })}
                  className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          )}

          {/* GLOBAL FIELDS - Always visible */}
          <div className="space-y-4 pt-4 border-t border-theme-border">
            <h3 className="font-semibold text-theme-text-primary">Informazioni di Contatto</h3>

            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                Nazione *
              </label>
              <select
                value={formData.nazione}
                onChange={(e) => setFormData({ ...formData, nazione: e.target.value })}
                className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="Italia">Italia</option>
                <option value="Francia">Francia</option>
                <option value="Germania">Germania</option>
                <option value="Spagna">Spagna</option>
                <option value="Altro">Altro</option>
              </select>
              {errors.nazione && <p className="text-red-500 text-xs mt-1">{errors.nazione}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                  Telefono *
                </label>
                <input
                  type="tel"
                  value={formData.telefono}
                  onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
                  className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="+39 320 1234567"
                />
                {errors.telefono && <p className="text-red-500 text-xs mt-1">{errors.telefono}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                  Email *
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-theme-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="cliente@example.com"
                />
                {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-theme-border bg-theme-bg-tertiary rounded-b-xl">
          <div className="flex justify-end gap-3">
            <button
              onClick={handleClose}
              className="px-6 py-2 border border-theme-border text-theme-text-secondary rounded-full hover:bg-theme-bg-tertiary transition-colors font-medium"
            >
              Annulla
            </button>
            <button
              onClick={handleSave}
              disabled={isSaveDisabled() || isSaving}
              className={`px-6 py-2 rounded-full font-medium transition-colors ${isSaveDisabled() || isSaving
                ? 'bg-theme-bg-hover text-theme-text-muted cursor-not-allowed'
                : 'bg-blue-600 text-theme-text-primary hover:bg-blue-700'
                }`}
            >
              {isSaving ? 'Salvataggio...' : 'Salva Cliente'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
