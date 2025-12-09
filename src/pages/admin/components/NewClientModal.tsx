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
  rappresentante_doc_luogo: string

  // Pubblica Amministrazione
  codice_univoco: string
  cf_pa: string
  ente_ufficio: string
  citta: string
  partita_iva_pa: string
  pec_pa: string
}

export default function NewClientModal({ isOpen, onClose, onClientCreated, initialData }: NewClientModalProps) {
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
    rappresentante_doc_luogo: '',
    codice_univoco: '',
    cf_pa: '',
    ente_ufficio: '',
    citta: '',
    partita_iva_pa: '',
    pec_pa: ''
  })

  // Populate form data when initialData changes
  useEffect(() => {
    if (initialData && isOpen) {
      console.log('Populating modal with data:', initialData)

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
        rappresentante_doc_luogo: metadata.rappresentante?.documento?.luogo || '',

        // PA
        codice_univoco: initialData.codice_univoco || '',
        cf_pa: initialData.codice_fiscale_pa || initialData.codice_fiscale || '',
        ente_ufficio: initialData.ente_ufficio || initialData.denominazione || '',
        citta: initialData.citta || '',
        partita_iva_pa: initialData.partita_iva || '',
        pec_pa: initialData.pec || ''
      })
    } else if (isOpen && !initialData) {
      // Reset if opening empty
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
        rappresentante_doc_luogo: '',
        codice_univoco: '',
        cf_pa: '',
        ente_ufficio: '',
        citta: '',
        partita_iva_pa: '',
        pec_pa: ''
      })
    }
  }, [initialData, isOpen])

  // Start with empty errors
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSaving, setIsSaving] = useState(false)

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
        if (formData.codice_postale) customerData.codice_postale = formData.codice_postale
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

      if (initialData?.id) {
        // UPDATE Existing
        console.log('Updating existing customer:', initialData.id)

        // 1. Update customers_extended (Upsert is safer as it might not exist there yet)
        const { data: updatedExtended, error: extendedError } = await supabase
          .from('customers_extended')
          .upsert({ ...customerData, id: initialData.id })
          .select()
          .single()

        if (extendedError) throw extendedError
        resultData = updatedExtended

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

        const { error: basicError } = await supabase
          .from('customers')
          .update(basicData)
          .eq('id', initialData.id)

        if (basicError) console.warn('Could not update basic customers table:', basicError)

        alert('Cliente aggiornato con successo!')

      } else {
        // CREATE New
        const { data: newClient, error } = await supabase
          .from('customers_extended')
          .insert([customerData])
          .select()
          .single()

        if (error) throw error
        resultData = newClient

        alert('Cliente creato con successo!')
      }

      if (onClientCreated && resultData) {
        onClientCreated(resultData.id)
      }
      handleClose()

    } catch (error: any) {
      console.error('Error saving customer:', error)
      alert('Errore salvataggio cliente: ' + (error.message || 'Errore sconosciuto'))
    } finally {
      setIsSaving(false)
    }
  }

  const handleClose = () => {
    // Reset essential fields or all
    setErrors({})
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-gray-900 border-b border-gray-700 p-6 flex justify-between items-center z-10">
          <h2 className="text-2xl font-bold text-white">{initialData ? 'Modifica Cliente' : 'Nuovo Cliente'}</h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-white text-3xl leading-none">&times;</button>
        </div>

        <div className="p-6 space-y-8">

          {/* 1. TIPO CLIENTE SELECTION */}
          <div>
            <label className="block text-sm font-bold text-gray-300 mb-3 uppercase tracking-wider">
              1. Tipo Cliente
            </label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div
                onClick={() => setFormData({ ...formData, tipo_cliente: 'persona_fisica' })}
                className={`cursor-pointer border rounded-lg p-4 flex flex-col items-center justify-center gap-2 transition-all ${formData.tipo_cliente === 'persona_fisica'
                  ? 'bg-blue-600/20 border-blue-500 text-blue-400 ring-1 ring-blue-500'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-750'
                  }`}
              >
                <span className="font-semibold">Persona Fisica</span>
              </div>

              <div
                onClick={() => setFormData({ ...formData, tipo_cliente: 'azienda' })}
                className={`cursor-pointer border rounded-lg p-4 flex flex-col items-center justify-center gap-2 transition-all ${formData.tipo_cliente === 'azienda'
                  ? 'bg-purple-600/20 border-purple-500 text-purple-400 ring-1 ring-purple-500'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-750'
                  }`}
              >
                <span className="font-semibold">Azienda</span>
              </div>

              <div
                onClick={() => setFormData({ ...formData, tipo_cliente: 'pubblica_amministrazione' })}
                className={`cursor-pointer border rounded-lg p-4 flex flex-col items-center justify-center gap-2 transition-all ${formData.tipo_cliente === 'pubblica_amministrazione'
                  ? 'bg-green-600/20 border-green-500 text-green-400 ring-1 ring-green-500'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-750'
                  }`}
              >
                <span className="font-semibold">Pubblica Amm.</span>
              </div>
            </div>
          </div>

          <hr className="border-gray-800" />

          {/* 2. FORM FIELDS BASED ON TYPE */}
          <div className="space-y-6">

            {/* --- PERSONA FISICA --- */}
            {formData.tipo_cliente === 'persona_fisica' && (
              <div className="animate-fadeIn space-y-6">
                <div>
                  <h3 className="text-lg font-medium text-white mb-4">Dati Anagrafici</h3>

                  {/* Nome & Cognome First */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Nome *</label>
                      <input
                        type="text"
                        value={formData.nome}
                        onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none"
                        placeholder="Mario"
                      />
                      {errors.nome && <p className="text-red-500 text-xs mt-1">{errors.nome}</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Cognome *</label>
                      <input
                        type="text"
                        value={formData.cognome}
                        onChange={(e) => setFormData({ ...formData, cognome: e.target.value })}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none"
                        placeholder="Rossi"
                      />
                      {errors.cognome && <p className="text-red-500 text-xs mt-1">{errors.cognome}</p>}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Codice Fiscale {formData.nazione === 'Italia' ? '*' : ''}</label>
                      <input
                        type="text"
                        value={formData.codice_fiscale}
                        onChange={(e) => setFormData({ ...formData, codice_fiscale: e.target.value.toUpperCase() })}
                        maxLength={16}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold focus:ring-1 focus:ring-dr7-gold outline-none uppercase font-mono"
                      />
                      {errors.codice_fiscale && <p className="text-red-500 text-xs mt-1">{errors.codice_fiscale}</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Sesso</label>
                      <select
                        value={formData.sesso}
                        onChange={(e) => setFormData({ ...formData, sesso: e.target.value as any })}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold outline-none"
                      >
                        <option value="">Seleziona...</option>
                        <option value="M">Maschio</option>
                        <option value="F">Femmina</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Data Nascita</label>
                      <input
                        type="date"
                        value={formData.data_nascita}
                        onChange={(e) => setFormData({ ...formData, data_nascita: e.target.value })}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Luogo Nascita</label>
                      <input
                        type="text"
                        value={formData.luogo_nascita}
                        onChange={(e) => setFormData({ ...formData, luogo_nascita: e.target.value })}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Provincia</label>
                      <input
                        type="text"
                        value={formData.provincia_nascita}
                        onChange={(e) => setFormData({ ...formData, provincia_nascita: e.target.value.toUpperCase() })}
                        maxLength={2}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold outline-none uppercase"
                        placeholder="RM"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-medium text-white mb-4 border-t border-gray-700 pt-4">Residenza</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-400 mb-1">Indirizzo *</label>
                      <input
                        type="text"
                        value={formData.indirizzo}
                        onChange={(e) => setFormData({ ...formData, indirizzo: e.target.value })}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold outline-none"
                      />
                      {errors.indirizzo && <p className="text-red-500 text-xs mt-1">{errors.indirizzo}</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Civico</label>
                      <input
                        type="text"
                        value={formData.numero_civico}
                        onChange={(e) => setFormData({ ...formData, numero_civico: e.target.value })}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold outline-none"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Città *</label>
                      <input
                        type="text"
                        value={formData.citta_residenza}
                        onChange={(e) => setFormData({ ...formData, citta_residenza: e.target.value })}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">CAP *</label>
                      <input
                        type="text"
                        value={formData.codice_postale}
                        onChange={(e) => setFormData({ ...formData, codice_postale: e.target.value })}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Provincia *</label>
                      <input
                        type="text"
                        value={formData.provincia_residenza}
                        onChange={(e) => setFormData({ ...formData, provincia_residenza: e.target.value.toUpperCase() })}
                        maxLength={2}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold outline-none uppercase"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-medium text-white mb-4 border-t border-gray-700 pt-4">Contatti</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Email *</label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold outline-none"
                      />
                      {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Telefono *</label>
                      <input
                        type="text"
                        value={formData.telefono}
                        onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold outline-none"
                      />
                      {errors.telefono && <p className="text-red-500 text-xs mt-1">{errors.telefono}</p>}
                    </div>
                  </div>
                  <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-400 mb-1">PEC (Opzionale)</label>
                    <input
                      type="email"
                      value={formData.pec_persona}
                      onChange={(e) => setFormData({ ...formData, pec_persona: e.target.value })}
                      className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold outline-none"
                    />
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-medium text-white mb-4 border-t border-gray-700 pt-4">Patente</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Numero Patente</label>
                      <input
                        type="text"
                        value={formData.patente_numero}
                        onChange={(e) => setFormData({ ...formData, patente_numero: e.target.value.toUpperCase() })}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold outline-none uppercase"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Categoria</label>
                      <select
                        value={formData.patente_tipo}
                        onChange={(e) => setFormData({ ...formData, patente_tipo: e.target.value })}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold outline-none"
                      >
                        <option value="">Seleziona...</option>
                        <option value="B">B</option>
                        <option value="A">A</option>
                        <option value="C">C</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* --- AZIENDA --- */}
            {formData.tipo_cliente === 'azienda' && (
              <div className="animate-fadeIn space-y-6">
                <div>
                  <h3 className="text-lg font-medium text-white mb-4">Dati Aziendali</h3>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">Ragione Sociale *</label>
                    <input
                      type="text"
                      value={formData.denominazione}
                      onChange={(e) => setFormData({ ...formData, denominazione: e.target.value })}
                      className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold outline-none"
                    />
                    {errors.denominazione && <p className="text-red-500 text-xs mt-1">{errors.denominazione}</p>}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Partita IVA *</label>
                      <input
                        type="text"
                        value={formData.partita_iva}
                        onChange={(e) => setFormData({ ...formData, partita_iva: e.target.value })}
                        maxLength={11}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold outline-none font-mono"
                      />
                      {errors.partita_iva && <p className="text-red-500 text-xs mt-1">{errors.partita_iva}</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Codice Fiscale</label>
                      <input
                        type="text"
                        value={formData.cf_azienda}
                        onChange={(e) => setFormData({ ...formData, cf_azienda: e.target.value.toUpperCase() })}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold outline-none font-mono uppercase"
                      />
                    </div>
                  </div>

                  <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-400 mb-1">Sede Legale *</label>
                    <input
                      type="text"
                      value={formData.sede_legale}
                      onChange={(e) => setFormData({ ...formData, sede_legale: e.target.value })}
                      className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold outline-none"
                    />
                    {errors.sede_legale && <p className="text-red-500 text-xs mt-1">{errors.sede_legale}</p>}
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-medium text-white mb-4 border-t border-gray-700 pt-4">Contatti Azienda</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Email *</label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Telefono *</label>
                      <input
                        type="text"
                        value={formData.telefono}
                        onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-medium text-white mb-4 border-t border-gray-700 pt-4">Rappresentante Legale</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Nome *</label>
                      <input
                        type="text"
                        value={formData.rappresentante_nome}
                        onChange={(e) => setFormData({ ...formData, rappresentante_nome: e.target.value })}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Cognome *</label>
                      <input
                        type="text"
                        value={formData.rappresentante_cognome}
                        onChange={(e) => setFormData({ ...formData, rappresentante_cognome: e.target.value })}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold outline-none"
                      />
                    </div>
                  </div>
                  <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-400 mb-1">Codice Fiscale Rappresentante *</label>
                    <input
                      type="text"
                      value={formData.rappresentante_cf}
                      onChange={(e) => setFormData({ ...formData, rappresentante_cf: e.target.value.toUpperCase() })}
                      className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold outline-none uppercase font-mono"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* --- PUBBLICA AMMINISTRAZIONE --- */}
            {formData.tipo_cliente === 'pubblica_amministrazione' && (
              <div className="animate-fadeIn space-y-6">
                <div>
                  <h3 className="text-lg font-medium text-white mb-4">Dati PA</h3>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">Ente / Ufficio *</label>
                    <input
                      type="text"
                      value={formData.ente_ufficio}
                      onChange={(e) => setFormData({ ...formData, ente_ufficio: e.target.value })}
                      className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold outline-none"
                    />
                    {errors.ente_ufficio && <p className="text-red-500 text-xs mt-1">{errors.ente_ufficio}</p>}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Codice Univoco *</label>
                      <input
                        type="text"
                        value={formData.codice_univoco}
                        onChange={(e) => setFormData({ ...formData, codice_univoco: e.target.value.toUpperCase() })}
                        maxLength={7}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold outline-none uppercase font-mono"
                      />
                      {errors.codice_univoco && <p className="text-red-500 text-xs mt-1">{errors.codice_univoco}</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">CF / P.IVA Ente *</label>
                      <input
                        type="text"
                        value={formData.cf_pa}
                        onChange={(e) => setFormData({ ...formData, cf_pa: e.target.value.toUpperCase() })}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold outline-none uppercase font-mono"
                      />
                      {errors.cf_pa && <p className="text-red-500 text-xs mt-1">{errors.cf_pa}</p>}
                    </div>
                  </div>
                  <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-400 mb-1">Città *</label>
                    <input
                      type="text"
                      value={formData.citta}
                      onChange={(e) => setFormData({ ...formData, citta: e.target.value })}
                      className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold outline-none"
                    />
                    {errors.citta && <p className="text-red-500 text-xs mt-1">{errors.citta}</p>}
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-medium text-white mb-4 border-t border-gray-700 pt-4">Contatti PA</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Email / PEC *</label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Telefono *</label>
                      <input
                        type="text"
                        value={formData.telefono}
                        onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2.5 text-white focus:border-dr7-gold outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>

          {/* FOOTER ACTIONS */}
          <div className="flex justify-end gap-3 pt-6 border-t border-gray-800">
            <button
              onClick={handleClose}
              disabled={isSaving}
              className="px-6 py-2.5 rounded-lg text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
            >
              Annulla
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-8 py-2.5 rounded-lg bg-dr7-gold text-black font-bold hover:bg-yellow-500 transition-colors shadow-lg disabled:opacity-50"
            >
              {isSaving ? 'Salvataggio...' : (initialData ? 'Aggiorna Cliente' : 'Crea Cliente')}
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}
