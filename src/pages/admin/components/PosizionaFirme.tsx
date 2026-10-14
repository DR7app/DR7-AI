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
 * finiva in un punto a caso. Qui lo staff sceglie pagina e punto di ogni
 * firma, quante ne vuole per firmatario ("Aggiungi firma"); DR7 Trust
 * (signature-complete) stampa il sigillo esattamente li'.
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

interface Firmatario { nome: string; posizioni: PosizioneFirma[] }

interface Props {
    url: string
    firmatari: Firmatario[]
    onSalva: (posizioni: PosizioneFirma[][]) => void
    onChiudi: () => void
}

interface Pagina { numero: number; larghezzaPt: number; altezzaPt: number }

export default function PosizionaFirme({ url, firmatari, onSalva, onChiudi }: Props) {
    const [pagine, setPagine] = useState<Pagina[]>([])
    const [errore, setErrore] = useState('')
    const [attivo, setAttivo] = useState(0)
    const [posizioni, setPosizioni] = useState<PosizioneFirma[][]>(() => firmatari.map(f => [...(f.posizioni || [])]))
    // Il prossimo click sul documento aggiunge una firma: sempre se il
    // firmatario non ne ha ancora, altrimenti dopo "Aggiungi firma".
    const [aggiungi, setAggiungi] = useState(false)
    // 14/10/2026: una pagina alla volta, scelta dalle schede "Pagina N"
    // (scorrendo, le pagine dopo la prima non si vedevano).
    const [paginaVista, setPaginaVista] = useState(1)
    const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)
    const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map())
    const trascinamento = useRef<{ idx: number; k: number; dx: number; dy: number; pagina: number } | null>(null)

    const modoAggiungi = aggiungi || (posizioni[attivo]?.length || 0) === 0
    const totaleFirme = posizioni.reduce((n, l) => n + l.length, 0)

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

    // Disegna la pagina visibile nel suo canvas, alla larghezza del riquadro.
    useEffect(() => {
        if (!pagine.length || !pdfRef.current) return
        const pdf = pdfRef.current
        pagine.filter(p => p.numero === paginaVista).forEach(async p => {
            const canvas = canvasRefs.current.get(p.numero)
            if (!canvas) return
            const page = await pdf.getPage(p.numero)
            const larghezza = canvas.parentElement?.clientWidth || 600
            const vp = page.getViewport({ scale: (larghezza / p.larghezzaPt) * (window.devicePixelRatio || 1) })
            canvas.width = vp.width
            canvas.height = vp.height
            await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp, canvas } as any).promise
        })
    }, [pagine, paginaVista])

    const limita = (v: number, max: number) => Math.min(Math.max(v, 0), Math.max(max, 0))

    // Punto del puntatore in frazione della pagina.
    function frazione(e: React.PointerEvent, el: HTMLElement) {
        const r = el.getBoundingClientRect()
        return { fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height }
    }

    function inPagina(p: Pagina, x: number, y: number): PosizioneFirma {
        const w = SIGILLO_LARGHEZZA_PT / p.larghezzaPt
        const h = SIGILLO_ALTEZZA_PT / p.altezzaPt
        return { pagina: p.numero, x: limita(x, 1 - w), y: limita(y, 1 - h) }
    }

    // Click sul documento in modalita' "aggiungi": nuova firma del firmatario
    // attivo, centrata sul punto cliccato.
    function clickPagina(e: React.PointerEvent<HTMLDivElement>, p: Pagina) {
        if (trascinamento.current || !modoAggiungi) return
        const { fx, fy } = frazione(e, e.currentTarget)
        const w = SIGILLO_LARGHEZZA_PT / p.larghezzaPt
        const h = SIGILLO_ALTEZZA_PT / p.altezzaPt
        const nuova = inPagina(p, fx - w / 2, fy - h / 2)
        setPosizioni(prev => prev.map((l, i) => i === attivo ? [...l, nuova] : l))
        setAggiungi(false)
    }

    function togli(idx: number, k: number) {
        setPosizioni(prev => prev.map((l, i) => i === idx ? l.filter((_, j) => j !== k) : l))
    }

    function iniziaTrascinamento(e: React.PointerEvent<HTMLDivElement>, idx: number, k: number, p: Pagina) {
        e.stopPropagation()
        const pos = posizioni[idx]?.[k]
        const paginaEl = e.currentTarget.parentElement
        if (!pos || !paginaEl) return
        const { fx, fy } = frazione(e, paginaEl)
        trascinamento.current = { idx, k, dx: fx - pos.x, dy: fy - pos.y, pagina: p.numero }
        setAttivo(idx)
        e.currentTarget.setPointerCapture(e.pointerId)
    }

    function muovi(e: React.PointerEvent<HTMLDivElement>, p: Pagina) {
        const t = trascinamento.current
        const paginaEl = e.currentTarget.parentElement
        if (!t || t.pagina !== p.numero || !paginaEl) return
        const { fx, fy } = frazione(e, paginaEl)
        const nuova = inPagina(p, fx - t.dx, fy - t.dy)
        setPosizioni(prev => prev.map((l, i) => i === t.idx ? l.map((v, j) => j === t.k ? nuova : v) : l))
    }

    function fineTrascinamento() {
        // Un attimo dopo: il click che chiude il trascinamento non aggiunge firme.
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
                        {modoAggiungi
                            ? `Clicca sul documento dove deve apparire la firma di ${firmatari[attivo]?.nome || `Firmatario ${attivo + 1}`}.`
                            : 'Trascina una firma per spostarla. "Aggiungi firma" + nome per metterne un\'altra.'}
                    </p>
                    {pagine.length > 1 && (
                        <div className="flex flex-wrap gap-2">
                            {pagine.map(p => {
                                const firmeQui = posizioni.reduce((n, l) => n + l.filter(v => v.pagina === p.numero).length, 0)
                                const attiva = paginaVista === p.numero
                                return (
                                    <button
                                        key={p.numero}
                                        type="button"
                                        onClick={() => setPaginaVista(p.numero)}
                                        className={`px-3 py-1.5 rounded-full text-sm font-bold border ${attiva ? 'bg-dr7-gold border-dr7-gold text-white' : 'border-theme-border text-theme-text-secondary hover:text-theme-text-primary'}`}
                                    >
                                        Pagina {p.numero}{firmeQui ? ` (${firmeQui} ${firmeQui === 1 ? 'firma' : 'firme'})` : ''}
                                    </button>
                                )
                            })}
                        </div>
                    )}
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 bg-theme-bg-tertiary space-y-4">
                    {errore && <p className="text-sm text-red-400">Impossibile aprire il PDF: {errore}</p>}
                    {!errore && !pagine.length && <p className="text-sm text-theme-text-muted">Caricamento documento...</p>}
                    {pagine.filter(p => p.numero === paginaVista).map(p => (
                        <div key={p.numero}>
                            <div className="text-[11px] text-theme-text-muted mb-1">Pagina {p.numero} di {pagine.length}</div>
                            <div
                                className={`relative bg-white shadow select-none touch-none ${modoAggiungi ? 'cursor-crosshair' : ''}`}
                                style={{ aspectRatio: `${p.larghezzaPt} / ${p.altezzaPt}` }}
                                onPointerUp={e => clickPagina(e, p)}
                            >
                                <canvas
                                    ref={el => { if (el) canvasRefs.current.set(p.numero, el); else canvasRefs.current.delete(p.numero) }}
                                    className="absolute inset-0 w-full h-full"
                                />
                                {posizioni.map((lista, i) => lista.map((pos, k) => pos.pagina === p.numero && (
                                    <div
                                        key={`${i}-${k}`}
                                        onPointerDown={e => iniziaTrascinamento(e, i, k, p)}
                                        onPointerMove={e => muovi(e, p)}
                                        onPointerUp={e => { e.stopPropagation(); fineTrascinamento() }}
                                        className="absolute cursor-move flex flex-col justify-center px-1"
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
                                        <button
                                            type="button"
                                            title="Togli firma"
                                            aria-label="Togli firma"
                                            onPointerDown={e => e.stopPropagation()}
                                            onPointerUp={e => { e.stopPropagation(); togli(i, k) }}
                                            className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-red-600 text-white text-[10px] leading-none flex items-center justify-center"
                                        >×</button>
                                    </div>
                                )))}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="p-4 border-t border-theme-border flex flex-wrap gap-2 justify-end">
                    <button type="button" onClick={onChiudi} className="px-4 py-2 rounded-full border border-theme-border text-theme-text-secondary">
                        Annulla
                    </button>
                    {/* 14/10/2026: un pulsante per firmatario, col suo nome e colore. */}
                    {firmatari.map((f, i) => {
                        const colore = COLORI[i % COLORI.length]
                        const scelto = modoAggiungi && attivo === i
                        return (
                            <button
                                key={i}
                                type="button"
                                onClick={() => { setAttivo(i); setAggiungi(true) }}
                                className={`px-4 py-2 rounded-full border-2 font-bold text-sm text-white hover:opacity-90 ${scelto ? 'ring-2 ring-offset-2 ring-offset-theme-bg-secondary' : ''}`}
                                style={{ borderColor: colore, background: colore, ['--tw-ring-color' as string]: colore }}
                            >
                                + Aggiungi firma {f.nome || `Firmatario ${i + 1}`}
                                <span className="ml-1 opacity-80 font-normal">({posizioni[i]?.length || 0})</span>
                            </button>
                        )
                    })}
                    <button
                        type="button"
                        onClick={() => onSalva(posizioni)}
                        disabled={totaleFirme === 0}
                        className="px-4 py-2 rounded-full bg-dr7-gold hover:bg-[#0A8FA3] text-white font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Salva posizioni
                    </button>
                </div>
            </div>
        </div>
    )
}
