import NumeroTelefono from '../../../components/NumeroTelefono'
import { getServiceDuration, formatDuration } from '../../../utils/durataLavaggio'

/**
 * Scheda di dettaglio di una prenotazione Lavaggio & Meccanica.
 *
 * Era scritta dentro CarWashCalendarTab e si apriva SOLO cliccando un blocco
 * del calendario: la lista Prenotazioni Lavaggio non aveva modo di aprirla.
 * Ora e' un componente unico usato da entrambi — stesso markup, stessi campi,
 * stessi due bottoni — cosi' la scheda resta identica ovunque la si apra.
 */

export interface CarWashDetailBooking {
  id: string
  customer_name: string
  customer_email?: string
  customer_phone?: string
  service_name: string
  appointment_date: string
  appointment_time: string
  price_total: number
  status: string
  payment_status: string
  vehicle_plate?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  booking_details: any
}

interface Props {
  booking: CarWashDetailBooking
  onClose: () => void
  onEdit: () => void
  onPronta: () => void
  /** Pronta gia' inviata: bottone grigio e non cliccabile. */
  prontaGiaInviata: boolean
  /** Invio in corso. */
  prontaInCorso: boolean
  /** "Lavaggio Rientro" non ha un cliente da avvisare. */
  mostraPronta?: boolean
}

const isPaidBooking = (booking: CarWashDetailBooking): boolean => {
  return booking.payment_status === 'paid' ||
    booking.payment_status === 'completed' ||
    booking.payment_status === 'succeeded' ||
    (booking.booking_details?.amountPaid && booking.booking_details.amountPaid >= booking.price_total)
}

export default function CarWashBookingDetailModal({
  booking,
  onClose,
  onEdit,
  onPronta,
  prontaGiaInviata,
  prontaInCorso,
  mostraPronta = true,
}: Props) {
  const paid = isPaidBooking(booking)

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-xl flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-theme-bg-secondary rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto shadow-[0_25px_60px_-12px_rgba(0,0,0,0.5)] border border-theme-border/30"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative rounded-t-2xl px-6 pt-8 pb-6 bg-theme-bg-tertiary border-b border-theme-border/30">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 rounded-full bg-theme-text-muted/10 hover:bg-theme-text-muted/20 flex items-center justify-center text-theme-text-muted hover:text-theme-text-primary transition-all text-lg"
          >
            ×
          </button>
          <div className="text-theme-text-muted text-xs font-medium uppercase tracking-widest mb-1">Lavaggio & Meccanica</div>
          <h3 className="text-2xl font-bold text-theme-text-primary tracking-tight">
            {booking.customer_name || booking.booking_details?.customer?.fullName || 'N/A'}
          </h3>
          <p className="text-theme-text-muted text-sm mt-1">
            {new Date(booking.appointment_date).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })} · {booking.appointment_time}
          </p>
          {/* Status pills */}
          <div className="flex items-center gap-2 mt-3">
            <span className={`px-3 py-1 rounded-full text-[11px] font-semibold tracking-wide ${
              paid
                ? 'bg-emerald-500/15 text-emerald-500'
                : booking.payment_status === 'pending'
                  ? 'bg-orange-500/15 text-orange-500'
                  : 'bg-red-500/15 text-red-500'
            }`}>
              {paid
                ? 'Pagato'
                : booking.payment_status === 'pending'
                  ? 'In Attesa'
                  : 'Non Pagato'}
            </span>
            <span className="px-3 py-1 rounded-full text-[11px] font-semibold tracking-wide bg-theme-text-muted/10 text-theme-text-muted uppercase">
              {booking.status}
            </span>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">

          {/* Contact card */}
          <div className="rounded-xl bg-theme-bg-tertiary/60 overflow-hidden">
            <div className="px-4 py-3 flex items-center justify-between border-b border-theme-border/20">
              <span className="text-theme-text-muted text-sm">Email</span>
              <span className="text-theme-text-primary text-sm font-medium">{booking.customer_email || booking.booking_details?.customer?.email || '—'}</span>
            </div>
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-theme-text-muted text-sm">Telefono</span>
              <span className="text-theme-text-primary text-sm font-medium"><NumeroTelefono valore={booking.customer_phone || booking.booking_details?.customer?.phone} vuoto="—" /></span>
            </div>
          </div>

          {/* Vehicle card */}
          {(booking.booking_details?.vehicleMakeModel || booking.vehicle_plate) && (
            <div className="rounded-xl bg-theme-bg-tertiary/60 overflow-hidden">
              {booking.vehicle_plate && (
                <div className={`px-4 py-3 flex items-center justify-between ${booking.booking_details?.vehicleMakeModel ? 'border-b border-theme-border/20' : ''}`}>
                  <span className="text-theme-text-muted text-sm">Targa</span>
                  <span className="font-mono font-bold text-cyan-700 dark:text-cyan-300 text-sm tracking-wider">{booking.vehicle_plate}</span>
                </div>
              )}
              {booking.booking_details?.vehicleMakeModel && (
                <div className={`px-4 py-3 flex items-center justify-between ${booking.booking_details?.vehicleCategory ? 'border-b border-theme-border/20' : ''}`}>
                  <span className="text-theme-text-muted text-sm">Veicolo</span>
                  <span className="text-theme-text-primary text-sm font-medium">{booking.booking_details.vehicleMakeModel}</span>
                </div>
              )}
              {booking.booking_details?.vehicleCategory && (
                <div className="px-4 py-3 flex items-center justify-between">
                  <span className="text-theme-text-muted text-sm">Categoria</span>
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                    booking.booking_details.vehicleCategory === 'urban'
                      ? 'bg-blue-500/15 text-blue-500'
                      : 'bg-orange-500/15 text-orange-500'
                  }`}>
                    {booking.booking_details.vehicleCategory === 'urban' ? 'URBAN' : 'MAXI'}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Service card */}
          <div className="rounded-xl bg-theme-bg-tertiary/60 overflow-hidden">
            <div className="px-4 py-3 flex items-center justify-between border-b border-theme-border/20">
              <span className="text-theme-text-muted text-sm">Servizio</span>
              <span className="text-theme-text-primary text-sm font-medium text-right max-w-[60%]">{booking.service_name}</span>
            </div>
            <div className={`px-4 py-3 flex items-center justify-between ${booking.booking_details?.additionalService ? 'border-b border-theme-border/20' : ''}`}>
              <span className="text-theme-text-muted text-sm">Durata</span>
              <span className="text-theme-text-primary text-sm font-medium">{formatDuration(getServiceDuration(booking.service_name, booking.booking_details?.vehicleCategory, booking.booking_details))}</span>
            </div>
            {booking.booking_details?.additionalService && (
              <div className="px-4 py-3 flex items-center justify-between">
                <span className="text-theme-text-muted text-sm">Extra</span>
                <span className="text-theme-text-primary text-sm font-medium text-right max-w-[60%]">{booking.booking_details.additionalService}</span>
              </div>
            )}
          </div>

          {/* Price card */}
          <div className="rounded-xl bg-theme-bg-tertiary/60 px-4 py-4 flex items-center justify-between">
            <span className="text-theme-text-primary text-base font-semibold">Totale</span>
            <span className="text-cyan-700 dark:text-cyan-300 font-bold text-2xl tracking-tight">
              €{(booking.price_total / 100).toFixed(2)}
            </span>
          </div>

          {/* Notes card */}
          {booking.booking_details?.notes && (
            <div className="rounded-xl bg-yellow-500/10 border border-yellow-500/20 px-4 py-3">
              <div className="text-yellow-500 text-xs font-semibold uppercase tracking-wider mb-1.5">Note</div>
              <p className="text-theme-text-primary text-sm leading-relaxed">{booking.booking_details.notes}</p>
            </div>
          )}

          {/* Booking ID */}
          <div className="text-center text-xs text-theme-text-muted/50 font-mono pt-1">
            DR7-{booking.id.toUpperCase().slice(0, 8)}
          </div>

          {/* Action buttons */}
          <button
            onClick={onEdit}
            className="w-full py-3 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-700 dark:text-cyan-300 font-semibold text-[15px] transition-all active:scale-[0.98]"
          >
            Modifica Prenotazione
          </button>
          {/* 2026-05-29: Pronta — notifica WhatsApp al cliente che
              l'auto e' pronta per il ritiro + stamp auto_pronta_at nel
              booking_details. Disabilitato durante l'invio + se gia'
              inviato in passato (mostra "Già notificato"). */}
          {mostraPronta && (
            <button
              onClick={onPronta}
              disabled={prontaInCorso || prontaGiaInviata}
              className={`w-full py-3 rounded-xl font-semibold text-[15px] transition-all active:scale-[0.98] ${
                prontaGiaInviata
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 cursor-not-allowed'
                  : prontaInCorso
                    ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 cursor-wait'
                    : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-700 dark:text-emerald-300'
              }`}
            >
              {prontaGiaInviata ? '✓ Cliente già notificato' : prontaInCorso ? 'Invio in corso...' : 'Pronta'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
