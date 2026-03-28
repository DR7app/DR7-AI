import { useState } from 'react'
import { supabase } from '../../../supabaseClient'
import Input from './Input'
import Button from './Button'
import toast from 'react-hot-toast'

interface DynamicCustomerFormProps {
  onSuccess: () => void
  onCancel: () => void
}

export default function DynamicCustomerForm({ onSuccess, onCancel }: DynamicCustomerFormProps) {
  const [tipoCliente, setTipoCliente] = useState<'azienda' | 'persona_fisica' | 'pubblica_amministrazione' | ''>('')
  const [loading, setLoading] = useState(false)

  // Form data state
  const [formData, setFormData] = useState({
    // Common
    nazione: 'Italia',
    codiceFiscale: '',
    indirizzo: '',
    // Azienda
    denominazione: '',
    partitaIVA: '',
    // Persona Fisica
    nome: '',
    cognome: '',
    telefono: '',
    email: '',
    pec: '',
    // Pubblica Amministrazione
    codiceUnivoco: '',
    enteUfficio: '',
    citta: ''
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }))
  }

  // Search functions
  const handleSearch = async (type: string, value: string) => {
    if (!value.trim()) {
      toast.error('Inserisci un valore per la ricerca')
      return
    }

    try {
      const { data, error } = await supabase
        .rpc('search_customers_extended', {
          search_term: value,
          search_type: type
        })

      if (error) throw error

      if (data && data.length > 0) {
        // Auto-fill with first result
        const result = data[0]
        toast.success(`Trovato: ${result.display_name} - Codice Fiscale: ${result.codice_fiscale || 'N/A'}`)
        // You can auto-fill form here if needed
      } else {
        toast.error('Nessun risultato trovato')
      }
    } catch (error: unknown) {
      console.error('Search error:', error)
      toast.error('Errore durante la ricerca')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      // Prepare data based on client type
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const customerData: any = {
        tipo_cliente: tipoCliente,
        nazione: formData.nazione,
        codice_fiscale: formData.codiceFiscale,
        indirizzo: formData.indirizzo,
        source: 'admin'
      }

      // Add type-specific fields
      if (tipoCliente === 'azienda') {
        customerData.denominazione = formData.denominazione
        customerData.partita_iva = formData.partitaIVA
      } else if (tipoCliente === 'persona_fisica') {
        customerData.nome = formData.nome
        customerData.cognome = formData.cognome
        customerData.telefono = formData.telefono
        customerData.email = formData.email
        customerData.pec = formData.pec
      } else if (tipoCliente === 'pubblica_amministrazione') {
        customerData.codice_univoco = formData.codiceUnivoco
        customerData.ente_ufficio = formData.enteUfficio
        customerData.citta = formData.citta
      }

      const { error } = await supabase
        .from('customers_extended')
        .insert([customerData])

      if (error) throw error

      toast.success('Cliente creato con successo!')
      onSuccess()
    } catch (error: unknown) {
      const _errMsg = error instanceof Error ? error.message : String(error)
      console.error('Error creating customer:', error)
      toast.error(`Errore: ${_errMsg}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-theme-bg-secondary p-6 rounded-full border border-theme-border mb-6">
      <h3 className="text-xl font-semibold text-theme-text-primary mb-4">Crea Nuovo Cliente</h3>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Client Type Selection */}
        <div>
          <label className="block text-sm font-medium text-theme-text-secondary mb-2">
            Tipo Cliente <span className="text-red-500">*</span>
          </label>
          <select
            value={tipoCliente}
            onChange={(e) => setTipoCliente(e.target.value as typeof tipoCliente)}
            className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary focus:outline-none focus:border-dr7-gold"
            required
          >
            <option value="">Seleziona tipo cliente...</option>
            <option value="azienda">Azienda</option>
            <option value="persona_fisica">Persona Fisica</option>
            <option value="pubblica_amministrazione">Pubblica Amministrazione</option>
          </select>
        </div>

        {/* AZIENDA FIELDS */}
        {tipoCliente === 'azienda' && (
          <div className="space-y-4 animate-fadeIn">
            <div className="border-t border-theme-border pt-4"></div>

            <Input
              label="Nazione"
              required
              value={formData.nazione}
              onChange={handleChange}
              name="nazione"
            />

            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                Denominazione <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  name="denominazione"
                  value={formData.denominazione}
                  onChange={handleChange}
                  className="flex-1 px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary focus:outline-none focus:border-dr7-gold"
                  placeholder="Nome azienda"
                  required
                />
                <button
                  type="button"
                  onClick={() => handleSearch('denominazione', formData.denominazione)}
                  className="px-4 py-2 bg-dr7-gold text-white rounded-full hover:bg-[#247a6f] transition-colors whitespace-nowrap"
                >
                  🔍 Cerca
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                Partita IVA <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  name="partitaIVA"
                  value={formData.partitaIVA}
                  onChange={handleChange}
                  className="flex-1 px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary focus:outline-none focus:border-dr7-gold"
                  placeholder="IT12345678901"
                  required
                />
                <button
                  type="button"
                  onClick={() => handleSearch('partita_iva', formData.partitaIVA)}
                  className="px-4 py-2 bg-dr7-gold text-white rounded-full hover:bg-[#247a6f] transition-colors whitespace-nowrap"
                >
                  🔍 Cerca
                </button>
              </div>
            </div>

            <Input
              label="Codice Fiscale"
              required
              value={formData.codiceFiscale}
              onChange={handleChange}
              name="codiceFiscale"
              placeholder="00000000000"
            />

            <Input
              label="Indirizzo"
              required
              value={formData.indirizzo}
              onChange={handleChange}
              name="indirizzo"
              placeholder="Via, Numero Civico, CAP, Città"
            />

            <div className="bg-theme-bg-tertiary p-4 rounded border border-theme-border">
              <h4 className="text-sm font-semibold text-dr7-gold mb-2">Campi Facoltativi</h4>
              <p className="text-xs text-theme-text-muted">Sezione riservata per campi aggiuntivi futuri</p>
            </div>
          </div>
        )}

        {/* PERSONA FISICA FIELDS */}
        {tipoCliente === 'persona_fisica' && (
          <div className="space-y-4 animate-fadeIn">
            <div className="border-t border-theme-border pt-4"></div>

            <Input
              label="Nazione"
              required
              value={formData.nazione}
              onChange={handleChange}
              name="nazione"
            />

            <Input
              label="Nome"
              required
              value={formData.nome}
              onChange={handleChange}
              name="nome"
              placeholder="Mario"
            />

            <Input
              label="Cognome"
              required
              value={formData.cognome}
              onChange={handleChange}
              name="cognome"
              placeholder="Rossi"
            />

            <Input
              label="Codice Fiscale"
              required
              value={formData.codiceFiscale}
              onChange={handleChange}
              name="codiceFiscale"
              placeholder="RSSMRA80A01H501U"
            />

            <Input
              label="Indirizzo"
              required
              value={formData.indirizzo}
              onChange={handleChange}
              name="indirizzo"
              placeholder="Via, Numero Civico, CAP, Città"
            />

            <div className="bg-theme-bg-tertiary p-4 rounded border border-theme-border space-y-4">
              <h4 className="text-sm font-semibold text-dr7-gold mb-2">Campi Facoltativi</h4>

              <Input
                label="Telefono"
                value={formData.telefono}
                onChange={handleChange}
                name="telefono"
                type="tel"
                placeholder="+39 123 456 7890"
              />

              <Input
                label="Email"
                value={formData.email}
                onChange={handleChange}
                name="email"
                type="email"
                placeholder="email@esempio.it"
              />

              <Input
                label="PEC"
                value={formData.pec}
                onChange={handleChange}
                name="pec"
                type="email"
                placeholder="pec@pec.it"
              />
            </div>
          </div>
        )}

        {/* PUBBLICA AMMINISTRAZIONE FIELDS */}
        {tipoCliente === 'pubblica_amministrazione' && (
          <div className="space-y-4 animate-fadeIn">
            <div className="border-t border-theme-border pt-4"></div>

            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                Codice Univoco <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  name="codiceUnivoco"
                  value={formData.codiceUnivoco}
                  onChange={handleChange}
                  className="flex-1 px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary focus:outline-none focus:border-dr7-gold"
                  placeholder="XXXXXX"
                  required
                />
                <button
                  type="button"
                  onClick={() => handleSearch('codice_univoco', formData.codiceUnivoco)}
                  className="px-4 py-2 bg-dr7-gold text-white rounded-full hover:bg-[#247a6f] transition-colors whitespace-nowrap"
                >
                  🔍 Cerca
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                Codice Fiscale <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  name="codiceFiscale"
                  value={formData.codiceFiscale}
                  onChange={handleChange}
                  className="flex-1 px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary focus:outline-none focus:border-dr7-gold"
                  placeholder="00000000000"
                  required
                />
                <button
                  type="button"
                  onClick={() => handleSearch('codice_fiscale', formData.codiceFiscale)}
                  className="px-4 py-2 bg-dr7-gold text-white rounded-full hover:bg-[#247a6f] transition-colors whitespace-nowrap"
                >
                  🔍 Cerca
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                Ente o Ufficio <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  name="enteUfficio"
                  value={formData.enteUfficio}
                  onChange={handleChange}
                  className="flex-1 px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary focus:outline-none focus:border-dr7-gold"
                  placeholder="Nome dell'ente o ufficio"
                  required
                />
                <button
                  type="button"
                  onClick={() => handleSearch('ente_ufficio', formData.enteUfficio)}
                  className="px-4 py-2 bg-dr7-gold text-white rounded-full hover:bg-[#247a6f] transition-colors whitespace-nowrap"
                >
                  🔍 Cerca
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                Città <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  name="citta"
                  value={formData.citta}
                  onChange={handleChange}
                  className="flex-1 px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary focus:outline-none focus:border-dr7-gold"
                  placeholder="Cagliari"
                  required
                />
                <button
                  type="button"
                  onClick={() => handleSearch('citta', formData.citta)}
                  className="px-4 py-2 bg-dr7-gold text-white rounded-full hover:bg-[#247a6f] transition-colors whitespace-nowrap"
                >
                  🔍 Cerca
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Submit Buttons */}
        {tipoCliente && (
          <div className="flex gap-3 mt-6 pt-4 border-t border-theme-border">
            <Button type="submit" disabled={loading}>
              {loading ? 'Creazione in corso...' : 'Crea Cliente'}
            </Button>
            <Button type="button" variant="secondary" onClick={onCancel}>
              Annulla
            </Button>
          </div>
        )}
      </form>

      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .animate-fadeIn {
          animation: fadeIn 0.3s ease-in-out;
        }
      `}</style>
    </div>
  )
}
