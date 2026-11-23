import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../supabaseClient'
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
  const [prenotazioni, setPrenotazioni] = useState<Booking[]>([])
  const [mostraTutte, setMostraTutte] = useState(false)
  const [errore, setErrore] = useState('')

  // Stessa flotta del tab Veicoli: tutti tranne gli archiviati.
  useEffect(() => {
    let annullato = false
    supabase.from('vehicles').select('*').neq('status', 'retired').order('display_name').then(({ data, error }) => {
      if (annullato) return
      if (error) setErrore('Flotta non caricata: ' + error.message)
      else setVeicoli((data || []) as Vehicle[])
    })
    return () => { annullato = true }
  }, [])

  const finestraOk = !!uscitaData && !!rientroData && !!uscitaOra && !!rientroOra
    && new Date(romeIsoFromParts(rientroData, rientroOra)).getTime() > new Date(romeIsoFromParts(uscitaData, uscitaOra)).getTime()

  // Prenotazioni attorno alla finestra (piu' un giorno per i buffer).
  useEffect(() => {
    if (!finestraOk) { setPrenotazioni([]); return }
    let annullato = false
    const da = new Date(new Date(romeIsoFromParts(uscitaData, '00:00')).getTime() - 2 * 86400_000).toISOString()
    const a = new Date(new Date(romeIsoFromParts(rientroData, '23:59')).getTime() + 2 * 86400_000).toISOString()
    supabase.from('bookings').select('*')
      .neq('status', 'cancelled').neq('status', 'annullata')
      .lt('pickup_date', a).gt('dropoff_date', da)
      .then(({ data, error }) => {
        if (annullato) return
        if (error) setErrore('Disponibilita non caricata: ' + error.message)
        else { setErrore(''); setPrenotazioni((data || []) as Booking[]) }
      })
    return () => { annullato = true }
  }, [finestraOk, uscitaData, rientroData])

  const esiti = useMemo(() => {
    const m = new Map<string, { available: boolean; reason?: string }>()
    if (!finestraOk) return m
    for (const v of veicoli) {
      const r = isVehicleAvailable(v, uscitaData, rientroData, uscitaOra, rientroOra, prenotazioni)
      m.set(v.id, { available: r.available, reason: r.reason })
    }
    return m
  }, [veicoli, prenotazioni, finestraOk, uscitaData, rientroData, uscitaOra, rientroOra])

  // Come in Prenotazioni noleggio (vehicleEarliestTimes): se il mezzo rientra
  // lo stesso giorno, si mostra "(disponibile dalle HH:MM)" = fine della
  // prenotazione che si sovrappone + buffer post-noleggio della Centralina.
  const dalleOre = useMemo(() => {
    const m = new Map<string, Date>()
    if (!finestraOk) return m
    const ini = new Date(romeIsoFromParts(uscitaData, uscitaOra))
    const fin = new Date(romeIsoFromParts(rientroData, rientroOra))
    const targa = (t?: string | null) => String(t || '').replace(/\s/g, '').toUpperCase()
    for (const v of veicoli) {
      let fine: Date | null = null
      for (const b of prenotazioni) {
        if (b.status === 'cancelled') continue
        const stesso = (b.vehicle_id && b.vehicle_id === v.id) || (!b.vehicle_id && !!targa(v.plate) && targa(b.vehicle_plate) === targa(v.plate))
        if (!stesso) continue
        const bIni = new Date(b.pickup_date), bFin = new Date(b.dropoff_date)
        if (ini < bFin && fin > bIni && (!fine || bFin > fine)) fine = bFin
      }
      if (fine) m.set(v.id, new Date(fine.getTime() + getRentalBufferMinutes() * 60_000))
    }
    return m
  }, [veicoli, prenotazioni, finestraOk, uscitaData, uscitaOra, rientroData, rientroOra])

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

  const lista = mostraTutte ? veicoli : veicoli.filter(v => esiti.get(v.id)?.available || liberoPiuTardi(v.id) || v.id === value)
  const disponibili = veicoli.filter(v => esiti.get(v.id)?.available).length

  return (
    <div>
      <label className="text-xs text-theme-text-muted">Veicolo * ({mostraTutte ? `${veicoli.length} totali` : `${disponibili} disponibili`})</label>
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
