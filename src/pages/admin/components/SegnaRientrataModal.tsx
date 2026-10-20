import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { logAdminAction } from '../../../utils/logAdminAction'
import { buildBookingContext } from '../../../utils/adminLogHelpers'
import { romeIsoFromParts } from '../../../utils/timezoneUtils'

/**
 * 20/10/2026 — "Segna rientrata": il cliente riporta il mezzo PRIMA della
 * riconsegna prevista (es. doveva rientrare domani, rientra stasera). Un clic
 * e la riconsegna diventa l'ora vera, cosi' il mezzo torna libero in
 * calendario e disponibilita' e puo' ripartire.
 *
 * Cambia SOLO dropoff_date. Prezzo, pagamenti, contratto e stato restano come
 * sono e al cliente non parte nessun messaggio (non e' una modifica della
 * prenotazione). Lo stato NON passa a 'completed': su quello c'e' il trigger
 * di fattura automatica. La riconsegna prevista resta in
 * booking_details.rientro_anticipato, per lo storico e per rimetterla a mano.
 */

interface SegnaRientrataModalProps {
  booking: {
    id: string
    customer_name: string
    vehicle_name?: string
    vehicle_plate?: string
    pickup_date: string
    dropoff_date: string
  } | null
  onClose: () => void
  onDone: () => void
}

function partiRoma(d: Date): { data: string; ora: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d).map(x => [x.type, x.value]),
  )
  return { data: `${p.year}-${p.month}-${p.day}`, ora: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` }
}

function testoRoma(iso: string): string {
  return new Date(iso).toLocaleString('it-IT', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Rome', hour12: false,
  })
}

export default function SegnaRientrataModal({ booking, onClose, onDone }: SegnaRientrataModalProps) {
  const [data, setData] = useState('')
  const [ora, setOra] = useState('')
  const [salvataggio, setSalvataggio] = useState(false)

  useEffect(() => {
    if (!booking) return
    const adesso = partiRoma(new Date())
    setData(adesso.data)
    setOra(adesso.ora)
  }, [booking])

  if (!booking) return null

  const rientroIso = data && ora ? romeIsoFromParts(data, ora) : ''
  const rientro = rientroIso ? new Date(rientroIso).getTime() : NaN
  const errore = !rientroIso || Number.isNaN(rientro)
    ? 'Inserisci data e ora del rientro.'
    : rientro <= new Date(booking.pickup_date).getTime()
      ? 'Il rientro deve essere dopo il ritiro.'
      : rientro >= new Date(booking.dropoff_date).getTime()
        ? 'Il rientro deve essere prima della riconsegna prevista.'
        : null

  const conferma = async () => {
    if (errore || salvataggio) return
    setSalvataggio(true)
    try {
      // booking_details riletto adesso: una copia vecchia sovrascriverebbe
      // pagamenti/penali segnati nel frattempo.
      const { data: fresca, error: errLettura } = await supabase
        .from('bookings')
        .select('booking_details, dropoff_date')
        .eq('id', booking.id)
        .single()
      if (errLettura || !fresca) throw new Error(errLettura?.message || 'Prenotazione non trovata')

      const adessoIso = new Date().toISOString()
      const { error } = await supabase
        .from('bookings')
        .update({
          dropoff_date: rientroIso,
          booking_details: {
            ...(fresca.booking_details || {}),
            rientro_anticipato: {
              riconsegna_prevista: fresca.dropoff_date,
              rientrata_il: rientroIso,
              segnata_il: adessoIso,
            },
          },
          updated_at: adessoIso,
        })
        .eq('id', booking.id)
      if (error) throw new Error(error.message)

      void logAdminAction('segna_rientrata', 'booking', booking.id, {
        ...buildBookingContext(booking),
        riconsegna_prevista: fresca.dropoff_date,
        rientrata_il: rientroIso,
      })
      toast.success('Mezzo segnato come rientrato: ora e\' di nuovo libero.')
      onDone()
      onClose()
    } catch (e) {
      toast.error('Rientro non salvato: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSalvataggio(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={() => !salvataggio && onClose()}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full sm:max-w-md bg-theme-bg-secondary rounded-t-3xl sm:rounded-3xl shadow-2xl border border-theme-border p-6 space-y-5"
        onClick={e => e.stopPropagation()}
      >
        <div>
          <h2 className="text-xl font-bold text-theme-text-primary">Segna rientrata</h2>
          <p className="text-sm text-theme-text-muted mt-0.5">
            {booking.customer_name}
            {booking.vehicle_name ? ` · ${booking.vehicle_name}` : ''}
            {booking.vehicle_plate ? ` · ${booking.vehicle_plate}` : ''}
          </p>
        </div>

        <div className="rounded-xl bg-theme-bg-tertiary border border-theme-border p-3 text-sm flex justify-between">
          <span className="text-theme-text-muted">Riconsegna prevista</span>
          <span className="text-theme-text-primary font-semibold">{testoRoma(booking.dropoff_date)}</span>
        </div>

        <div>
          <label className="text-sm text-theme-text-secondary mb-1 block">Rientrata il</label>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              value={data}
              onChange={e => setData(e.target.value)}
              className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-dr7-gold"
            />
            <input
              type="time"
              step={60}
              value={ora}
              onChange={e => setOra(e.target.value)}
              className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-dr7-gold"
            />
          </div>
          {errore
            ? <p className="text-xs text-red-500 mt-1.5">{errore}</p>
            : <p className="text-xs text-theme-text-muted mt-1.5">Proposto: adesso. Cambialo se il mezzo e' rientrato prima.</p>}
        </div>

        <p className="text-xs text-theme-text-muted">
          La riconsegna diventa quest'ora e il mezzo torna libero per altri noleggi.
          Prezzo, pagamenti e contratto non cambiano; al cliente non parte nessun messaggio.
        </p>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={salvataggio}
            className="flex-1 py-2.5 rounded-xl border border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover disabled:opacity-50"
          >
            Annulla
          </button>
          <button
            onClick={() => void conferma()}
            disabled={!!errore || salvataggio}
            className="flex-[2] py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white font-semibold disabled:opacity-50"
          >
            {salvataggio ? 'Salvataggio...' : 'Conferma rientro'}
          </button>
        </div>
      </div>
    </div>
  )
}
