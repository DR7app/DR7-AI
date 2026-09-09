import { useState } from 'react'
import MoneyInput from './MoneyInput'
import {
    GARANZIE,
    type KaskoUnaVolta,
    type VoceFranchigia,
} from '../utils/kaskoUnaVolta'

/**
 * "Modifica" accanto alla Kasko scelta: prezzo e franchigie concordati per
 * QUESTA volta. Non tocca Centralina Pro — il listino resta quello per tutti
 * gli altri clienti — e viaggia con la prenotazione, cosi' il contratto stampa
 * quello che il cliente ha davvero accettato.
 */
export default function ModificaKaskoModal({
    opzioneId,
    opzioneNome,
    prezzoListino,
    franchigiaListino,
    scopertoListino,
    valore,
    onSalva,
    onClose,
}: {
    opzioneId: string
    opzioneNome: string
    prezzoListino: number
    franchigiaListino?: number | ''
    scopertoListino?: number | ''
    valore: KaskoUnaVolta | null
    onSalva: (v: KaskoUnaVolta | null) => void
    onClose: () => void
}) {
    const [bozza, setBozza] = useState<KaskoUnaVolta>(() => valore && valore.opzione_id === opzioneId
        ? { ...valore }
        : { opzione_id: opzioneId, opzione_nome: opzioneNome })

    const set = <K extends keyof KaskoUnaVolta>(k: K, v: KaskoUnaVolta[K]) => setBozza(prev => ({ ...prev, [k]: v }))
    const setGaranzia = (k: typeof GARANZIE[number]['chiave'], campo: keyof VoceFranchigia, v: number | '') =>
        setBozza(prev => ({ ...prev, [k]: { ...(prev[k] || { eur: '', perc: '' }), [campo]: v } }))

    const numeroCella = (v: number | '' | undefined, onChange: (n: number | '') => void, segnaposto: string) => (
        <input
            type="text"
            inputMode="decimal"
            value={v === '' || v === undefined ? '' : String(v)}
            placeholder={segnaposto}
            onChange={(e) => {
                const t = e.target.value.replace(',', '.').trim()
                if (t === '') return onChange('')
                const n = Number(t)
                if (Number.isFinite(n)) onChange(n)
            }}
            className="w-24 px-2 py-1.5 rounded-lg border border-theme-border bg-theme-bg-primary text-[13px] text-theme-text-primary text-right placeholder:text-theme-text-muted"
        />
    )

    return (
        <div className="fixed inset-0 bg-theme-overlay backdrop-blur-sm flex items-center justify-center z-[60] p-4">
            <div className="bg-theme-bg-secondary border border-theme-border rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
                <div className="sticky top-0 bg-theme-bg-secondary border-b border-theme-border p-5 flex items-start justify-between gap-4 z-10">
                    <div>
                        <h2 className="text-[18px] font-semibold text-theme-text-primary">Modifica {opzioneNome}</h2>
                        <p className="text-[12px] text-theme-text-muted mt-1">
                            Vale <strong>solo per questa volta</strong>: il listino di Centralina Pro non cambia.
                        </p>
                    </div>
                    <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-primary text-2xl leading-none">&times;</button>
                </div>

                <div className="p-5 space-y-5">
                    <div className="rounded-xl border border-theme-border bg-theme-bg-primary p-4 space-y-3">
                        <h3 className="text-[13px] font-semibold text-theme-text-primary">Prezzo concordato</h3>
                        <div className="flex items-center gap-3">
                            <span className="text-[12px] text-theme-text-secondary w-28">€ / giorno</span>
                            <MoneyInput
                                value={bozza.prezzo_giorno === undefined ? '' : bozza.prezzo_giorno}
                                onChange={(v) => set('prezzo_giorno', v === '' ? '' : Number(v))}
                                placeholder={String(prezzoListino)}
                                className="w-32 px-2 py-1.5 rounded-lg border border-theme-border bg-theme-bg-primary text-[13px] text-theme-text-primary text-right"
                            />
                            <span className="text-[11px] text-theme-text-muted">
                                Listino: €{prezzoListino}/giorno. Vuoto = resta il listino.
                            </span>
                        </div>
                    </div>

                    <div className="rounded-xl border border-theme-border bg-theme-bg-primary p-4 space-y-3">
                        <h3 className="text-[13px] font-semibold text-theme-text-primary">Franchigie del contratto</h3>
                        <p className="text-[11px] text-theme-text-muted">
                            La tabella &quot;Franchigie e assicurazioni&quot; stampata sul contratto: franchigia in euro e
                            scoperto in percentuale. Lasciando vuoto vale quello di Centralina.
                        </p>
                        <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-2 items-center">
                            <span />
                            <span className="text-[11px] uppercase tracking-wide text-theme-text-muted text-right w-24">Franchigia €</span>
                            <span className="text-[11px] uppercase tracking-wide text-theme-text-muted text-right w-24">Scoperto %</span>
                            {GARANZIE.map(g => (
                                <div key={g.chiave} className="contents">
                                    <span className="text-[13px] text-theme-text-primary">{g.label}</span>
                                    {numeroCella(bozza[g.chiave]?.eur, (n) => setGaranzia(g.chiave, 'eur', n), '—')}
                                    {numeroCella(bozza[g.chiave]?.perc, (n) => setGaranzia(g.chiave, 'perc', n), '—')}
                                </div>
                            ))}
                            <span className="text-[13px] text-theme-text-primary">{opzioneNome}</span>
                            {numeroCella(bozza.franchigia_eur, (n) => set('franchigia_eur', n), franchigiaListino === '' || franchigiaListino === undefined ? '—' : String(franchigiaListino))}
                            {numeroCella(bozza.scoperto_perc, (n) => set('scoperto_perc', n), scopertoListino === '' || scopertoListino === undefined ? '—' : String(scopertoListino))}
                        </div>
                    </div>

                    <label className="block">
                        <span className="block text-[11px] font-medium uppercase tracking-wide text-theme-text-muted mb-1">
                            Nota interna (perche&apos; e&apos; stato concordato)
                        </span>
                        <input
                            type="text"
                            value={bozza.nota || ''}
                            onChange={(e) => set('nota', e.target.value)}
                            placeholder="Es. accordo con la direzione, cliente storico"
                            className="w-full px-3 py-2 rounded-lg border border-theme-border bg-theme-bg-primary text-[13px] text-theme-text-primary placeholder:text-theme-text-muted"
                        />
                        <span className="block text-[11px] text-theme-text-muted mt-1">Resta nel gestionale: sul contratto non compare.</span>
                    </label>
                </div>

                <div className="sticky bottom-0 bg-theme-bg-secondary border-t border-theme-border p-5 flex flex-wrap justify-end gap-3">
                    {valore && (
                        <button
                            onClick={() => onSalva(null)}
                            className="px-5 py-2.5 border border-red-500/40 text-red-400 rounded-full hover:bg-red-500/10 transition-colors text-[13px] font-semibold"
                        >
                            Togli la modifica
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="px-5 py-2.5 border border-theme-border-light text-theme-text-secondary rounded-full hover:bg-theme-bg-tertiary transition-colors text-[13px] font-semibold"
                    >
                        Annulla
                    </button>
                    <button
                        onClick={() => onSalva({ ...bozza, opzione_id: opzioneId, opzione_nome: opzioneNome, creata_il: new Date().toISOString() })}
                        className="px-5 py-2.5 bg-[#007aff] text-white rounded-full hover:bg-[#0069d9] transition-colors text-[13px] font-semibold"
                    >
                        Applica per questa volta
                    </button>
                </div>
            </div>
        </div>
    )
}
