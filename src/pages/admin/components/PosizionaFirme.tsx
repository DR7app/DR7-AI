import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
).toString()

/**
 * 14/10/2026 — Posizione della firma scelta dallo staff (tab DR7 Trust).
 *
 * Prima il sigillo di un documento libero cadeva sempre all'ultima pagina,
 * nel riquadro "1° guidatore" del contratto DR7: su qualsiasi altro PDF
 * finiva in un punto a caso. Qui lo staff sceglie pagina e punto per ogni
 * firmatario; DR7 Trust (signature-complete) stampa il sigillo esattamente li'.
 *
 * pagina = 1, 2, ... ; x/y = angolo in alto a sinistra del sigillo, in
 * frazione della pagina (0-1, origine in alto a sinistra). Il sigillo ha
 * dimensione fissa in punti PDF: quella che si vede qui e' quella stampata.
 */
export interface PosizioneFirma { pagina: number; x: number; y: number }

// Stesse misure di signature-complete (DR7 Trust): sigillo 130 x 42 pt.
export const SIGILLO_LARGHEZZA_PT = 130
export const SIGILLO_ALTEZZA_PT = 42

const COLORI = ['#0A8FA3', '#d97706', '#7c3aed', '#16a34a', '#dc2626', '#2563eb']

interface Firmatario { nome: string; posizione?: PosizioneFirma | null }

interface Props {
    url: string
    firmatari: Firmatario[]
    onSalva: (posizioni: (PosizioneFirma | null)[]) => void
    onChiudi: () => void
}

interface Pagina { numero: number; larghezzaPt: number; altezzaPt: number }

export default function PosizionaFirme({ url, firmatari, onSalva, onChiudi }: Props) {
    const [pagine, setPagine] = useState<Pagina[]>([])
    const [errore, setErrore] = useState('')
    const [attivo, setAttivo] = useState(0)
    const [posizioni, setPosizioni] = useState<(PosizioneFirma | null)[]>(() => firmatari.map(f => f.posizione || null))
    const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)
    const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map())
    const trascinamento = useRef<{ idx: number; dx: number; dy: number; pagina: number } | null>(null)

    useEffect(() => {
        let annullato = false
        ;(async () => {
            try {
                const pdf = await pdfjsLib.getDocument(url).promise
                if (annullato) return
                pdfRef.current = pdf
                const elenco: Pagina[] = []
                for (let n = 1; n <= pdf.numPages; n++) {
                    const vp = (await pdf.getPage(n)).getViewport({ scale: 1 })
                    elenco.push({ numero: n, larghezzaPt: vp.width, altezzaPt: vp.height })
                }
                if (!annullato) setPagine(elenco)
            } catch (err) {
                if (!annullato) setErrore(err instanceof Error ? err.message : String(err))
            }
        })()
        return () => { annullato = true; pdfRef.current?.destroy() }
    }, [url])

    // Disegna ogni pagina nel suo canvas, alla larghezza del riquadro.
    useEffect(() => {
        if (!pagine.length || !pdfRef.current) return
        const pdf = pdfRef.current
        pagine.forEach(async p => {
            const canvas = canvasRefs.current.get(p.numero)
            if (!canvas) return
            const page = await pdf.getPage(p.numero)
            const larghezza = canvas.parentElement?.clientWidth || 600
            const vp = page.getViewport({ scale: (larghezza / p.larghezzaPt) * (window.devicePixelRatio || 1) })
            canvas.width = vp.width
            canvas.height = vp.height
            await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp, canvas } as any).promise
        })
    }, [pagine])

    const limita = (v: number, max: number) => Math.min(Math.max(v, 0), Math.max(max, 0))

    // Punto del puntatore in frazione della pagina.
    function frazione(e: React.PointerEvent, el: HTMLElement) {
        const r = el.getBoundingClientRect()
        return { fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height }
    }

    function posa(idx: number, p: Pagina, x: number, y: number) {
        const w = SIGILLO_LARGHEZZA_PT / p.larghezzaPt
        const h = SIGILLO_ALTEZZA_PT / p.altezzaPt
        setPosizioni(prev => prev.map((v, i) => i === idx
            ? { pagina: p.numero, x: limita(x, 1 - w), y: limita(y, 1 - h) }
            : v))
    }

    // Click su un punto libero della pagina: il sigillo del firmatario attivo
    // si centra li'.
    function clickPagina(e: React.PointerEvent<HTMLDivElement>, p: Pagina) {
        if (trascinamento.current) return
        const { fx, fy } = frazione(e, e.currentTarget)
        const w = SIGILLO_LARGHEZZA_PT / p.larghezzaPt
        const h = SIGILLO_ALTEZZA_PT / p.altezzaPt
        posa(attivo, p, fx - w / 2, fy - h / 2)
    }

    function iniziaTrascinamento(e: React.PointerEvent<HTMLDivElement>, idx: number, p: Pagina) {
        e.stopPropagation()
        const pos = posizioni[idx]
        const paginaEl = e.currentTarget.parentElement
        if (!pos || !paginaEl) return
        const { fx, fy } = frazione(e, paginaEl)
        trascinamento.current = { idx, dx: fx - pos.x, dy: fy - pos.y, pagina: p.numero }
        setAttivo(idx)
        e.currentTarget.setPointerCapture(e.pointerId)
    }

    function muovi(e: React.PointerEvent<HTMLDivElement>, p: Pagina) {
        const t = trascinamento.current
        const paginaEl = e.currentTarget.parentElement
        if (!t || t.pagina !== p.numero || !paginaEl) return
        const { fx, fy } = frazione(e, paginaEl)
        posa(t.idx, p, fx - t.dx, fy - t.dy)
    }

    function fineTrascinamento() {
        // Un attimo dopo: il click che chiude il trascinamento non riposiziona.
        setTimeout(() => { trascinamento.current = null }, 0)
    }

    return (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-2 sm:p-4" onClick={onChiudi}>
            <div
                className="bg-theme-bg-secondary border border-theme-border rounded-lg w-full max-w-3xl max-h-[95vh] flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                <div className="p-4 border-b border-theme-border space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        <h3 className="text-lg font-bold text-theme-text-primary">Posiziona firma</h3>
                        <button onClick={onChiudi} className="text-theme-text-muted hover:text-theme-text-primary text-xl leading-none" aria-label="Chiudi">×</button>
                    </div>
                    <p className="text-xs text-theme-text-muted">
                        Scegli il firmatario, poi clicca sul documento dove deve apparire la sua firma. Trascina il riquadro per spostarlo.
                        Senza posizione la firma va in fondo all'ultima pagina.
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {firmatari.map((f, i) => (
                            <button
                                key={i}
                                type="button"
                                onClick={() => setAttivo(i)}
                                className={`text-xs px-3 py-1.5 rounded-full border inline-flex items-center gap-2 ${attivo === i ? 'text-white' : 'text-theme-text-secondary border-theme-border'}`}
                                style={attivo === i ? { background: COLORI[i % COLORI.length], borderColor: COLORI[i % COLORI.length] } : undefined}
                            >
                                <span className="w-2 h-2 rounded-full" style={{ background: COLORI[i % COLORI.length] }} />
                                {f.nome || `Firmatario ${i + 1}`}
                                <span className="opacity-80">{posizioni[i] ? `pag. ${posizioni[i]!.pagina}` : 'non posizionata'}</span>
                                {posizioni[i] && (
                                    <span
                                        role="button"
                                        title="Togli posizione"
                                        onClick={e => { e.stopPropagation(); setPosizioni(prev => prev.map((v, j) => j === i ? null : v)) }}
                                        className="ml-1 opacity-80 hover:opacity-100"
                                    >×</span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-3 sm:p-4 bg-theme-bg-tertiary space-y-4">
                    {errore && <p className="text-sm text-red-400">Impossibile aprire il PDF: {errore}</p>}
                    {!errore && !pagine.length && <p className="text-sm text-theme-text-muted">Caricamento documento...</p>}
                    {pagine.map(p => (
                        <div key={p.numero}>
                            <div className="text-[11px] text-theme-text-muted mb-1">Pagina {p.numero} di {pagine.length}</div>
                            <div
                                className="relative bg-white shadow cursor-crosshair select-none touch-none"
                                style={{ aspectRatio: `${p.larghezzaPt} / ${p.altezzaPt}` }}
                                onPointerUp={e => clickPagina(e, p)}
                            >
                                <canvas
                                    ref={el => { if (el) canvasRefs.current.set(p.numero, el); else canvasRefs.current.delete(p.numero) }}
                                    className="absolute inset-0 w-full h-full"
                                />
                                {posizioni.map((pos, i) => pos && pos.pagina === p.numero && (
                                    <div
                                        key={i}
                                        onPointerDown={e => iniziaTrascinamento(e, i, p)}
                                        onPointerMove={e => muovi(e, p)}
                                        onPointerUp={e => { e.stopPropagation(); fineTrascinamento() }}
                                        className="absolute cursor-move flex flex-col justify-center px-1 overflow-hidden"
                                        style={{
                                            left: `${pos.x * 100}%`,
                                            top: `${pos.y * 100}%`,
                                            width: `${(SIGILLO_LARGHEZZA_PT / p.larghezzaPt) * 100}%`,
                                            height: `${(SIGILLO_ALTEZZA_PT / p.altezzaPt) * 100}%`,
                                            border: `2px solid ${COLORI[i % COLORI.length]}`,
                                            background: `${COLORI[i % COLORI.length]}22`,
                                        }}
                                    >
                                        <span className="text-[9px] font-bold leading-tight truncate" style={{ color: COLORI[i % COLORI.length] }}>
                                            {firmatari[i]?.nome || `Firmatario ${i + 1}`}
                                        </span>
                                        <span className="text-[8px] leading-tight text-gray-500">Firma DR7 Trust</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="p-4 border-t border-theme-border flex gap-2 justify-end">
                    <button type="button" onClick={onChiudi} className="px-4 py-2 rounded-full border border-theme-border text-theme-text-secondary">
                        Annulla
                    </button>
                    <button
                        type="button"
                        onClick={() => onSalva(posizioni)}
                        className="px-4 py-2 rounded-full bg-dr7-gold hover:bg-[#0A8FA3] text-white font-bold"
                    >
                        Salva posizioni
                    </button>
                </div>
            </div>
        </div>
    )
}
