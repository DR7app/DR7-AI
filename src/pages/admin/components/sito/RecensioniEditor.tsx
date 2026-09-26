import type { FooterCopy, ManualReview } from './siteCopyDefaults'
import RecensioniGoogleAuto from './RecensioniGoogleAuto'

/**
 * Editor delle recensioni scritte a mano (fascia recensioni in fondo a ogni
 * pagina), 23/09/2026 (direzione).
 *
 * Stavano nel codice del sito (sections/ReviewsSection.tsx) e comparivano
 * sempre in coda a quelle di Google. Ora vivono in footer.manual_reviews:
 * si aggiungono, si tolgono e si riordinano da qui. L'interruttore decide se
 * restano in coda anche quando Google risponde; se Google non risponde si
 * vedono comunque, cosi' la fascia non resta mai vuota.
 *
 * 26/09/2026 — sopra ci sono le recensioni Google VERE, copiate ogni tre ore
 * (RecensioniGoogleAuto). Quelle scritte a mano diventano solo la riserva:
 * l'interruttore e' spento di default e il sito le mostra se Google non
 * risponde.
 */

const inputCls = 'w-full bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500/40'

export default function RecensioniEditor({ copy, setCopy }: { copy: FooterCopy; setCopy: (next: FooterCopy) => void }) {
    const update = <K extends keyof FooterCopy>(key: K, value: FooterCopy[K]) => setCopy({ ...copy, [key]: value })
    const elenco: ManualReview[] = copy.manual_reviews ?? []

    const updateRec = (idx: number, patch: Partial<ManualReview>) => {
        const next = [...elenco]
        next[idx] = { ...next[idx], ...patch }
        update('manual_reviews', next)
    }
    const moveRec = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= elenco.length) return
        const next = [...elenco]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        update('manual_reviews', next)
    }
    const removeRec = (idx: number) => {
        if (!confirm('Rimuovere questa recensione?')) return
        update('manual_reviews', elenco.filter((_, i) => i !== idx))
    }
    const addRec = () => {
        update('manual_reviews', [...elenco, {
            id: `rec-${Date.now().toString(36)}`,
            name: '', stars: 5,
            date: new Date().toISOString().slice(0, 10),
            text_it: '', text_en: '',
            link: copy.reviews_google_url || 'https://',
        }])
    }
    const dopoGoogle = copy.manual_reviews_after_google === true

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-theme-text-primary">Recensioni</h2>
                <p className="text-[13px] text-theme-text-secondary mt-1">
                    La fascia recensioni in fondo a ogni pagina. Le recensioni di Google arrivano da sole, dalla piu recente; quelle scritte a mano sono solo la riserva.
                    Titolo, frase e immagine della fascia si cambiano in <b>Footer</b>.
                </p>
            </div>

            <RecensioniGoogleAuto />

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Google</h3>
                <label className="flex items-start justify-between gap-4 py-1 cursor-pointer">
                    <span className="min-w-0">
                        <span className="block text-[13px] font-medium text-theme-text-primary">Mostra anche le recensioni manuali dopo quelle Google</span>
                        <span className="block text-[11px] text-theme-text-secondary mt-0.5">
                            Spento (consigliato): si vedono solo le recensioni vere di Google. Le manuali compaiono solo se Google non risponde.
                        </span>
                    </span>
                    <input type="checkbox" checked={dopoGoogle} onChange={e => update('manual_reviews_after_google', e.target.checked)} className="sr-only peer" />
                    <span className="relative inline-block shrink-0 mt-0.5 w-9 h-5 rounded-full bg-[#e5e5ea] peer-checked:bg-[#34c759] transition-colors">
                        <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
                    </span>
                </label>
                <label className="block">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6]">Link &laquo;Leggi tutte le recensioni&raquo;</span>
                    <input type="text" value={copy.reviews_google_url ?? ''} onChange={e => update('reviews_google_url', e.target.value)} placeholder="https://..." className={`mt-1 font-mono ${inputCls}`} />
                </label>
            </section>

            <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-theme-text-primary">Recensioni manuali, solo se Google non risponde ({elenco.length})</h3>
                <p className="text-[12px] text-theme-text-secondary">Testo inglese vuoto = in inglese si mostra quello italiano.</p>
                {elenco.map((r, i) => (
                    <div key={r.id} className="border border-theme-border rounded-xl p-3 bg-[#fafafa] space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-theme-text-secondary flex-1 truncate">{r.name || '(senza nome)'}</span>
                            <button onClick={() => moveRec(i, -1)} disabled={i === 0} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                            <button onClick={() => moveRec(i, 1)} disabled={i === elenco.length - 1} className="w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center" title="Sposta giu"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                            <button onClick={() => removeRec(i)} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            <input type="text" value={r.name} onChange={e => updateRec(i, { name: e.target.value })} placeholder="Nome" className={inputCls} />
                            <select value={String(r.stars || 5)} onChange={e => updateRec(i, { stars: Number(e.target.value) })} className={inputCls} title="Stelle">
                                {[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{n} {n === 1 ? 'stella' : 'stelle'}</option>)}
                            </select>
                            <input type="date" value={r.date} onChange={e => updateRec(i, { date: e.target.value })} className={inputCls} title="Data" />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <textarea value={r.text_it} onChange={e => updateRec(i, { text_it: e.target.value })} placeholder="Testo IT" rows={3} className={`resize-y ${inputCls}`} />
                            <textarea value={r.text_en} onChange={e => updateRec(i, { text_en: e.target.value })} placeholder="Text EN (vuoto = testo italiano)" rows={3} className={`resize-y ${inputCls}`} />
                        </div>
                        <input type="text" value={r.link} onChange={e => updateRec(i, { link: e.target.value })} placeholder="Link alla recensione (https://...)" className={`font-mono ${inputCls}`} />
                    </div>
                ))}
                <button onClick={addRec} className="w-full py-2.5 rounded-xl border-2 border-dashed border-theme-border text-[12px] font-medium text-theme-text-primary hover:bg-theme-bg-secondary hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Aggiungi recensione
                </button>
            </section>
        </div>
    )
}
