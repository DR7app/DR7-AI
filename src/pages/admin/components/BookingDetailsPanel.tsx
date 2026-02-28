import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { formatRomeDate } from '../../../utils/timezoneUtils'
import { formatEUR, centsToEuros } from '../../../utils/moneyUtils'

interface BookingDetailsPanelProps {
  booking: any
  onClose: () => void
  onEdit?: (bookingId: string) => void
}

export default function BookingDetailsPanel({ booking, onClose, onEdit }: BookingDetailsPanelProps) {
  const [generatingLink, setGeneratingLink] = useState(false)
  const [paymentLink, setPaymentLink] = useState<string | null>(booking.payment_link || null)
  const [linkCopied, setLinkCopied] = useState(false)
  const [resolvedCustomer, setResolvedCustomer] = useState<{ name?: string; phone?: string; email?: string } | null>(null)

  // Fetch customer data from customers_extended when booking is missing info
  useEffect(() => {
    const custId = booking.user_id || booking.booking_details?.customer?.customerId || booking.booking_details?.customer_id
    const needsName = !booking.customer_name || booking.customer_name === 'Cliente Sconosciuto'
    const needsPhone = !booking.customer_phone
    const needsEmail = !booking.customer_email

    if (custId && (needsName || needsPhone || needsEmail)) {
      supabase
        .from('customers_extended')
        .select('nome, cognome, telefono, email, denominazione, tipo_cliente')
        .eq('id', custId)
        .single()
        .then(({ data }) => {
          if (data) {
            const fullName = data.tipo_cliente === 'azienda'
              ? data.denominazione
              : `${data.nome || ''} ${data.cognome || ''}`.trim()
            setResolvedCustomer({
              name: fullName || undefined,
              phone: data.telefono || undefined,
              email: data.email || undefined
            })
          }
        })
    }
  }, [booking.id])
  // MONETARY UNIT CONTRACT: All price fields are stored in CENTS (integer)
  // Example: price_total = 60000 means €600.00

  // Raw values (in cents)
  const totalCents = booking.price_total || 0
  // If payment_status indicates paid but amount_paid is missing, treat total as paid
  const bookingPaidStatus = booking.payment_status === 'paid' || booking.payment_status === 'completed' || booking.payment_status === 'succeeded'
  const paidCents = booking.amount_paid ||
    booking.booking_details?.amount_paid ||
    booking.booking_details?.amountPaid ||
    (bookingPaidStatus ? totalCents : 0)

  // Convert to euros for calculations
  const totalEur = centsToEuros(totalCents)
  const paidEur = centsToEuros(paidCents)
  const remainingEur = Math.max(totalEur - paidEur, 0)

  // Payment status - MUST be coherent with financial breakdown
  // Three states based on actual amounts:
  // - Pagato: fully paid (remaining = 0)
  // - Da Saldare: partial payment (0 < paid < total)
  // - Non Pagato: unpaid (paid = 0)
  const isPaid = remainingEur === 0 && totalEur > 0
  const isPartiallyPaid = paidEur > 0 && remainingEur > 0

  // DEBUG: Always log monetary values to verify correct conversion
  console.group(`💰 Payment Debug: Booking ${booking.id}`)
  console.log('Raw total (cents):', totalCents, '→', formatEUR(totalCents))
  console.log('Raw paid (cents):', paidCents, '→', formatEUR(paidCents))
  console.log('Converted total (EUR):', totalEur.toFixed(2))
  console.log('Converted paid (EUR):', paidEur.toFixed(2))
  console.log('Remaining (EUR):', remainingEur.toFixed(2))
  console.log('Payment status:', isPaid ? 'PAID' : 'UNPAID')
  console.groupEnd()

  // Delivery & Pickup fees (in cents)
  const deliveryEnabled = booking.delivery_enabled || booking.booking_details?.delivery_enabled || false
  const deliveryFeeCents = deliveryEnabled ? (booking.delivery_fee || 0) : 0
  const pickupHomeEnabled = booking.pickup_enabled || booking.booking_details?.pickup_enabled || false
  const pickupHomeFeeCents = pickupHomeEnabled ? (booking.pickup_fee || 0) : 0
  const deliveryAddress = booking.delivery_address || booking.booking_details?.delivery_address || null
  const pickupHomeAddress = booking.pickup_address || booking.booking_details?.pickup_address || null

  // Buono sconto
  const buonoSconto = booking.booking_details?.buono_sconto || null
  const buonoScontoCents = buonoSconto?.amount_cents || 0

  // Base rental = total minus delivery/pickup fees + buono (since buono was subtracted from total)
  const baseRentalCents = totalCents - deliveryFeeCents - pickupHomeFeeCents + buonoScontoCents

  // Format dates
  const pickupDate = new Date(booking.pickup_date)
  const dropoffDate = new Date(booking.dropoff_date)

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-theme-overlay backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-theme-bg-secondary border border-theme-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-theme-bg-secondary border-b border-theme-border p-4 sm:p-6 flex justify-between items-center z-10">
          <h2 className="text-xl sm:text-2xl font-bold text-theme-text-primary">Dettagli Prenotazione</h2>
          <button
            onClick={onClose}
            className="text-theme-text-muted hover:text-theme-text-primary transition-colors p-3 hover:bg-theme-text-primary/5 rounded min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 space-y-6">

          {/* Customer Info */}
          <div className="space-y-2">
            <h3 className="text-sm font-bold text-theme-text-muted uppercase tracking-wider">Cliente</h3>
            <div className="text-xl sm:text-2xl font-bold text-theme-text-primary">{booking.customer_name || resolvedCustomer?.name || booking.booking_details?.customer?.fullName || booking.guest_name || 'Cliente Sconosciuto'}</div>
            {(booking.customer_email || resolvedCustomer?.email) && (
              <div className="text-sm text-theme-text-muted">{booking.customer_email || resolvedCustomer?.email}</div>
            )}
            {(booking.customer_phone || resolvedCustomer?.phone) && (
              <div className="text-sm text-theme-text-muted">{booking.customer_phone || resolvedCustomer?.phone}</div>
            )}
          </div>

          {/* Vehicle Info */}
          <div className="space-y-2">
            <h3 className="text-sm font-bold text-theme-text-muted uppercase tracking-wider">Veicolo</h3>
            <div className="flex items-center gap-3">
              <div className="text-lg font-bold text-theme-text-primary">{booking.vehicle_name}</div>
              {booking.vehicle_plate && (
                <div className="px-2 py-1 bg-theme-text-primary/5 rounded font-mono text-sm text-theme-text-muted border border-theme-border/50">
                  {booking.vehicle_plate}
                </div>
              )}
            </div>
          </div>

          {/* Rental Period */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-theme-text-muted uppercase tracking-wider">Periodo Noleggio</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <div className="text-xs text-theme-text-muted">Ritiro</div>
                <div className="font-mono text-sm sm:text-base text-theme-text-primary">
                  {formatRomeDate(pickupDate, { dateStyle: 'long' })}
                </div>
                <div className="font-mono text-sm text-theme-text-muted">
                  {formatRomeDate(pickupDate, { timeStyle: 'short' })}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-theme-text-muted">Rientro</div>
                <div className="font-mono text-sm sm:text-base text-theme-text-primary">
                  {formatRomeDate(dropoffDate, { dateStyle: 'long' })}
                </div>
                <div className="font-mono text-sm text-theme-text-muted">
                  {formatRomeDate(dropoffDate, { timeStyle: 'short' })}
                </div>
              </div>
            </div>
          </div>

          {/* Payment Status */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-theme-text-muted uppercase tracking-wider">Pagamento</h3>
              {remainingEur > 0 && (
                <div className="flex gap-2">
                  {!paymentLink ? (
                    <button
                      onClick={async () => {
                        setGeneratingLink(true)
                        try {
                          const res = await fetch('/.netlify/functions/nexi-pay-by-link', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              bookingId: booking.id,
                              amount: remainingEur,
                              customerEmail: booking.customer_email || booking.booking_details?.customer?.email || '',
                              customerName: booking.customer_name || booking.booking_details?.customer?.fullName || 'Cliente',
                              description: `Pagamento ${booking.vehicle_name} - ${booking.customer_name || booking.booking_details?.customer?.fullName || 'Cliente'}`,
                              expirationDays: 7
                            })
                          });
                          const data = await res.json();
                          if (data.paymentUrl) {
                            setPaymentLink(data.paymentUrl)
                            toast.success('Link di pagamento generato! Clicca "Copia Link" per inviarlo al cliente.')
                          } else {
                            toast.error('Errore: ' + (data.error || 'Errore sconosciuto'));
                          }
                        } catch (e) {
                          toast.error('Errore invio link di pagamento');
                        } finally {
                          setGeneratingLink(false)
                        }
                      }}
                      disabled={generatingLink}
                      className="text-xs bg-purple-600 hover:bg-purple-700 text-white px-3 py-2 rounded transition-colors flex items-center gap-1 disabled:opacity-50"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                      {generatingLink ? 'Generando...' : 'Genera Link Pagamento'}
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(paymentLink)
                          setLinkCopied(true)
                          setTimeout(() => setLinkCopied(false), 2000)
                        }}
                        className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded transition-colors flex items-center gap-1"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                        </svg>
                        {linkCopied ? 'Copiato!' : 'Copia Link'}
                      </button>
                      <button
                        onClick={() => window.open(paymentLink, '_blank')}
                        className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded transition-colors flex items-center gap-1"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        Apri Link
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Payment Status Badge */}
            <div className="flex items-center gap-2">
              <span className={`px-3 py-1.5 rounded-full text-sm font-bold ${isPaid
                ? 'bg-green-900/50 text-green-300 border border-green-700/50'
                : isPartiallyPaid
                  ? 'bg-orange-900/50 text-orange-300 border border-orange-700/50'
                  : 'bg-red-900/50 text-red-300 border border-red-700/50'
                }`}>
                {isPaid ? '✓ Pagato' : isPartiallyPaid ? '⚠ Da Saldare' : '✗ Non Pagato'}
              </span>
            </div>

            {/* Financial Breakdown */}
            <div className="bg-theme-text-primary/5 rounded-lg p-4 space-y-2 border border-theme-border/50">
              {(deliveryEnabled || pickupHomeEnabled || buonoSconto) ? (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-theme-text-muted">Noleggio</span>
                    <span className="font-mono text-theme-text-primary">{formatEUR(baseRentalCents)}</span>
                  </div>
                  {deliveryEnabled && (
                    <div className="flex justify-between items-center">
                      <span className="text-theme-text-muted">Consegna a domicilio</span>
                      <span className="font-mono text-theme-text-primary">{formatEUR(deliveryFeeCents)}</span>
                    </div>
                  )}
                  {pickupHomeEnabled && (
                    <div className="flex justify-between items-center">
                      <span className="text-theme-text-muted">Ritiro a domicilio</span>
                      <span className="font-mono text-theme-text-primary">{formatEUR(pickupHomeFeeCents)}</span>
                    </div>
                  )}
                  {buonoSconto && (
                    <div className="flex justify-between items-center text-green-400">
                      <span>Buono Sconto ({buonoSconto.code})</span>
                      <span className="font-mono font-bold">-{formatEUR(buonoScontoCents)}</span>
                    </div>
                  )}
                  <div className="border-t border-theme-border/50 pt-2 mt-2">
                    <div className="flex justify-between items-center">
                      <span className="text-theme-text-muted font-semibold">Totale</span>
                      <span className="font-mono text-theme-text-primary font-semibold">{formatEUR(totalCents)}</span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex justify-between items-center">
                  <span className="text-theme-text-muted">Totale</span>
                  <span className="font-mono text-theme-text-primary">{formatEUR(totalCents)}</span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-theme-text-muted">Acconto Pagato</span>
                <span className="font-mono text-theme-text-primary">{formatEUR(paidCents)}</span>
              </div>
              <div className="border-t border-theme-border/50 pt-2 mt-2">
                <div className="flex justify-between items-center">
                  <span className={`font-bold ${remainingEur > 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {remainingEur > 0 ? 'Da Saldare' : 'Saldato'}
                  </span>
                  <span className={`font-mono text-xl font-bold ${remainingEur > 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {formatEUR(Math.round(remainingEur * 100))}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Delivery & Pickup Addresses */}
          {(deliveryEnabled || pickupHomeEnabled) && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-theme-text-muted uppercase tracking-wider">Servizi a Domicilio</h3>
              {deliveryEnabled && deliveryAddress && (
                <div className="bg-theme-text-primary/5 p-3 rounded border border-theme-border/50 space-y-1">
                  <div className="text-sm font-semibold text-theme-text-primary">Consegna a domicilio</div>
                  <div className="text-sm text-theme-text-muted">
                    {deliveryAddress.street}, {deliveryAddress.zip} {deliveryAddress.city} ({deliveryAddress.province})
                  </div>
                  {deliveryAddress.notes && (
                    <div className="text-xs text-theme-text-muted italic">Note: {deliveryAddress.notes}</div>
                  )}
                </div>
              )}
              {pickupHomeEnabled && pickupHomeAddress && (
                <div className="bg-theme-text-primary/5 p-3 rounded border border-theme-border/50 space-y-1">
                  <div className="text-sm font-semibold text-theme-text-primary">Ritiro a domicilio</div>
                  <div className="text-sm text-theme-text-muted">
                    {pickupHomeAddress.street}, {pickupHomeAddress.zip} {pickupHomeAddress.city} ({pickupHomeAddress.province})
                  </div>
                  {pickupHomeAddress.notes && (
                    <div className="text-xs text-theme-text-muted italic">Note: {pickupHomeAddress.notes}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Notes/Extras */}
          {booking.booking_details?.notes && (
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-theme-text-muted uppercase tracking-wider">Note</h3>
              <div className="text-sm text-theme-text-primary bg-theme-text-primary/5 p-3 rounded border border-theme-border/50">
                {booking.booking_details.notes}
              </div>
            </div>
          )}

          {/* Quick Actions */}
          <div className="flex gap-3 pt-4 border-t border-theme-border">
            <button
              onClick={() => { if (onEdit) { onEdit(booking.id); onClose(); } }}
              className="flex-1 px-4 py-2 bg-dr7-gold/20 hover:bg-dr7-gold/30 text-dr7-gold rounded border border-dr7-gold/30 font-medium transition-colors"
            >
              Modifica Prenotazione
            </button>
            {booking.contract_url && (
              <button
                onClick={() => window.open(booking.contract_url, '_blank')}
                className="flex-1 px-4 py-2 bg-theme-text-primary/5 hover:bg-theme-text-primary/10 text-theme-text-primary rounded border border-theme-border/50 font-medium transition-colors"
              >
                Visualizza Contratto
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
