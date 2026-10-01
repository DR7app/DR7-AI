/**
 * EMTN — I MIEI EVENTI (01/10/2026).
 *
 * Tutte le posizioni EMTN dell'azienda, visibili a ogni operatore, in ogni fase:
 * in coda approvazione, integrazione richiesta, pubblicate, rifiutate.
 * Prima era un segnaposto: la pratica finiva in "Da approvare" ma qui
 * non si vedeva nulla. "Apri" carica il cliente nella Ricerca, dove si
 * aggiorna la posizione o si registra la risposta del cliente.
 */
import { useEffect, useState } from 'react'
import { authFetch } from '../../../../utils/authFetch'
import { categoriaEMTN, etichettaStato, type EventoEMTN } from '../../../../utils/emtnMobilityRisk'
import EMTNDocumenti, { type DocumentoPratica } from './EMTNDocumenti'

export interface PosizioneMia {
    id: string
    client_id: string
    stato: string
    titolo: string
    report: string
    eventi: EventoEMTN[]
    esito_verifica: string | null
    in_approvazione: boolean
    pubblicata: boolean
    decisione: string | null
    nota_revisione: string | null
    revisione_legale: boolean
    inviata_at: string | null
    inviata_da: string | null
    approvata_at: string | null
    approvata_da: string | null
    updated_at: string
    created_at: string
    documenti?: DocumentoPratica[]
    emtn_clients: { codice_fiscale: string; nome: string | null; cognome: string | null } | null
}

export interface MieiEventiRisposta {
    posizioni: PosizioneMia[]
    codaDirezione: number | null
}

export async function caricaMieiEventi(): Promise<MieiEventiRisposta> {
    const res = await authFetch('/.netlify/functions/emtn-pratica', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ azione: 'mie' }) })
    const j = await res.json().catch(() => ({})) as Partial<MieiEventiRisposta> & { error?: string }
    if (!res.ok) throw new Error(j.error || 'Eventi non disponibili')
    return { posizioni: j.posizioni || [], codaDirezione: j.codaDirezione ?? null }
}

const dataOra = (v: string | null) => v ? new Date(v).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'

export function faseMia(p: PosizioneMia): { testo: string; cls: string } {
    if (p.in_approvazione) return { testo: 'In coda approvazione', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' }
    if (p.pubblicata) return { testo: 'Pubblicata nella rete', cls: 'bg-green-500/10 text-green-700 dark:text-green-300' }
    if (p.decisione === 'rifiuta') return { testo: 'Rifiutata', cls: 'bg-red-500/10 text-red-700 dark:text-red-300' }
    if (p.decisione === 'integrazione') return { testo: 'Integrazione richiesta', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' }
    if (p.decisione === 'sospendi') return { testo: 'Sospesa', cls: 'bg-theme-bg-tertiary text-theme-text-secondary' }
    return { testo: 'Non pubblicata', cls: 'bg-theme-bg-tertiary text-theme-text-secondary' }
}

type Filtro = 'tutte' | 'coda' | 'azione' | 'pubblicate'

export default function EMTNMieiEventi({ onApri }: { onApri: (cf: string) => void }) {
    const [dati, setDati] = useState<MieiEventiRisposta | null>(null)
    const [errore, setErrore] = useState<string | null>(null)
    const [filtro, setFiltro] = useState<Filtro>('tutte')

    async function carica() {
        try {
            setDati(await caricaMieiEventi())
            setErrore(null)
        } catch (e) {
            setErrore(e instanceof Error ? e.message : 'Eventi non disponibili')
        }
    }
    useEffect(() => { carica() }, [])

    if (errore) return <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-6 text-sm text-theme-text-secondary">{errore}</div>
    if (!dati) return <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-6 text-sm text-theme-text-muted">Caricamento…</div>

    const daCompletare = (p: PosizioneMia) => !p.in_approvazione && (p.decisione === 'integrazione' || p.decisione === 'sospendi')
    const visibili = dati.posizioni.filter(p =>
        filtro === 'coda' ? p.in_approvazione
            : filtro === 'azione' ? daCompletare(p)
            : filtro === 'pubblicate' ? p.pubblicata && !p.in_approvazione
            : true)
    const filtri: Array<{ id: Filtro; label: string; n: number }> = [
        { id: 'tutte', label: 'Tutte', n: dati.posizioni.length },
        { id: 'coda', label: 'In coda approvazione', n: dati.posizioni.filter(p => p.in_approvazione).length },
        { id: 'azione', label: 'Da completare', n: dati.posizioni.filter(daCompletare).length },
        { id: 'pubblicate', label: 'Pubblicate', n: dati.posizioni.filter(p => p.pubblicata && !p.in_approvazione).length },
    ]

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-theme-text-primary">I miei eventi <span className="text-theme-text-muted font-normal">({dati.posizioni.length})</span></h2>
                <button type="button" onClick={carica} className="px-3 py-1.5 rounded-lg border border-theme-border text-xs text-theme-text-primary hover:bg-theme-bg-hover">Aggiorna</button>
            </div>
            <div className="flex flex-wrap gap-1.5">
                {filtri.map(f => (
                    <button key={f.id} type="button" onClick={() => setFiltro(f.id)}
                        className={'px-2.5 py-1 rounded-lg border text-[11px] ' + (filtro === f.id
                            ? 'border-theme-text-primary bg-theme-bg-tertiary text-theme-text-primary font-semibold'
                            : 'border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover')}>
                        {f.label} ({f.n})
                    </button>
                ))}
            </div>
            {visibili.length === 0 && (
                <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-6 text-sm text-theme-text-muted">
                    {dati.posizioni.length === 0 ? 'Nessuna segnalazione EMTN inviata.' : 'Nessuna segnalazione in questo filtro.'}
                </div>
            )}
            {visibili.map(p => {
                const f = faseMia(p)
                const c = p.emtn_clients
                return (
                    <section key={p.id} className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                                <p className="text-sm font-semibold text-theme-text-primary">{p.titolo || 'Senza titolo'}</p>
                                <p className="text-[11px] text-theme-text-muted">
                                    {c ? `${c.nome || ''} ${c.cognome || ''}`.trim() || '—' : '—'} · {c?.codice_fiscale || '—'} · inviata da {p.inviata_da || '—'} il {dataOra(p.inviata_at)}{p.approvata_at ? ` · approvata da ${p.approvata_da || '—'} il ${dataOra(p.approvata_at)}` : ''}
                                </p>
                            </div>
                            <div className="flex flex-wrap gap-1.5 text-[10px] font-semibold">
                                <span className="rounded-full border border-theme-border px-2 py-0.5 text-theme-text-secondary">{etichettaStato(p.stato)}</span>
                                <span className={`rounded-full px-2 py-0.5 ${f.cls}`}>{f.testo}</span>
                                {p.revisione_legale && <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-red-700 dark:text-red-300">Revisione legale</span>}
                            </div>
                        </div>
                        <p className="text-[11px] text-theme-text-muted mt-1">
                            {p.eventi.map(e => categoriaEMTN(e.codice)?.label).filter(Boolean).join(' · ') || 'Nessun evento'}
                        </p>
                        {p.nota_revisione && <p className="text-[11px] text-theme-text-secondary mt-1">Nota EMTN: {p.nota_revisione}</p>}
                        <EMTNDocumenti posizioneId={p.id} documenti={p.documenti || []} />
                        {c?.codice_fiscale && (
                            <button type="button" onClick={() => onApri(c.codice_fiscale)}
                                className="mt-2 px-2.5 py-1 rounded-lg border border-theme-border text-[11px] text-theme-text-primary hover:bg-theme-bg-hover">
                                Apri il cliente
                            </button>
                        )}
                    </section>
                )
            })}
        </div>
    )
}
