import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../supabaseClient'
import { romeIsoFromParts } from '../../../utils/timezoneUtils'
import { getReturnTimesForDate } from '../../../utils/noleggioHours'
import { getRentalBufferMinutes } from '../../../utils/vehicleAvailability'
import {
  autoProposte, oreDaEtichetta,
  type CategoriaFlotta, type PrenotazioneFlotta, type VeicoloCortesia,
} from '../../../utils/autoCortesia'

/**
 * Auto di cortesia nel lavaggio (23/11/2026, richiesta direzione).
 *
 * Dopo data e ora del lavaggio si vedono le AUTO VERE, non le categorie: per
 * ognuna da che ora e' libera e i bottoni 1h..7h col prezzo della sua scheda
 * (Catalogo Lavaggio, categoria "experience"). Le ore che non ci stanno sono
 * barrate. La regola sta in utils/autoCortesia.ts (stessa del sito).
 */

export interface SchedaCortesia {
  id: string
  name: string
  name_en?: string | null
  price_options?: { label: string; price: number }[] | null
}

export interface SceltaCortesia {
  veicolo: VeicoloCortesia
  scheda: SchedaCortesia
  opzione: { label: string; price: number }
  ore: number
  /** ISO UTC */
  inizio: string
  /** ISO UTC */
  fine: string
}

const oraRoma = (ms: number) =>
  new Date(ms).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false })

export default function SceltaAutoCortesia({
  data, ora, schede, scelta, onScelta, escludiPrenotazioni = [],
}: {
  data: string
  ora: string
  schede: SchedaCortesia[]
  scelta: SceltaCortesia | null
  onScelta: (s: SceltaCortesia | null) => void
  /** Prenotazioni da non contare (es. il blocco del lavaggio che si sta modificando). */
  escludiPrenotazioni?: string[]
}) {
  const [categorie, setCategorie] = useState<CategoriaFlotta[]>([])
  const [veicoli, setVeicoli] = useState<VeicoloCortesia[]>([])
  const [prenotazioni, setPrenotazioni] = useState<PrenotazioneFlotta[]>([])
  const [caricamento, setCaricamento] = useState(true)
  const [errore, setErrore] = useState<string | null>(null)

  // Categorie (etichette di Centralina Pro) e flotta: una volta sola.
  useEffect(() => {
    let annullato = false
    ;(async () => {
      try {
        const [cat, veic] = await Promise.all([
          supabase.from('centralina_pro_config').select('cat:config->categories').eq('id', 'main').maybeSingle(),
          supabase.from('vehicles').select('id, display_name, plate, category, status, metadata').neq('status', 'retired').order('display_name', { ascending: true }),
        ])
        if (annullato) return
        if (veic.error) throw veic.error
        const lista = (cat.data as { cat?: unknown } | null)?.cat
        setCategorie(Array.isArray(lista)
          ? (lista as { id?: string; label?: string }[]).filter(c => c?.id).map(c => ({ id: String(c.id), label: String(c.label || c.id) }))
          : [])
        setVeicoli((veic.data || []) as VeicoloCortesia[])
      } catch (e) {
        if (!annullato) setErrore('Flotta non caricata: ' + (e instanceof Error ? e.message : 'riprova'))
      }
    })()
    return () => { annullato = true }
  }, [])

  // Prenotazioni della giornata del lavaggio (e della sera prima, per il buffer).
  useEffect(() => {
    if (!data) return
    let annullato = false
    setCaricamento(true)
    ;(async () => {
      try {
        const inizioGiorno = new Date(romeIsoFromParts(data, '00:00')).getTime()
        const { data: righe, error } = await supabase
          .from('bookings')
          .select('id, vehicle_id, vehicle_plate, service_type, status, pickup_date, dropoff_date')
          .neq('service_type', 'car_wash')
          .lt('pickup_date', new Date(inizioGiorno + 36 * 3600_000).toISOString())
          .gt('dropoff_date', new Date(inizioGiorno - 24 * 3600_000).toISOString())
        if (annullato) return
        if (error) throw error
        setPrenotazioni((righe || []) as PrenotazioneFlotta[])
        setErrore(null)
      } catch (e) {
        if (!annullato) setErrore('Disponibilita non caricata: ' + (e instanceof Error ? e.message : 'riprova'))
      } finally {
        if (!annullato) setCaricamento(false)
      }
    })()
    return () => { annullato = true }
  }, [data])

  // Ultima riconsegna del giorno (Centralina > Orari Noleggio).
  const chiusura = useMemo(() => {
    if (!data) return null
    const orari = getReturnTimesForDate(new Date(`${data}T12:00:00`))
    if (orari.length === 0) return null
    return { ora: orari[orari.length - 1], ms: new Date(romeIsoFromParts(data, orari[orari.length - 1])).getTime() }
  }, [data])

  const inizioLavaggio = data && ora ? new Date(romeIsoFromParts(data, ora)).getTime() : NaN

  const proposte = useMemo(() => {
    if (!chiusura || isNaN(inizioLavaggio)) return []
    return autoProposte({
      schede, categorie, veicoli, prenotazioni,
      inizioLavaggio, chiusura: chiusura.ms,
      bufferMin: getRentalBufferMinutes(),
      escludiPrenotazioni,
    })
  }, [schede, categorie, veicoli, prenotazioni, inizioLavaggio, chiusura, escludiPrenotazioni])

  // La scelta non sta piu' in piedi (cambiata data/ora o l'auto e' stata
  // presa): si toglie, cosi' non si salva un noleggio impossibile.
  useEffect(() => {
    if (!scelta || caricamento) return
    const p = proposte.find(x => x.veicolo.id === scelta.veicolo.id)
    const ok = !!p && p.disponibilita.liberaDa !== null
      && new Date(scelta.inizio).getTime() === p.disponibilita.liberaDa
      && scelta.ore <= p.disponibilita.oreMax
    if (!ok) onScelta(null)
  }, [proposte, scelta, caricamento, onScelta])

  if (!data || !ora) {
    return <p className="text-xs text-theme-text-muted">Scegli prima data e ora del lavaggio.</p>
  }
  if (errore) return <p className="text-xs text-rose-500">{errore}</p>
  if (!chiusura) return <p className="text-xs text-theme-text-muted">Noleggio chiuso in questa data: nessuna auto di cortesia.</p>
  if (caricamento && proposte.length === 0) return <p className="text-xs text-theme-text-muted">Verifica auto disponibili...</p>
  if (proposte.length === 0) {
    return <p className="text-xs text-theme-text-muted">Nessuna auto abbinata alle schede Experience del catalogo.</p>
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-theme-text-muted">
        Auto libere dalle {ora} in poi, fino all'ultima riconsegna ({chiusura.ora}). Il noleggio parte quando l'auto e' libera.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        {proposte.map(p => {
          const { veicolo, scheda, categoria, disponibilita } = p
          const scelto = scelta?.veicolo.id === veicolo.id
          const libera = disponibilita.liberaDa !== null
          const opzioni = (scheda.price_options || [])
            .map(o => ({ o, ore: oreDaEtichetta(o.label) }))
            .filter((x): x is { o: { label: string; price: number }; ore: number } => x.ore !== null)
            .sort((a, b) => a.ore - b.ore)
          return (
            <div key={veicolo.id} className={`rounded-lg border p-3 ${
              scelto ? 'border-emerald-500 bg-emerald-500/10' : libera ? 'border-theme-border bg-theme-bg-tertiary' : 'border-theme-border bg-theme-bg-tertiary opacity-60'
            }`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-theme-text-primary truncate">{veicolo.display_name}</p>
                  <p className="text-[11px] text-theme-text-muted">
                    {veicolo.plate && <span className="font-mono mr-2">{veicolo.plate}</span>}
                    {categoria.label}
                  </p>
                </div>
                <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  !libera
                    ? 'bg-rose-500/15 text-rose-500 border-rose-500/30'
                    : disponibilita.liberaDa! > inizioLavaggio
                      ? 'bg-amber-500/15 text-amber-600 border-amber-500/30'
                      : 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30'
                }`}>
                  {!libera ? 'Non disponibile' : disponibilita.liberaDa! > inizioLavaggio ? `Libera dalle ${oraRoma(disponibilita.liberaDa!)}` : `Libera alle ${ora}`}
                </span>
              </div>
              {libera && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {opzioni.map(({ o, ore }) => {
                    const possibile = ore <= disponibilita.oreMax
                    const attivo = scelto && scelta?.ore === ore
                    return (
                      <button
                        key={o.label}
                        type="button"
                        disabled={!possibile}
                        title={possibile ? `Dalle ${oraRoma(disponibilita.liberaDa!)} alle ${oraRoma(disponibilita.liberaDa! + ore * 3600_000)}` : 'Auto non libera per tutte queste ore'}
                        onClick={() => onScelta(attivo ? null : {
                          veicolo, scheda, opzione: o, ore,
                          inizio: new Date(disponibilita.liberaDa!).toISOString(),
                          fine: new Date(disponibilita.liberaDa! + ore * 3600_000).toISOString(),
                        })}
                        className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                          attivo
                            ? 'bg-emerald-500 text-black border-emerald-500'
                            : possibile
                              ? 'bg-theme-bg-secondary text-theme-text-secondary border-theme-border hover:border-emerald-500'
                              : 'bg-theme-bg-secondary text-theme-text-muted border-theme-border line-through opacity-50 cursor-not-allowed'
                        }`}
                      >
                        {o.label} · €{Number(o.price).toFixed(2)}
                      </button>
                    )
                  })}
                </div>
              )}
              {scelto && scelta && (
                <p className="mt-2 text-[11px] text-emerald-600">
                  Noleggio dalle {oraRoma(new Date(scelta.inizio).getTime())} alle {oraRoma(new Date(scelta.fine).getTime())}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
