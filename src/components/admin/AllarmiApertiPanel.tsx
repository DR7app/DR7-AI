/**
 * Allarmi aperti — cosa sta suonando adesso, chi lo risolve, cosa e' gia' stato
 * risolto e da chi.
 *
 * 2026-08-21 (richiesta direzione). Prima esisteva solo il popup sonoro: si
 * chiudeva e spariva. Il "Posticipa" viveva nel localStorage del browser — un
 * altro operatore, o la stessa persona da un altro computer, non ne sapeva
 * niente — e del "Risolto" non restava traccia di CHI.
 *
 * Qui ogni occorrenza e' una riga di `alarm_events`, condivisa da tutti:
 *   - Risolto  -> chiude, con nome e ora di chi ha chiuso;
 *   - Posticipa -> torna da solo dopo i minuti scelti;
 *   - Non per questa pratica -> spegne l'allarme SOLO su quella prenotazione,
 *     lasciando la regola generale accesa per tutte le altre.
 *
 * La cronologia non e' un extra: e' il motivo per cui la tabella esiste.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { useAdminRole } from '../../hooks/useAdminRole'
import {
    caricaApertiOrdinati,
    disattivaPerPratica,
    posticipaEvento,
    risolviEvento,
    type AlarmEventRow,
} from '../../utils/alarmEngine'
import { PRIORITY_LABEL, PRIORITY_STYLE, type AlarmPriority } from '../../data/alarmCatalog'
import toast from 'react-hot-toast'

/** Data e ora in formato europeo — mai AM/PM. */
function quando(iso: string | null): string {
    if (!iso) return '—'
    const d = new Date(iso)
    if (!Number.isFinite(d.getTime())) return '—'
    return d.toLocaleString('it-IT', {
        timeZone: 'Europe/Rome',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
    })
}

function daQuanto(iso: string): string {
    const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
    if (min < 60) return `${min} min fa`
    const h = Math.floor(min / 60)
    if (h < 24) return `${h} h fa`
    return `${Math.floor(h / 24)} g fa`
}

interface Meta { label: string; reparto: string | null; group_key: string | null }

export default function AllarmiApertiPanel() {
    const { adminName } = useAdminRole()
    const [eventi, setEventi] = useState<AlarmEventRow[]>([])
    const [storico, setStorico] = useState<AlarmEventRow[]>([])
    const [meta, setMeta] = useState<Record<string, Meta>>({})
    const [loading, setLoading] = useState(true)
    const [mostraStorico, setMostraStorico] = useState(false)
    const [inCorso, setInCorso] = useState<string | null>(null)
    const [menuPosticipa, setMenuPosticipa] = useState<string | null>(null)
    // La migration puo' non essere ancora passata: in quel caso niente tabella,
    // e va detto invece di mostrare un elenco vuoto che sembra "tutto a posto".
    const [tabellaMancante, setTabellaMancante] = useState(false)

    const ricarica = useCallback(async () => {
        const { error } = await supabase.from('alarm_events').select('id').limit(1)
        if (error) {
            setTabellaMancante(true)
            setLoading(false)
            return
        }
        setTabellaMancante(false)
        const [aperti, labels] = await Promise.all([
            caricaApertiOrdinati(),
            supabase.from('system_alarms').select('id, label, reparto, group_key'),
        ])
        setEventi(aperti)
        const m: Record<string, Meta> = {}
        for (const r of labels.data || []) {
            m[String(r.id)] = { label: String(r.label), reparto: r.reparto ?? null, group_key: r.group_key ?? null }
        }
        setMeta(m)
        setLoading(false)
    }, [])

    const ricaricaStorico = useCallback(async () => {
        const { data } = await supabase
            .from('alarm_events')
            .select('*')
            .eq('stato', 'risolto')
            .order('risolto_at', { ascending: false })
            .range(0, 99)
        setStorico((data || []) as AlarmEventRow[])
    }, [])

    useEffect(() => {
        ricarica()
        // 01/09/2026 - niente `setInterval(ricarica, 60_000)`: rifaceva ogni
        // minuto esattamente le letture che la sottoscrizione qui sotto gia'
        // porta appena qualcosa cambia. Il pannello resta vivo in tempo reale,
        // ma smette di ricaricarsi da solo quando non e' successo niente.
        const sub = supabase
            .channel('alarm-events-live')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'alarm_events' }, () => ricarica())
            .subscribe()
        return () => { sub.unsubscribe() }
    }, [ricarica])

    useEffect(() => { if (mostraStorico) ricaricaStorico() }, [mostraStorico, ricaricaStorico])

    const perPriorita = useMemo(() => {
        const out: Record<AlarmPriority, AlarmEventRow[]> = {
            bloccante: [], urgente: [], attenzione: [], informativo: [],
        }
        for (const e of eventi) (out[e.priority] || out.informativo).push(e)
        return out
    }, [eventi])

    const azione = async (id: string, fn: () => Promise<unknown>, ok: string) => {
        setInCorso(id)
        try {
            await fn()
            toast.success(ok)
            await ricarica()
        } catch (e) {
            toast.error('Operazione fallita: ' + (e instanceof Error ? e.message : String(e)))
        } finally {
            setInCorso(null)
            setMenuPosticipa(null)
        }
    }

    if (tabellaMancante) {
        return (
            <div className="bg-theme-bg-primary border border-theme-border rounded-2xl p-5">
                <p className="text-sm text-amber-700 dark:text-amber-300">
                    <strong>Registro allarmi non installato.</strong> Esegui la migration{' '}
                    <code className="bg-theme-bg-tertiary px-1 rounded">20260821_alarm_engine.sql</code> in Supabase.
                    Finche&apos; non gira, gli allarmi storici continuano a funzionare con il popup di sempre,
                    ma non c&apos;e&apos; nessun registro di chi risolve cosa.
                </p>
            </div>
        )
    }

    const Riga = ({ e }: { e: AlarmEventRow }) => {
        const m = meta[e.alarm_id]
        const stile = PRIORITY_STYLE[e.priority] || PRIORITY_STYLE.attenzione
        const busy = inCorso === e.id
        return (
            <li className={`rounded-xl border ${stile.chip} px-4 py-3`}>
                <div className="flex items-start gap-3">
                    <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${stile.dot}`} />
                    <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="text-[13px] font-semibold text-theme-text-primary">
                                {m?.label || e.alarm_id}
                            </span>
                            <span className={`text-[10px] font-semibold uppercase tracking-wider ${stile.text}`}>
                                {PRIORITY_LABEL[e.priority]}
                            </span>
                            {m?.reparto && <span className="text-[10px] text-theme-text-muted">· {m.reparto}</span>}
                        </div>
                        <div className="text-[12px] text-theme-text-secondary mt-0.5">{e.entita || '—'}</div>
                        {e.nota && <div className="text-[11px] text-theme-text-muted mt-0.5">{e.nota}</div>}
                        <div className="text-[10px] text-theme-text-muted mt-1">
                            {quando(e.triggered_at)} · {daQuanto(e.triggered_at)}
                            {e.ripetizioni > 0 && ` · ripetuto ${e.ripetizioni} volte`}
                            {e.stato === 'posticipato' && ` · posticipato alle ${quando(e.posticipato_a)}`}
                        </div>
                    </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5">
                    <div className="relative">
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => setMenuPosticipa(menuPosticipa === e.id ? null : e.id)}
                            className="px-3 py-1.5 rounded-full text-[11px] font-semibold bg-theme-bg-tertiary text-theme-text-secondary hover:text-theme-text-primary disabled:opacity-50"
                        >
                            Posticipa
                        </button>
                        {menuPosticipa === e.id && (
                            <div className="absolute right-0 bottom-full mb-1 z-20 rounded-lg border border-theme-border bg-theme-bg-primary shadow-xl overflow-hidden">
                                {[15, 30, 60, 120].map(min => (
                                    <button
                                        key={min}
                                        type="button"
                                        onClick={() => azione(e.id, () => posticipaEvento(e.id, min), `Rimandato di ${min} minuti`)}
                                        className="block w-full px-4 py-1.5 text-left text-[11px] text-theme-text-secondary hover:bg-theme-bg-tertiary hover:text-theme-text-primary whitespace-nowrap"
                                    >
                                        {min} minuti
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => azione(
                            e.id,
                            () => disattivaPerPratica(e.alarm_id, e.booking_id, e.vehicle_id, `Escluso da ${adminName || 'operatore'}`)
                                .then(() => risolviEvento(e.id, adminName || 'Operatore', 'Allarme escluso per questa pratica')),
                            'Non suonera\u2019 piu\u2019 per questa pratica',
                        )}
                        className="px-3 py-1.5 rounded-full text-[11px] font-semibold bg-theme-bg-tertiary text-theme-text-secondary hover:text-theme-text-primary disabled:opacity-50"
                        title="Spegne questo allarme solo per questa pratica: la regola generale resta accesa"
                    >
                        Non per questa pratica
                    </button>
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => azione(e.id, () => risolviEvento(e.id, adminName || 'Operatore'), 'Segnato come risolto')}
                        className="px-3 py-1.5 rounded-full text-[11px] font-semibold bg-dr7-gold text-white hover:opacity-90 disabled:opacity-50"
                    >
                        {busy ? 'Attendere...' : 'Risolto'}
                    </button>
                </div>
            </li>
        )
    }

    return (
        <div className="bg-theme-bg-primary border border-theme-border rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-theme-border flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h2 className="text-base font-semibold text-theme-text-primary">Allarmi aperti</h2>
                    <p className="text-xs text-theme-text-muted">
                        {loading ? 'Caricamento...' : `${eventi.length} da gestire · aggiornamento ogni 60 secondi`}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => setMostraStorico(v => !v)}
                    className="px-3 py-1.5 rounded-full text-[11px] font-semibold bg-theme-bg-tertiary text-theme-text-secondary hover:text-theme-text-primary"
                >
                    {mostraStorico ? 'Nascondi cronologia' : 'Cronologia risolti'}
                </button>
            </div>

            <div className="px-5 py-4 space-y-5">
                {!loading && eventi.length === 0 && (
                    <p className="text-sm text-theme-text-muted">
                        Nessun allarme aperto. Quando una condizione scatta compare qui, con il pulsante per
                        risolverla o rimandarla.
                    </p>
                )}

                {(['bloccante', 'urgente', 'attenzione', 'informativo'] as AlarmPriority[]).map(p => {
                    const lista = perPriorita[p]
                    if (!lista || lista.length === 0) return null
                    return (
                        <section key={p}>
                            <h3 className={`text-[11px] font-bold uppercase tracking-[0.18em] mb-2 ${PRIORITY_STYLE[p].text}`}>
                                {PRIORITY_LABEL[p]} · {lista.length}
                            </h3>
                            <ul className="space-y-2">
                                {lista.map(e => <Riga key={e.id} e={e} />)}
                            </ul>
                        </section>
                    )
                })}

                {mostraStorico && (
                    <section className="pt-2 border-t border-theme-border">
                        <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-theme-text-muted mb-2">
                            Risolti di recente
                        </h3>
                        {storico.length === 0 ? (
                            <p className="text-xs text-theme-text-muted">Ancora nessun allarme risolto.</p>
                        ) : (
                            <ul className="space-y-1.5">
                                {storico.map(e => (
                                    <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-theme-text-muted border-b border-theme-border/40 pb-1.5">
                                        <span className="text-theme-text-secondary font-medium">{meta[e.alarm_id]?.label || e.alarm_id}</span>
                                        <span>· {e.entita || '—'}</span>
                                        <span>· risolto da {e.risolto_da_nome || 'sconosciuto'}</span>
                                        <span>il {quando(e.risolto_at)}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                )}
            </div>
        </div>
    )
}
