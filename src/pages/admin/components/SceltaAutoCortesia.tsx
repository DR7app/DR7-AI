import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../supabaseClient'
import { romeIsoFromParts } from '../../../utils/timezoneUtils'
import { getReturnTimesForDate, getOfficeMinuteRangesForDate } from '../../../utils/noleggioHours'
import { caricaPrenotazioniCalendario, perAutoCortesia } from '../../../utils/prenotazioniCalendarioNoleggio'
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
        // Stessa sorgente del Calendario Noleggio (list-bookings).
        const righe = (await caricaPrenotazioniCalendario(
          new Date(inizioGiorno - 24 * 3600_000).toISOString(),
          new Date(inizioGiorno + 36 * 3600_000).toISOString(),
        )).map(perAutoCortesia)
        if (annullato) return
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

  // Finestre di ritiro (Centralina Pro > Orari Noleggio): l'auto parte solo li'.
  const finestreRitiro = useMemo(() => {
    if (!data) return []
    const mezzanotte = new Date(romeIsoFromParts(data, '00:00')).getTime()
    return getOfficeMinuteRangesForDate(data, 'pickup').map(([a, b]) => ({ inizio: mezzanotte + a * 60_000, fine: mezzanotte + b * 60_000 }))
  }, [data])

  const inizioLavaggio = data && ora ? new Date(romeIsoFromParts(data, ora)).getTime() : NaN

  const proposte = useMemo(() => {
    if (!chiusura || isNaN(inizioLavaggio)) return []
    return autoProposte({
      schede, categorie, veicoli, prenotazioni,
      inizioLavaggio, chiusura: chiusura.ms,
      bufferMin: getRentalBufferMinutes(),
      finestreRitiro,
      escludiPrenotazioni,
    })
  }, [schede, categorie, veicoli, prenotazioni, inizioLavaggio, chiusura, finestreRitiro, escludiPrenotazioni])

  // Passo 1: la scheda (Utilitaria di cortesia, Supercar, ...). Passo 2:
  // l'auto dal menu a tendina, come nel form del noleggio. Passo 3: le ore.
  const [schedaId, setSchedaId] = useState<string | null>(scelta?.scheda.id ?? null)
  const [veicoloId, setVeicoloId] = useState<string>(scelta?.veicolo.id ?? '')

  // Schede che hanno davvero auto in flotta (abbinate per etichetta).
  const schedeConAuto = useMemo(() => {
    const ids = new Set(proposte.map(p => p.scheda.id))
    return schede.filter(s => ids.has(s.id))
  }, [schede, proposte])

  const autoDellaScheda = useMemo(
    () => proposte.filter(p => p.scheda.id === schedaId),
    [proposte, schedaId],
  )
  const autoScelta = autoDellaScheda.find(p => p.veicolo.id === veicoloId) || null

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

  // Scelta tolta da fuori (es. "Nessuna auto"): si azzera anche il form.
  useEffect(() => {
    if (!scelta) return
    setSchedaId(scelta.scheda.id)
    setVeicoloId(scelta.veicolo.id)
  }, [scelta])

  if (!data || !ora) {
    return <p className="text-xs text-theme-text-muted">Scegli prima data e ora del lavaggio.</p>
  }
  if (errore) return <p className="text-xs text-rose-500">{errore}</p>
  if (!chiusura) return <p className="text-xs text-theme-text-muted">Noleggio chiuso in questa data: nessuna auto di cortesia.</p>
  if (caricamento && proposte.length === 0) return <p className="text-xs text-theme-text-muted">Verifica auto disponibili...</p>
  if (schedeConAuto.length === 0) {
    return <p className="text-xs text-theme-text-muted">Nessuna auto in flotta abbinata alle schede Experience del catalogo (il nome della scheda deve contenere l'etichetta della categoria in Centralina Pro).</p>
  }

  const etichettaAuto = (p: typeof proposte[number]) => {
    const nome = `${p.veicolo.display_name || ''}${p.veicolo.plate ? ` (${p.veicolo.plate})` : ''}`
    const d = p.disponibilita
    if (d.liberaDa === null) return `${nome} - occupata`
    const ore = `${d.oreMax}h`
    return d.liberaDa > inizioLavaggio
      ? `${nome} - libera dalle ${oraRoma(d.liberaDa)} per ${ore}`
      : `${nome} - libera ${ore}`
  }

  const opzioni = autoScelta
    ? (autoScelta.scheda.price_options || [])
      .map(o => ({ o, ore: oreDaEtichetta(o.label) }))
      .filter((x): x is { o: { label: string; price: number }; ore: number } => x.ore !== null)
      .sort((a, b) => a.ore - b.ore)
    : []

  return (
    <div className="space-y-3">
      {/* Passo 1: servizio */}
      <div className="flex flex-wrap gap-1.5">
        {schedeConAuto.map(sc => {
          const attiva = schedaId === sc.id
          return (
            <button
              key={sc.id}
              type="button"
              onClick={() => {
                if (attiva) return
                setSchedaId(sc.id)
                setVeicoloId('')
                if (scelta) onScelta(null)
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                attiva
                  ? 'bg-emerald-500 text-black border-emerald-500'
                  : 'bg-theme-bg-secondary text-theme-text-secondary border-theme-border hover:border-emerald-500'
              }`}
            >
              {sc.name}
            </button>
          )
        })}
      </div>

      {schedaId && (
        <>
          {/* Passo 2: auto, menu a tendina come nel noleggio */}
          <div>
            <label className="block text-xs font-medium text-theme-text-secondary mb-1">
              Auto disponibile (lavaggio alle {ora}, ultima riconsegna {chiusura.ora})
            </label>
            <select
              value={veicoloId}
              onChange={e => {
                setVeicoloId(e.target.value)
                if (scelta) onScelta(null)
              }}
              className="w-full px-3 py-2 rounded-lg bg-theme-bg-secondary border border-theme-border text-sm text-theme-text-primary"
            >
              <option value="">- Seleziona auto -</option>
              {autoDellaScheda.map(p => (
                <option key={p.veicolo.id} value={p.veicolo.id} disabled={p.disponibilita.liberaDa === null}>
                  {etichettaAuto(p)}
                </option>
              ))}
            </select>
            {autoDellaScheda.length > 0 && autoDellaScheda.every(p => p.disponibilita.liberaDa === null) && (
              <p className="mt-1 text-xs text-rose-500">Nessuna auto di questa categoria e' libera in questa giornata.</p>
            )}
          </div>

          {/* Passo 3: ore */}
          {autoScelta && autoScelta.disponibilita.liberaDa !== null && (
            <div>
              <label className="block text-xs font-medium text-theme-text-secondary mb-1">Durata</label>
              <div className="flex flex-wrap gap-1.5">
                {opzioni.map(({ o, ore }) => {
                  const d = autoScelta.disponibilita
                  const possibile = ore <= d.oreMax
                  const attivo = scelta?.veicolo.id === autoScelta.veicolo.id && scelta?.ore === ore
                  return (
                    <button
                      key={o.label}
                      type="button"
                      disabled={!possibile}
                      title={possibile ? `Dalle ${oraRoma(d.liberaDa!)} alle ${oraRoma(d.liberaDa! + ore * 3600_000)}` : 'Auto non libera per tutte queste ore'}
                      onClick={() => onScelta(attivo ? null : {
                        veicolo: autoScelta.veicolo, scheda: autoScelta.scheda, opzione: o, ore,
                        inizio: new Date(d.liberaDa!).toISOString(),
                        fine: new Date(d.liberaDa! + ore * 3600_000).toISOString(),
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
              {scelta && scelta.veicolo.id === autoScelta.veicolo.id && (
                <p className="mt-2 text-xs text-emerald-600">
                  Noleggio {scelta.veicolo.display_name}: dalle {oraRoma(new Date(scelta.inizio).getTime())} alle {oraRoma(new Date(scelta.fine).getTime())}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
