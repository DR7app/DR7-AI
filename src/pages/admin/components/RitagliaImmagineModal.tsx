import { useCallback, useEffect, useRef, useState } from 'react'
import {
    ImmagineError,
    decodificaImmagine,
    disegnaImmagine,
    ritaglioCentrato,
    type ImmagineDecodificata,
    type Ritaglio,
} from '../../../utils/immagineUpload'

/**
 * Finestra di ritaglio delle immagini che finiscono sul sito.
 *
 * Serve a due cose insieme:
 * - far vedere all'operatore il riquadro VERO del sito, cosi' decide lui cosa
 *   resta dentro invece di scoprirlo dopo la pubblicazione;
 * - produrre un file gia' della misura giusta, perche' prima partiva la foto
 *   grezza del telefono (diversi MB, 4000 px di lato) e il sito la mostrava
 *   enorme e fuori dalla cornice.
 *
 * Due modi, perche' le due esigenze esistono davvero:
 * - "Riempi il riquadro": ritaglia al rapporto del sito, nessun bordo vuoto.
 * - "Tutta l'immagine": non taglia niente, per le locandine di catalogo che
 *   hanno gia' titolo e prezzo disegnati dentro e non vanno toccate.
 */

type Props = {
    /** File scelto dall'operatore. La finestra si apre quando non e' null. */
    file: File | null
    /** Rapporto larghezza/altezza del riquadro sul sito. */
    ratio: number
    /** Lato lungo massimo del file prodotto, in pixel. */
    latoMax?: number
    /** Testo sotto al titolo: dove finira' l'immagine. */
    descrizione?: string
    onAnnulla: () => void
    /** Riceve l'immagine gia' pronta per lo storage. */
    onConferma: (blob: Blob) => void
}

/** Zoom massimo: oltre si vedrebbero solo i pixel. */
const ZOOM_MAX = 4

export default function RitagliaImmagineModal({
    file,
    ratio,
    latoMax = 1200,
    descrizione,
    onAnnulla,
    onConferma,
}: Props) {
    const [immagine, setImmagine] = useState<ImmagineDecodificata | null>(null)
    const [anteprima, setAnteprima] = useState('')
    const [errore, setErrore] = useState('')
    const [caricando, setCaricando] = useState(false)
    const [lavorando, setLavorando] = useState(false)
    const [riempi, setRiempi] = useState(true)
    const [zoom, setZoom] = useState(1)
    // Centro del ritaglio, in pixel della sorgente.
    const [centro, setCentro] = useState({ x: 0, y: 0 })

    const riquadroRef = useRef<HTMLDivElement>(null)
    const trascinamento = useRef<{ px: number; py: number; cx: number; cy: number } | null>(null)

    // La sorgente viene decodificata UNA volta sola: la stessa serve
    // all'anteprima e poi al file finale.
    useEffect(() => {
        if (!file) return
        let annullato = false
        let daLiberare: ImmagineDecodificata | null = null
        const url = URL.createObjectURL(file)
        setCaricando(true)
        setErrore('')
        setZoom(1)
        setRiempi(true)
        setAnteprima(url)
        decodificaImmagine(file)
            .then(dec => {
                if (annullato) { dec.libera(); return }
                daLiberare = dec
                setImmagine(dec)
                setCentro({ x: dec.w / 2, y: dec.h / 2 })
            })
            .catch((err: unknown) => {
                if (!annullato) setErrore(err instanceof ImmagineError ? err.message : 'Immagine non leggibile.')
            })
            .finally(() => { if (!annullato) setCaricando(false) })
        return () => {
            annullato = true
            daLiberare?.libera()
            URL.revokeObjectURL(url)
            setImmagine(null)
            setAnteprima('')
        }
    }, [file])

    /** Il ritaglio corrente, in pixel della sorgente. */
    const calcolaRitaglio = useCallback((): Ritaglio | undefined => {
        if (!immagine || !riempi) return undefined
        const base = ritaglioCentrato(immagine.w, immagine.h, ratio)
        const w = base.w / zoom
        const h = base.h / zoom
        // Il centro non puo' uscire dalla sorgente, altrimenti resterebbero
        // bordi trasparenti ai lati.
        const cx = Math.min(Math.max(centro.x, w / 2), immagine.w - w / 2)
        const cy = Math.min(Math.max(centro.y, h / 2), immagine.h - h / 2)
        return { x: cx - w / 2, y: cy - h / 2, w, h }
    }, [immagine, riempi, ratio, zoom, centro])

    function iniziaTrascinamento(e: React.PointerEvent) {
        if (!riempi || !immagine) return
        e.currentTarget.setPointerCapture(e.pointerId)
        trascinamento.current = { px: e.clientX, py: e.clientY, cx: centro.x, cy: centro.y }
    }

    function muoviTrascinamento(e: React.PointerEvent) {
        const inizio = trascinamento.current
        const riquadro = riquadroRef.current
        if (!inizio || !immagine || !riquadro) return
        const ritaglio = calcolaRitaglio()
        if (!ritaglio) return
        // Un pixel trascinato sullo schermo vale piu' di un pixel della
        // sorgente: converto con la scala dell'anteprima.
        const scala = riquadro.clientWidth / ritaglio.w
        setCentro({
            x: inizio.cx - (e.clientX - inizio.px) / scala,
            y: inizio.cy - (e.clientY - inizio.py) / scala,
        })
    }

    function fineTrascinamento() {
        trascinamento.current = null
    }

    async function conferma() {
        if (!immagine || !file) return
        setLavorando(true)
        setErrore('')
        try {
            const blob = await disegnaImmagine(immagine, {
                latoMax,
                ratio: riempi ? ratio : undefined,
                ritaglio: calcolaRitaglio(),
            })
            onConferma(blob)
        } catch (err: unknown) {
            setErrore(err instanceof ImmagineError ? err.message : 'Conversione della foto fallita.')
        } finally {
            setLavorando(false)
        }
    }

    if (!file) return null

    const ritaglio = calcolaRitaglio()
    // Posiziona l'anteprima dentro al riquadro: stessa matematica del canvas,
    // cosi' quello che si vede e' esattamente quello che verra' salvato.
    const stileAnteprima: React.CSSProperties = ritaglio && immagine
        ? {
            position: 'absolute',
            width: `${(immagine.w / ritaglio.w) * 100}%`,
            height: `${(immagine.h / ritaglio.h) * 100}%`,
            left: `${(-ritaglio.x / ritaglio.w) * 100}%`,
            top: `${(-ritaglio.y / ritaglio.h) * 100}%`,
            maxWidth: 'none',
        }
        : { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }

    const pesoOriginale = file.size / (1024 * 1024)

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-md rounded-2xl border border-theme-border-light bg-theme-bg-secondary p-5 shadow-2xl">
                <h3 className="text-theme-text-primary text-base font-semibold">Inquadra l'immagine</h3>
                <p className="mt-1 text-xs text-theme-text-muted">
                    {descrizione || 'Quello che resta nel riquadro e\' quello che si vedra\' sul sito.'}
                </p>

                <div
                    ref={riquadroRef}
                    onPointerDown={iniziaTrascinamento}
                    onPointerMove={muoviTrascinamento}
                    onPointerUp={fineTrascinamento}
                    onPointerCancel={fineTrascinamento}
                    className={`relative mx-auto mt-4 w-full max-w-[240px] overflow-hidden rounded-lg border border-theme-border-light bg-black ${riempi ? 'cursor-move touch-none' : ''}`}
                    style={{ aspectRatio: String(ratio) }}
                >
                    {anteprima && <img src={anteprima} alt="" draggable={false} style={stileAnteprima} />}
                    {caricando && (
                        <div className="absolute inset-0 flex items-center justify-center text-xs text-white/70">
                            Lettura della foto...
                        </div>
                    )}
                </div>

                <div className="mt-3 flex rounded-lg border border-theme-border-light p-0.5 text-xs">
                    <button
                        type="button"
                        onClick={() => setRiempi(true)}
                        className={`flex-1 rounded-md px-2 py-1.5 transition-colors ${riempi ? 'bg-dr7-gold text-white' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
                    >
                        Riempi il riquadro
                    </button>
                    <button
                        type="button"
                        onClick={() => setRiempi(false)}
                        className={`flex-1 rounded-md px-2 py-1.5 transition-colors ${!riempi ? 'bg-dr7-gold text-white' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
                    >
                        Tutta l'immagine
                    </button>
                </div>

                {riempi ? (
                    <label className="mt-3 block">
                        <span className="text-xs text-theme-text-muted">Zoom — trascina l'immagine per spostarla</span>
                        <input
                            type="range"
                            min={1}
                            max={ZOOM_MAX}
                            step={0.01}
                            value={zoom}
                            onChange={e => setZoom(Number(e.target.value))}
                            className="mt-1 w-full accent-dr7-gold"
                        />
                    </label>
                ) : (
                    <p className="mt-3 text-xs text-theme-text-muted">
                        Non viene tagliato niente: sul sito l'immagine restera' intera dentro al riquadro.
                    </p>
                )}

                <p className="mt-3 text-[11px] text-theme-text-muted">
                    {immagine
                        ? `Originale ${immagine.w}x${immagine.h} px, ${pesoOriginale.toFixed(1)} MB — verra' salvata al massimo a ${latoMax} px di lato.`
                        : 'Originale in lettura...'}
                </p>

                {errore && <p className="mt-2 text-xs text-red-400">{errore}</p>}

                <div className="mt-4 flex gap-2">
                    <button
                        type="button"
                        onClick={onAnnulla}
                        className="flex-1 rounded-full border border-theme-border-light px-4 py-1.5 text-sm text-theme-text-primary transition-colors hover:border-dr7-gold"
                    >
                        Annulla
                    </button>
                    <button
                        type="button"
                        onClick={conferma}
                        disabled={!immagine || lavorando}
                        className="flex-1 rounded-full bg-dr7-gold px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[#0A8FA3] disabled:opacity-50"
                    >
                        {lavorando ? 'Preparazione...' : 'Usa questa'}
                    </button>
                </div>
            </div>
        </div>
    )
}
