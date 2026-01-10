import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'

interface GiftCard {
  id: string
  code: string
  initial_value: number
  remaining_value: number
  currency: string
  status: 'active' | 'redeemed' | 'expired' | 'cancelled'
  issued_with_booking_id: string | null
  issued_at: string
  expires_at: string | null
  redeemed_at: string | null
  redeemed_in_booking_id: string | null
  recipient_name: string | null
  recipient_email: string | null
  created_at: string
  updated_at: string
}

interface CommercialTicket {
  id: string
  uuid: string
  ticket_number: number
  user_id: string | null
  email: string
  full_name: string
  payment_intent_id: string
  amount_paid: number
  currency: string
  purchase_date: string
  quantity: number
  created_at: string
  updated_at: string
}

type ViewMode = 'commercial' | 'gift_cards'

export default function TicketsTab() {
  const [giftCards, setGiftCards] = useState<GiftCard[]>([])
  const [commercialTickets, setCommercialTickets] = useState<CommercialTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('commercial')

  useEffect(() => {
    loadData()
  }, [viewMode])

  async function loadData() {
    setLoading(true)
    try {
      if (viewMode === 'commercial') {
        await loadCommercialTickets()
      } else {
        await loadGiftCards()
      }
    } finally {
      setLoading(false)
    }
  }

  async function loadCommercialTickets() {
    try {
      const { data, error } = await supabase
        .from('commercial_operation_tickets')
        .select('*')
        .order('purchase_date', { ascending: false })

      if (error) throw error
      setCommercialTickets(data || [])
    } catch (error) {
      console.error('Failed to load commercial tickets:', error)
    }
  }

  async function loadGiftCards() {
    try {
      const { data, error } = await supabase
        .from('gift_cards')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      setGiftCards(data || [])
    } catch (error) {
      console.error('Failed to load gift cards:', error)
    }
  }

  function formatPrice(value: number, currency: string = 'EUR'): string {
    return `${currency} ${value.toFixed(2)}`
  }

  function formatPriceCents(cents: number, currency: string = 'eur'): string {
    const value = cents / 100
    return new Intl.NumberFormat('it-IT', {
      style: 'currency',
      currency: currency.toUpperCase()
    }).format(value)
  }

  function getStatusLabel(status: string): string {
    switch (status) {
      case 'active': return 'Attivo'
      case 'redeemed': return 'Riscattato'
      case 'expired': return 'Scaduto'
      case 'cancelled': return 'Annullato'
      default: return status
    }
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'active': return 'bg-green-900 text-green-200'
      case 'redeemed': return 'bg-blue-900 text-blue-200'
      case 'expired': return 'bg-gray-700 text-theme-text-secondary'
      case 'cancelled': return 'bg-red-900 text-red-200'
      default: return 'bg-gray-700 text-gray-200'
    }
  }

  // Commercial tickets stats
  const totalCommercialRevenue = commercialTickets.reduce((sum, ticket) => sum + ticket.amount_paid, 0)
  const totalCommercialTickets = commercialTickets.reduce((sum, ticket) => sum + ticket.quantity, 0)
  const uniquePurchases = commercialTickets.length

  // Gift cards stats
  const filteredCards = filterStatus === 'all'
    ? giftCards
    : giftCards.filter(c => c.status === filterStatus)
  const totalValue = filteredCards.reduce((sum, card) => sum + card.initial_value, 0)
  const totalRedeemed = filteredCards.filter(c => c.status === 'redeemed').length
  const totalActive = filteredCards.filter(c => c.status === 'active').length

  if (loading) {
    return <div className="text-center py-8 text-theme-text-muted">Caricamento...</div>
  }

  return (
    <div>
      {/* View Mode Toggle */}
      <div className="mb-6 flex gap-2">
        <button
          onClick={() => setViewMode('commercial')}
          className={`px-4 py-2 rounded-full font-medium transition-colors ${viewMode === 'commercial'
            ? 'bg-white text-black'
            : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
            }`}
        >
          Biglietti Operazione Commerciale
        </button>
        <button
          onClick={() => setViewMode('gift_cards')}
          className={`px-4 py-2 rounded-full font-medium transition-colors ${viewMode === 'gift_cards'
            ? 'bg-white text-black'
            : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
            }`}
        >
          Buoni Regalo Promozionali
        </button>
      </div>

      {viewMode === 'commercial' && (
        <div>
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-2xl font-bold text-theme-text-primary">Biglietti Operazione Commerciale</h2>
              <p className="text-sm text-theme-text-muted mt-1">
                Biglietti venduti per l'operazione "7 MILIONI DI EURO"
              </p>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-theme-bg-secondary p-4 rounded-lg border border-theme-border">
              <div className="text-sm text-theme-text-muted">Totale Biglietti Venduti</div>
              <div className="text-2xl font-bold text-theme-text-primary">{totalCommercialTickets}</div>
            </div>
            <div className="bg-theme-bg-secondary p-4 rounded-lg border border-theme-border">
              <div className="text-sm text-theme-text-muted">Ricavo Totale</div>
              <div className="text-2xl font-bold text-theme-text-primary">{formatPriceCents(totalCommercialRevenue)}</div>
            </div>
            <div className="bg-theme-bg-secondary p-4 rounded-lg border border-theme-border">
              <div className="text-sm text-theme-text-muted">Acquisti Unici</div>
              <div className="text-2xl font-bold text-green-400">{uniquePurchases}</div>
            </div>
          </div>

          {/* Commercial Tickets Table */}
          <div className="bg-theme-bg-secondary rounded-lg border border-theme-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-theme-bg-primary">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Numero Biglietto</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Nome</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Email</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Importo Pagato</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Data Acquisto</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Quantità</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">UUID</th>
                  </tr>
                </thead>
                <tbody>
                  {commercialTickets.map((ticket) => (
                    <tr key={ticket.id} className="border-t border-theme-border hover:bg-theme-bg-tertiary">
                      <td className="px-4 py-3 text-sm font-mono text-theme-text-primary font-bold">
                        #{ticket.ticket_number.toString().padStart(6, '0')}
                      </td>
                      <td className="px-4 py-3 text-sm text-theme-text-primary">{ticket.full_name}</td>
                      <td className="px-4 py-3 text-sm text-theme-text-muted">{ticket.email}</td>
                      <td className="px-4 py-3 text-sm text-theme-text-primary font-semibold">
                        {formatPriceCents(ticket.amount_paid, ticket.currency)}
                      </td>
                      <td className="px-4 py-3 text-sm text-theme-text-muted">
                        {new Date(ticket.purchase_date).toLocaleString('it-IT', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </td>
                      <td className="px-4 py-3 text-sm text-theme-text-primary">{ticket.quantity}</td>
                      <td className="px-4 py-3 text-xs font-mono text-gray-500">
                        {ticket.uuid.substring(0, 8)}...
                      </td>
                    </tr>
                  ))}
                  {commercialTickets.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                        Nessun biglietto venduto ancora
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {commercialTickets.length === 0 && (
            <div className="mt-6 p-6 bg-blue-900/20 border border-blue-700/50 rounded-lg">
              <h3 className="text-lg font-semibold text-theme-text-primary mb-2">
                📝 Operazione Commerciale "7 MILIONI DI EURO"
              </h3>
              <ul className="text-sm text-theme-text-secondary space-y-1 list-disc list-inside">
                <li>I biglietti vengono salvati automaticamente dopo ogni acquisto</li>
                <li>Ogni biglietto ha un numero univoco da 1 a 350,000</li>
                <li>L'estrazione si terrà il 24 Gennaio 2026</li>
                <li>I biglietti appariranno qui dopo il primo acquisto</li>
              </ul>
            </div>
          )}
        </div>
      )}

      {viewMode === 'gift_cards' && (
        <div>
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-2xl font-bold text-theme-text-primary">Buoni Regalo Promozionali</h2>
              <p className="text-sm text-theme-text-muted mt-1">
                Buoni da €25 con validità 24 mesi (non cumulabili)
              </p>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-theme-bg-secondary p-4 rounded-lg border border-theme-border">
              <div className="text-sm text-theme-text-muted">Totale Buoni</div>
              <div className="text-2xl font-bold text-theme-text-primary">{filteredCards.length}</div>
            </div>
            <div className="bg-theme-bg-secondary p-4 rounded-lg border border-theme-border">
              <div className="text-sm text-theme-text-muted">Valore Totale</div>
              <div className="text-2xl font-bold text-theme-text-primary">{formatPrice(totalValue)}</div>
            </div>
            <div className="bg-theme-bg-secondary p-4 rounded-lg border border-theme-border">
              <div className="text-sm text-theme-text-muted">Attivi</div>
              <div className="text-2xl font-bold text-green-400">{totalActive}</div>
            </div>
            <div className="bg-theme-bg-secondary p-4 rounded-lg border border-theme-border">
              <div className="text-sm text-theme-text-muted">Riscattati</div>
              <div className="text-2xl font-bold text-blue-400">{totalRedeemed}</div>
            </div>
          </div>

          {/* Filters */}
          <div className="mb-6 flex gap-4 items-center">
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="bg-theme-bg-secondary border border-theme-border text-theme-text-primary rounded px-3 py-2 text-sm"
            >
              <option value="all">Tutti gli stati</option>
              <option value="active">Attivi</option>
              <option value="redeemed">Riscattati</option>
              <option value="expired">Scaduti</option>
              <option value="cancelled">Annullati</option>
            </select>
          </div>

          {/* Gift Cards Table */}
          <div className="bg-theme-bg-secondary rounded-lg border border-theme-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-theme-bg-primary">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Codice</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Destinatario</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Email</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Valore</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Rimanente</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Stato</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Emesso</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Scadenza</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCards.map((card) => (
                    <tr key={card.id} className="border-t border-theme-border hover:bg-theme-bg-tertiary">
                      <td className="px-4 py-3 text-sm font-mono text-theme-text-primary">{card.code}</td>
                      <td className="px-4 py-3 text-sm text-theme-text-primary">{card.recipient_name || '-'}</td>
                      <td className="px-4 py-3 text-sm text-theme-text-muted">{card.recipient_email || '-'}</td>
                      <td className="px-4 py-3 text-sm text-theme-text-primary">{formatPrice(card.initial_value, card.currency)}</td>
                      <td className="px-4 py-3 text-sm text-theme-text-primary">{formatPrice(card.remaining_value, card.currency)}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(card.status)}`}>
                          {getStatusLabel(card.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-theme-text-muted">
                        {new Date(card.issued_at).toLocaleDateString('it-IT')}
                      </td>
                      <td className="px-4 py-3 text-sm text-theme-text-muted">
                        {card.expires_at ? new Date(card.expires_at).toLocaleDateString('it-IT') : 'N/A'}
                      </td>
                    </tr>
                  ))}
                  {filteredCards.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                        {giftCards.length === 0
                          ? 'Nessun buono regalo emesso ancora'
                          : 'Nessun buono trovato con i filtri selezionati'
                        }
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {giftCards.length === 0 && (
            <div className="mt-6 p-6 bg-blue-900/20 border border-blue-700/50 rounded-lg">
              <h3 className="text-lg font-semibold text-theme-text-primary mb-2">
                📝 Come funzionano i Buoni Promozionali
              </h3>
              <ul className="text-sm text-theme-text-secondary space-y-1 list-disc list-inside">
                <li>Valore: €25 per buono</li>
                <li>Validità: 24 mesi dalla data di emissione</li>
                <li>Non cumulabili tra loro</li>
                <li>Emessi automaticamente con acquisti operazione commerciale</li>
                <li>I buoni appariranno qui dopo la prima emissione</li>
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
