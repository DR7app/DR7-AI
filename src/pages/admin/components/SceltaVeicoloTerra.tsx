import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../supabaseClient'
import { authFetch } from '../../../utils/authFetch'
import { romeIsoFromParts } from '../../../utils/timezoneUtils'
import { isWithinOfficeHoursForDate } from '../../../utils/noleggioHours'
import { isVehicleAvailable, getRentalBufferMinutes, type Vehicle, type Booking } from '../../../utils/vehicleAvailability'
import { confermaSlotOccupato } from '../../../utils/confermaSlotOccupato'

/**
 * Tour Noleggio Terra (23/11/2026, direzione): niente piu' tendina "Veicolo"
 * in cima alla pagina. Nel form si mettono data/ora di uscita e di rientro e
 * qui compaiono i veicoli disponibili, con la STESSA logica del form
 * Prenotazioni noleggio: stessa flotta del tab Veicoli (esclusi gli
 * archiviati), stessa verifica isVehicleAvailable, stessa casella "Mostra
 * tutte" e stesso popup rosso se il mezzo e' gia' occupato.
 */

const INPUT_CLS = 'w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-sm text-theme-text-primary'

/** Orari a quarti d'ora; fuori dagli orari di Centralina Pro > Orari Noleggio = segnato, come nel noleggio. */
export function OrarioNoleggioSelect({ data, value, onChange, tipo }: {
  data: string
  value: string
  onChange: (v: string) => void
  tipo: 'pickup' | 'return'
}) {
  const orari = useMemo(() => {
    const out: string[] = []
    for (let m = 6 * 60; m <= 23 * 60 + 45; m += 15) out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
    return out
  }, [])
  const fuori = (t: string) => !!data && !isWithinOfficeHoursForDate(data, t, tipo)
  return (
    <select className={`${INPUT_CLS} ${value && fuori(value) ? 'border-red-500 text-red-500' : ''}`} value={value} onChange={e => onChange(e.target.value)}>
      {orari.map(t => <option key={t} value={t}>{t}{fuori(t) ? ' — fuori orario' : ''}</option>)}
    </select>
  )
}

export default function SceltaVeicoloTerra({ uscitaData, uscitaOra, rientroData, rientroOra, value, onChange }: {
  uscitaData: string
  uscitaOra: string
  rientroData: string
  rientroOra: string
  value: string
  onChange: (id: string, nome: string) => void
}) {
  const [veicoli, setVeicoli] = useState<Vehicle[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [prenotazioni, setPrenotazioni] = useState<any[]>([])
  const [mostraTutte, setMostraTutte] = useState(false)
  const [errore, setErrore] = useState('')

  // Stessa flotta del Calendario Noleggio (CalendarTab): tutti tranne gli
  // archiviati (+ il veicolo "Test"). Nel menu si propongono i non archiviati.
  useEffect(() => {
    let annullato = false
    supabase.from('vehicles').select('*').or('status.neq.retired,display_name.eq.Test').order('display_name').then(({ data, error }) => {
      if (annullato) return
      if (error) setErrore('Flotta non caricata: ' + error.message)
      else setVeicoli((data || []) as Vehicle[])
    })
    return () => { annullato = true }
  }, [])

  const finestraOk = !!uscitaData && !!rientroData && !!uscitaOra && !!rientroOra
    && new Date(romeIsoFromParts(rientroData, rientroOra)).getTime() > new Date(romeIsoFromParts(uscitaData, uscitaOra)).getTime()

  // 23/11/2026 (direzione): "deve essere collegato al VERO calendario".
  // Prenotazioni lette ESATTAMENTE come il Calendario Noleggio: funzione
  // list-bookings (service role) con la finestra di date, e se non risponde
  // lo stesso ripiego diretto su Supabase del calendario.
  useEffect(() => {
    if (!finestraOk) { setPrenotazioni([]); return }
    let annullato = false
    const da = new Date(new Date(romeIsoFromParts(uscitaData, '00:00')).getTime() - 2 * 86400_000).toISOString()
    const a = new Date(new Date(romeIsoFromParts(rientroData, '23:59')).getTime() + 2 * 86400_000).toISOString()
    ;(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let righe: any[] | null = null
      try {
        const res = await authFetch(`/.netlify/functions/list-bookings?from=${encodeURIComponent(da)}&to=${encodeURIComponent(a)}`)
        if (res.ok) {
          const j = await res.json()
          if (Array.isArray(j?.bookings)) righe = j.bookings
        }
      } catch { /* ripiego sotto */ }
      if (!righe) {
        const { data, error } = await supabase.from('bookings').select('*')
          .neq('status', 'cancelled').neq('status', 'annullata')
          .lt('pickup_date', a)
          .or(`dropoff_date.is.null,dropoff_date.gte.${da}`)
        if (error) { if (!annullato) setErrore('Calendario non caricato: ' + error.message); return }
        righe = data || []
      }
      if (annullato) return
      setErrore('')
      setPrenotazioni(righe)
    })()
    return () => { annullato = true }
  }, [finestraOk, uscitaData, rientroData])

  // Ogni prenotazione su UN solo veicolo, come le barre del calendario:
  // prima l'id (anche in booking_details), poi la targa. E solo quelle che il
  // calendario mostra (niente annullate, scadute, link Pay by Link scaduti).
  const barre = useMemo(() => {
    const perVeicolo = new Map<string, { inizio: Date; fine: Date; cliente: string }[]>()
    const targa = (t?: string | null) => String(t || '').replace(/\s/g, '').toUpperCase()
    const ora = new Date()
    for (const b of prenotazioni) {
      if (b.status === 'cancelled' || b.status === 'annullata' || b.status === 'expired' || b.status === 'deleted') continue
      if (b.status === 'pending_payment' && b.payment_status === 'expired') continue
      if (b.payment_status === 'pending' && b.payment_method === 'Nexi Pay by Link') {
        const scade = b.booking_details?.payment_link_expires_at || b.booking_details?.payment_link_created_at
        if (scade && ora > new Date(scade)) continue
      }
      const vid = b.vehicle_id || b.booking_details?.vehicle_id
      let veicolo = vid ? veicoli.find(v => v.id === vid) : undefined
      if (!veicolo) {
        const t = targa(b.vehicle_plate || b.booking_details?.vehicle?.plate)
        if (t) veicolo = veicoli.find(v => targa(v.plate) === t)
      }
      if (!veicolo || !b.pickup_date) continue
      const inizio = new Date(b.pickup_date)
      const fine = b.dropoff_date ? new Date(b.dropoff_date) : inizio
      const lista = perVeicolo.get(veicolo.id) || []
      lista.push({ inizio, fine, cliente: b.customer_name || b.guest_name || 'prenotazione' })
      perVeicolo.set(veicolo.id, lista)
    }
    return perVeicolo
  }, [prenotazioni, veicoli])

  const fmt = (d: Date) => d.toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })

  // Occupato = una barra del calendario si sovrappone (buffer post-noleggio
  // della Centralina solo DOPO la barra), oppure blocco manutenzione del mezzo.
  const esiti = useMemo(() => {
    const m = new Map<string, { available: boolean; reason?: string }>()
    if (!finestraOk) return m
    const ini = new Date(romeIsoFromParts(uscitaData, uscitaOra)).getTime()
    const fin = new Date(romeIsoFromParts(rientroData, rientroOra)).getTime()
    const buffer = getRentalBufferMinutes() * 60_000
    for (const v of veicoli) {
      const conflitto = (barre.get(v.id) || []).find(x => x.inizio.getTime() < fin && x.fine.getTime() + buffer > ini)
      if (conflitto) {
        m.set(v.id, { available: false, reason: `${v.display_name} e' occupato nel Calendario Noleggio: ${conflitto.cliente}, dal ${fmt(conflitto.inizio)} al ${fmt(conflitto.fine)} (+ ${getRentalBufferMinutes()} min di stacco).` })
        continue
      }
      const blocco = isVehicleAvailable(v, uscitaData, rientroData, uscitaOra, rientroOra, [] as Booking[])
      m.set(v.id, { available: blocco.available, reason: blocco.reason })
    }
    return m
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [veicoli, barre, finestraOk, uscitaData, rientroData, uscitaOra, rientroOra])

  // Come in Prenotazioni noleggio (vehicleEarliestTimes): se il mezzo rientra
  // lo stesso giorno, "(disponibile dalle HH:MM)" = fine della barra che si
  // sovrappone + buffer post-noleggio della Centralina.
  const dalleOre = useMemo(() => {
    const m = new Map<string, Date>()
    if (!finestraOk) return m
    const ini = new Date(romeIsoFromParts(uscitaData, uscitaOra))
    const fin = new Date(romeIsoFromParts(rientroData, rientroOra))
    for (const v of veicoli) {
      let fine: Date | null = null
      for (const x of barre.get(v.id) || []) {
        if (ini < x.fine && fin > x.inizio && (!fine || x.fine > fine)) fine = x.fine
      }
      if (fine) m.set(v.id, new Date(fine.getTime() + getRentalBufferMinutes() * 60_000))
    }
    return m
  }, [veicoli, barre, finestraOk, uscitaData, uscitaOra, rientroData, rientroOra])

  const oraRoma = (d: Date) => d.toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false })
  const giornoRoma = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
  // Rientro in giornata (entro le 19) = proposto con l'orario, come nel noleggio.
  const liberoPiuTardi = (id: string) => {
    const d = dalleOre.get(id)
    return !!d && giornoRoma(d) === uscitaData && Number(oraRoma(d).slice(0, 2)) < 19
  }

  if (!finestraOk) {
    return (
      <div className="p-3 bg-yellow-500/10 border border-yellow-600/50 rounded-lg">
        <p className="text-yellow-600 text-sm">Inserisci data e ora di uscita e di rientro per vedere i veicoli disponibili.</p>
      </div>
    )
  }

  const proponibili = veicoli.filter(v => v.status !== 'retired')
  const lista = mostraTutte ? proponibili : proponibili.filter(v => esiti.get(v.id)?.available || liberoPiuTardi(v.id) || v.id === value)
  const disponibili = proponibili.filter(v => esiti.get(v.id)?.available).length

  return (
    <div>
      <label className="text-xs text-theme-text-muted">Veicolo * ({mostraTutte ? `${proponibili.length} totali` : `${disponibili} disponibili`})</label>
      <select
        className={INPUT_CLS}
        value={value}
        onChange={async e => {
          const id = e.target.value
          if (!id) { onChange('', ''); return }
          const esito = esiti.get(id)
          if (esito && !esito.available) {
            // Come nel form Prenotazioni: l'avviso parte alla scelta del mezzo.
            if (!(await confermaSlotOccupato(esito.reason || 'Slot non disponibile'))) return
          }
          const v = veicoli.find(x => x.id === id)
          onChange(id, v?.display_name || '')
        }}
      >
        <option value="">Seleziona veicolo...</option>
        {lista.map(v => {
          const targa = v.plate || v.targa
          const occupato = !esiti.get(v.id)?.available
          const dalle = occupato && liberoPiuTardi(v.id) ? dalleOre.get(v.id) : null
          return (
            <option key={v.id} value={v.id}>
              {targa ? `${v.display_name} (Targa: ${targa})` : v.display_name}{dalle ? ` (disponibile dalle ${oraRoma(dalle)})` : occupato ? ' — occupato' : ''}
            </option>
          )
        })}
      </select>
      <label className="flex items-center gap-2 mt-2 cursor-pointer">
        <input type="checkbox" checked={mostraTutte} onChange={e => setMostraTutte(e.target.checked)} className="w-4 h-4 rounded border-theme-border bg-theme-bg-tertiary" />
        <span className="text-sm text-amber-600">Mostra tutte le disponibilità (ignora il calendario)</span>
      </label>
      {!mostraTutte && disponibili === 0 && (
        <p className="text-red-500 text-sm mt-1">Nessun veicolo disponibile per queste date. Usa la casella sopra per mostrare tutto.</p>
      )}
      {errore && <p className="text-red-500 text-xs mt-1">{errore}</p>}
    </div>
  )
}
