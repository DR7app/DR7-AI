import { useEffect, useRef, useState } from 'react'
import AddressAutocomplete from './AddressAutocomplete'
import Button from './Button'
import MoneyInput from '../../../components/MoneyInput'
import { calcolaTratte, totaliItinerario, formattaDurata, tappaValida, type Tappa, type ItinerarioValore } from '../../../utils/itinerario'

interface Props {
    valore: ItinerarioValore
    onChange: (v: ItinerarioValore) => void
    /** Tariffa €/km della Centralina Pro per la categoria del mezzo (null = non configurata). */
    tariffaCentralina: number | null
}

function nuovaTappa(): Tappa {
    return { id: crypto.randomUUID(), indirizzo: '' }
}

/**
 * Itinerario a tappe del preventivo: punto 1 → punto 2 → punto 3 …
 *
 * Ogni tappa e' un indirizzo cercato dalla tendina (serve per avere le
 * coordinate). Appena due tappe consecutive hanno le coordinate, il blocco
 * chiede a OSRM i km su strada e il tempo di percorrenza di ogni tratta e
 * moltiplica i km totali per la tariffa €/km — che parte da quella della
 * consegna a domicilio in Centralina Pro e resta correggibile a mano.
 */
export default function ItinerarioTappe({ valore, onChange, tariffaCentralina }: Props) {
    const [calcolo, setCalcolo] = useState(false)
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange

    const tappe = valore.tappe || []
    // La tariffa vera e' quella salvata sul preventivo; finche' l'operatore non
    // la tocca segue la Centralina Pro. Appena la scrive a mano (zero compreso,
    // = itinerario incluso nel prezzo) comanda la sua.
    const tariffa = valore.tariffa_manuale ? valore.prezzo_per_km : (tariffaCentralina ?? valore.prezzo_per_km ?? 0)

    // Chiave delle sole coordinate: il ricalcolo parte quando cambia un punto
    // dell'itinerario, non a ogni lettera digitata nel campo indirizzo.
    const chiaveCoordinate = tappe.map(t => (tappaValida(t) ? `${t.lat},${t.lon}` : 'x')).join('|')

    useEffect(() => {
        let annullato = false
        const posizionate = tappe.filter(tappaValida)
        if (posizionate.length < 2) {
            // Meno di due punti = nessuna tratta: azzeriamo km/tempo/costo ma
            // teniamo le tappe scritte.
            if (valore.km !== 0 || valore.minuti !== 0 || (valore.tratte || []).length > 0) {
                onChangeRef.current({ ...valore, tratte: [], km: 0, minuti: 0, costo: 0, stimato: false })
            }
            return
        }
        setCalcolo(true)
        void calcolaTratte(tappe).then(tratte => {
            if (annullato) return
            const tot = totaliItinerario(tratte)
            const tariffaOra = valore.tariffa_manuale ? valore.prezzo_per_km : (tariffaCentralina ?? valore.prezzo_per_km ?? 0)
            onChangeRef.current({
                ...valore,
                tratte,
                km: tot.km,
                minuti: tot.minuti,
                stimato: tot.stimato,
                prezzo_per_km: tariffaOra,
                costo: Math.round(tot.km * tariffaOra * 100) / 100,
            })
            setCalcolo(false)
        })
        return () => { annullato = true; setCalcolo(false) }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chiaveCoordinate])

    // La tariffa cambia (a mano o dalla Centralina): il costo si riallinea
    // senza rifare il giro di rete.
    useEffect(() => {
        const atteso = Math.round((valore.km || 0) * tariffa * 100) / 100
        if (atteso !== valore.costo || valore.prezzo_per_km !== tariffa) {
            onChangeRef.current({ ...valore, prezzo_per_km: tariffa, costo: atteso })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tariffa, valore.km])

    function aggiornaTappa(id: string, patch: Partial<Tappa>) {
        onChange({ ...valore, tappe: tappe.map(t => (t.id === id ? { ...t, ...patch } : t)) })
    }

    function aggiungi() {
        // Il primo click apre due campi: un itinerario parte sempre da due punti.
        const daAggiungere = tappe.length === 0 ? [nuovaTappa(), nuovaTappa()] : [nuovaTappa()]
        onChange({ ...valore, tappe: [...tappe, ...daAggiungere] })
    }

    function rimuovi(id: string) {
        onChange({ ...valore, tappe: tappe.filter(t => t.id !== id) })
    }

    function sposta(indice: number, verso: -1 | 1) {
        const destinazione = indice + verso
        if (destinazione < 0 || destinazione >= tappe.length) return
        const copia = [...tappe]
        const [presa] = copia.splice(indice, 1)
        copia.splice(destinazione, 0, presa)
        onChange({ ...valore, tappe: copia })
    }

    return (
        <div className="border border-dr7-gold/30 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h4 className="text-sm font-semibold text-theme-text-primary">Itinerario a tappe</h4>
                    <p className="text-[11px] text-theme-text-muted">
                        Punto 1 → punto 2 → punto 3: km su strada, tempo di percorrenza e costo al km.
                    </p>
                </div>
                <Button type="button" variant="secondary" onClick={aggiungi} className="shrink-0">
                    + Tappa
                </Button>
            </div>

            {tappe.length === 0 && (
                <p className="text-xs text-theme-text-muted">
                    Nessuna tappa. Aggiungi il punto di partenza e le destinazioni.
                </p>
            )}

            {tappe.map((t, i) => {
                const tratta = valore.tratte?.[i]
                const trattaVisibile = i < tappe.length - 1 && tappaValida(t) && tappaValida(tappe[i + 1])
                return (
                    <div key={t.id} className="space-y-2">
                        <div className="flex items-end gap-2">
                            <div className="w-7 h-9 flex items-center justify-center text-xs font-semibold text-dr7-gold shrink-0">
                                {i + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                                <AddressAutocomplete
                                    label={i === 0 ? 'Partenza' : i === tappe.length - 1 ? 'Arrivo' : `Tappa ${i + 1}`}
                                    value={t.indirizzo}
                                    onChange={(v) => aggiornaTappa(t.id, { indirizzo: v })}
                                    placeholder="Es. Aeroporto di Cagliari-Elmas"
                                    onSelectParts={(parts) => aggiornaTappa(t.id, {
                                        indirizzo: parts.full,
                                        lat: parts.lat,
                                        lon: parts.lon,
                                    })}
                                />
                            </div>
                            <div className="flex gap-1 shrink-0 pb-1">
                                <button
                                    type="button"
                                    onClick={() => sposta(i, -1)}
                                    disabled={i === 0}
                                    title="Sposta su"
                                    className="w-9 h-9 rounded border border-theme-border text-theme-text-muted hover:text-theme-text-primary disabled:opacity-30"
                                >
                                    ↑
                                </button>
                                <button
                                    type="button"
                                    onClick={() => sposta(i, 1)}
                                    disabled={i === tappe.length - 1}
                                    title="Sposta giù"
                                    className="w-9 h-9 rounded border border-theme-border text-theme-text-muted hover:text-theme-text-primary disabled:opacity-30"
                                >
                                    ↓
                                </button>
                                <button
                                    type="button"
                                    onClick={() => rimuovi(t.id)}
                                    title="Rimuovi tappa"
                                    className="w-9 h-9 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10"
                                >
                                    ×
                                </button>
                            </div>
                        </div>

                        {!tappaValida(t) && t.indirizzo.length > 0 && (
                            <div className="ml-9 text-[11px] text-amber-400">
                                Scegli l'indirizzo dai suggerimenti: senza il punto sulla mappa non si calcolano km e tempo.
                            </div>
                        )}

                        {trattaVisibile && (
                            <div className="ml-9 flex items-center gap-3 text-[11px] text-theme-text-muted border-l border-dashed border-dr7-gold/30 pl-3 py-1">
                                <span className="tabular-nums text-theme-text-primary font-medium">
                                    {tratta ? `${tratta.km} km` : '…'}
                                </span>
                                <span className="tabular-nums">
                                    {tratta ? formattaDurata(tratta.minuti) : ''}
                                </span>
                                {tratta?.stimato && <span className="text-amber-400">stima</span>}
                            </div>
                        )}
                    </div>
                )
            })}

            {tappe.filter(tappaValida).length >= 2 && (
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-2 border-t border-theme-border">
                    <div className="bg-theme-bg-tertiary/40 border border-theme-border rounded px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Totale km</div>
                        <div className="font-semibold text-sm text-theme-text-primary tabular-nums">
                            {calcolo ? '…' : `${valore.km} km`}
                        </div>
                    </div>
                    <div className="bg-theme-bg-tertiary/40 border border-theme-border rounded px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Tempo stimato</div>
                        <div className="font-semibold text-sm text-theme-text-primary tabular-nums">
                            {calcolo ? '…' : formattaDurata(valore.minuti)}
                        </div>
                        <div className="text-[10px] text-theme-text-muted mt-0.5">
                            senza soste e traffico
                        </div>
                    </div>
                    <div>
                        <label className="block text-[10px] uppercase tracking-wider text-theme-text-muted mb-1">
                            Tariffa €/km
                        </label>
                        <MoneyInput
                            value={valore.prezzo_per_km || ''}
                            onChange={(v) => {
                                const n = parseFloat(v) || 0
                                onChange({
                                    ...valore,
                                    prezzo_per_km: n,
                                    tariffa_manuale: true,
                                    costo: Math.round((valore.km || 0) * n * 100) / 100,
                                })
                            }}
                            placeholder="0,00"
                        />
                    </div>
                    <div className="bg-theme-bg-tertiary/40 border border-theme-border rounded px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Costo itinerario</div>
                        <div className="font-semibold text-sm text-dr7-gold tabular-nums">
                            € {(valore.costo || 0).toFixed(2)}
                        </div>
                        <div className="text-[10px] text-theme-text-muted mt-0.5">
                            {valore.km > 0 && tariffa > 0
                                ? `${valore.km} km × €${tariffa.toFixed(2)}/km`
                                : 'Tariffa non configurata'}
                        </div>
                    </div>
                </div>
            )}

            {valore.stimato && !calcolo && (
                <div className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1">
                    Km e tempi di alcune tratte sono stimati (router stradale non raggiungibile): distanza in linea d'aria +30% e velocità media 70 km/h.
                </div>
            )}
            {tariffaCentralina == null && tappe.length > 0 && (
                <div className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1">
                    Tariffa €/km non configurata per questa categoria in Centralina Pro &gt; Servizi &gt; Consegna a Domicilio: inseriscila a mano qui sopra.
                </div>
            )}
        </div>
    )
}
