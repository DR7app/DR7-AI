/**
 * Estensione di una prenotazione — Mare, Aria, Soggiorni (roadmap #11).
 *
 * Il Noleggio Terra ha l'estensione da sempre; gli altri business no, e nel
 * menu "Gestisci" era l'unica voce che mancava.
 *
 * FORMA DEI DATI IDENTICA A TERRA, e non e' un dettaglio estetico: la voce
 * `booking_details.extension_history[]` viene letta dalle fatture
 * (generate-invoice-from-booking itemizza le estensioni pending), dal Report
 * Noleggio e dal calcolo dei giorni. Una struttura diversa avrebbe prodotto
 * estensioni invisibili in fattura e nei report, senza alcun errore.
 *
 * Cosa NON c'e' rispetto a Terra, di proposito:
 *   - cambio veicolo: su una barca o un elicottero non si "cambia mezzo" a
 *     meta' noleggio come si fa con un'auto di scorta;
 *   - km e pacchetti chilometrici: una barca non fa chilometri (e' anche il
 *     motivo per cui la sezione Km & Sforo e' nascosta su questi business).
 * Il resto — date, importo, stato e metodo di pagamento, note, riconduzione
 * del contratto — e' lo stesso.
 */
import { useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { authFetch } from '../../../utils/authFetch'
import { logAdminAction } from '../../../utils/logAdminAction'
import EuropeanDateInput from '../../../components/EuropeanDateInput'
import TimeSelect from './TimeSelect'
import { usePaymentMethods } from '../../../hooks/usePaymentMethods'
import { INPUT_CLS, eurToCents, centsToEur, toRomeIso } from './noleggioFormBits'
import type { BookingLike } from './useBookingRowActions'

interface Props {
    booking: BookingLike & { dropoff_date?: string | null }
    serviceType: string
    /** Etichetta del mezzo per i testi ("Barca", "Elicottero", "Alloggio"). */
    assetLabel: string
    onClose: () => void
    onSaved: () => void
}

export default function ExtendBookingModal({ booking, serviceType, assetLabel, onClose, onSaved }: Props) {
    const paymentMethods = usePaymentMethods(serviceType)

    // Data e ora attuali di riconsegna, in ora di Roma: e' il punto di partenza
    // che l'operatore vede, non una data vuota da ricompilare.
    const attuale = booking.dropoff_date ? new Date(booking.dropoff_date) : null
    const [data, setData] = useState(
        attuale ? attuale.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }) : '',
    )
    const [ora, setOra] = useState(
        attuale ? attuale.toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false }) : '',
    )
    const [importo, setImporto] = useState('')
    const [statoPagamento, setStatoPagamento] = useState<'pending' | 'paid'>('pending')
    const [metodo, setMetodo] = useState('')
    const [note, setNote] = useState('')
    const [salvando, setSalvando] = useState(false)
    const [errore, setErrore] = useState('')

    const importoCents = eurToCents(importo)
    const totaleAttuale = Number(booking.price_total || 0)
    const nuovoTotale = totaleAttuale + importoCents

    async function salva() {
        setErrore('')
        if (!data || !ora) { setErrore('Indica data e ora della nuova riconsegna.'); return }
        const nuovaIso = toRomeIso(data, ora)
        if (!nuovaIso) { setErrore('Data non valida.'); return }
        if (attuale && new Date(nuovaIso) <= attuale) {
            setErrore('La nuova riconsegna deve essere successiva a quella attuale.')
            return
        }
        if (statoPagamento === 'paid' && !metodo) {
            setErrore('Indica con quale metodo è stata pagata l\'estensione.')
            return
        }

        setSalvando(true)
        try {
            const dettagli = {
                ...(booking.booking_details || {}),
                extension_history: [
                    ...((booking.booking_details?.extension_history as unknown[]) || []),
                    {
                        extended_at: new Date().toISOString(),
                        previous_dropoff: booking.dropoff_date,
                        new_dropoff: nuovaIso,
                        // Euro, come su Terra: chi legge extension_history si
                        // aspetta euro, non centesimi.
                        additional_amount: importoCents / 100,
                        payment_status: statoPagamento,
                        payment_method: metodo || undefined,
                        notes: note.trim() || undefined,
                    },
                ],
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const update: Record<string, any> = {
                dropoff_date: nuovaIso,
                price_total: nuovoTotale,
                booking_details: dettagli,
                updated_at: new Date().toISOString(),
            }

            let { error } = await supabase.from('bookings').update(update).eq('id', booking.id)

            // Estendere la riconsegna puo' sovrapporre la prenotazione a una
            // successiva dello stesso mezzo: il trigger DB solleva
            // CONFLICT_DOUBLE_BOOKING. La direzione vuole estendere comunque,
            // come sul Noleggio Terra: si riprova con allow_double_booking.
            const conflitto = !!error && ((error as { code?: string }).code === '23505' || /CONFLICT_DOUBLE_BOOKING/i.test(error.message || ''))
            if (conflitto) {
                const forzato = { ...update, booking_details: { ...dettagli, allow_double_booking: true } }
                const retry = await supabase.from('bookings').update(forzato).eq('id', booking.id)
                error = retry.error
                if (!error) toast('Sovrapposizione con un\'altra prenotazione: estesa comunque.', { icon: '⚠️' })
            }
            if (error) { setErrore(error.message); setSalvando(false); return }

            // Riconduzione del contratto: se era gia' firmato, la firma viene
            // ristampata sulle nuove date invece di chiederne una nuova.
            // Best-effort — un contratto non aggiornato non deve far fallire
            // l'estensione, che a questo punto e' gia' salvata.
            try {
                await authFetch('/.netlify/functions/generate-contract', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ bookingId: booking.id, reconduct: true, motivo: 'estensione' }),
                })
            } catch { /* ignore */ }

            logAdminAction('extend_booking', 'booking', booking.id, {
                business: serviceType,
                nuova_riconsegna: `${data} ${ora}`,
                importo: (importoCents / 100).toFixed(2),
                stato_pagamento: statoPagamento,
            })
            toast.success('Prenotazione estesa')
            onSaved()
        } catch (e) {
            setErrore((e as Error).message)
        } finally {
            setSalvando(false)
        }
    }

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
            <div className="bg-theme-bg-secondary border border-theme-border rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="px-5 py-4 border-b border-theme-border">
                    <h3 className="text-lg font-bold text-theme-text-primary">Estendi prenotazione</h3>
                    <p className="text-xs text-theme-text-muted mt-0.5">
                        {booking.customer_name || 'Cliente'} · {booking.vehicle_name || assetLabel}
                    </p>
                </div>

                <div className="p-5 space-y-4">
                    {attuale && (
                        <div className="text-xs text-theme-text-muted">
                            Riconsegna attuale:{' '}
                            <span className="text-theme-text-primary font-semibold">
                                {attuale.toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-theme-text-muted">Nuova data riconsegna</label>
                            <EuropeanDateInput className={INPUT_CLS} value={data} onChange={(v: string) => setData(v)} />
                        </div>
                        <TimeSelect label="Nuova ora" value={ora} dateStr={data} kind="return" onChange={setOra} serviceType={serviceType} />
                    </div>

                    <div>
                        <label className="text-xs text-theme-text-muted">Importo aggiuntivo (€)</label>
                        <input
                            className={INPUT_CLS}
                            inputMode="decimal"
                            placeholder="0,00"
                            value={importo}
                            onChange={e => setImporto(e.target.value)}
                        />
                        <p className="mt-1 text-[11px] text-theme-text-muted">
                            Totale prenotazione: {centsToEur(totaleAttuale)} € → <span className="text-theme-text-primary font-semibold">{centsToEur(nuovoTotale)} €</span>
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-theme-text-muted">Stato pagamento</label>
                            <select className={INPUT_CLS} value={statoPagamento} onChange={e => setStatoPagamento(e.target.value as 'pending' | 'paid')}>
                                <option value="pending">Da saldare</option>
                                <option value="paid">Pagata</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-xs text-theme-text-muted">Metodo di pagamento</label>
                            <select className={INPUT_CLS} value={metodo} onChange={e => setMetodo(e.target.value)} disabled={statoPagamento !== 'paid'}>
                                <option value="">— seleziona —</option>
                                {paymentMethods.map(m => <option key={m.key} value={m.label}>{m.label}</option>)}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="text-xs text-theme-text-muted">Note</label>
                        <textarea className={INPUT_CLS} rows={2} value={note} onChange={e => setNote(e.target.value)} />
                    </div>

                    {errore && <p className="text-xs text-red-400 font-semibold">{errore}</p>}
                </div>

                <div className="px-5 py-4 border-t border-theme-border flex justify-end gap-2">
                    <button onClick={onClose} disabled={salvando} className="px-3 py-1.5 rounded-lg border border-theme-border text-theme-text-secondary text-sm hover:bg-theme-bg-hover">
                        Annulla
                    </button>
                    <button onClick={salva} disabled={salvando} className="px-4 py-2 rounded-full bg-dr7-gold text-white text-sm font-semibold disabled:opacity-50">
                        {salvando ? 'Salvataggio…' : 'Estendi'}
                    </button>
                </div>
            </div>
        </div>
    )
}
