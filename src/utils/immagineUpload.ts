/**
 * Preparazione delle immagini prima dell'upload nello storage.
 *
 * Nasce dal caso lavaggio (2026-08-31): le foto caricate dall'admin finivano
 * nello storage cosi' come uscivano dal telefono — 4000x3000, diversi MB, con
 * un rapporto che non c'entra niente con il riquadro del sito. Risultato: sul
 * sito le immagini si vedevano enormi e tagliate fuori dalla cornice.
 *
 * La cura e' a monte: l'immagine viene SEMPRE ri-codificata nel browser,
 * rimpicciolita a un lato massimo e — quando il riquadro del sito ha un
 * rapporto fisso — ritagliata a quel rapporto. Cosi' quello che sta nello
 * storage e' gia' quello che il sito sa mostrare.
 *
 * Il decodificatore e' lo stesso di sempre (prima `avatarImage.ts`), perche' i
 * due problemi delle foto iPhone valgono per qualunque upload, non solo per gli
 * avatar:
 * - HEIC/HEIF, che Chrome non decodifica affatto e che i bucket rifiutano
 *   comunque (accettano solo jpeg/png/webp/gif);
 * - foto iCloud non ancora scaricate sul Mac, che il file picker consegna come
 *   nome senza contenuto (0 byte) e che Supabase respinge con
 *   "no content provided".
 *
 * `avatarImage.ts` ora si appoggia qui: un solo decodificatore, cosi' le due
 * strade non divergono.
 */

/** Errore con un messaggio gia' pronto da mostrare all'operatore. */
export class ImmagineError extends Error {}

const ESTENSIONI_IMMAGINE = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'bmp', 'tif', 'tiff']

/** Oltre questo il file picker ha quasi certamente preso un video o un RAW. */
const PESO_MASSIMO_SORGENTE = 25 * 1024 * 1024

export type ImmagineDecodificata = {
    src: CanvasImageSource
    /** Larghezza in pixel della sorgente. */
    w: number
    /** Altezza in pixel della sorgente. */
    h: number
    /** Da chiamare SEMPRE quando si e' finito: chiude il bitmap o revoca la URL. */
    libera: () => void
}

/**
 * Porta il file in qualcosa che il canvas sa disegnare.
 * Due vie: `createImageBitmap` (veloce, niente DOM) e in ricaduta un `<img>`,
 * che su Safari legge anche l'HEIC.
 */
export async function decodificaImmagine(file: File): Promise<ImmagineDecodificata> {
    if (typeof createImageBitmap === 'function') {
        try {
            const bitmap = await createImageBitmap(file)
            return { src: bitmap, w: bitmap.width, h: bitmap.height, libera: () => bitmap.close?.() }
        } catch { /* questa via non legge il formato: riprovo con <img> */ }
    }
    const url = URL.createObjectURL(file)
    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image()
            el.onload = () => resolve(el)
            el.onerror = () => reject(new Error('decodifica fallita'))
            el.src = url
        })
        return { src: img, w: img.naturalWidth, h: img.naturalHeight, libera: () => URL.revokeObjectURL(url) }
    } catch {
        URL.revokeObjectURL(url)
        throw new ImmagineError(
            'Il browser non riesce a leggere questa foto (formato HEIC dell\'iPhone su Chrome?). Esportala in JPG — oppure riprova da Safari — e ricarica.'
        )
    }
}

/**
 * Controlli che non dipendono dal contenuto: servono a dare all'operatore un
 * messaggio sensato invece dell'errore grezzo dello storage.
 */
export function controllaFileImmagine(file: File): void {
    // Il mime type NON e' affidabile: le foto iPhone arrivano spesso con
    // `type` vuoto. Vale anche l'estensione; poi e' la decodifica a dire
    // davvero se e' un'immagine leggibile.
    const estensione = file.name.split('.').pop()?.toLowerCase() || ''
    if (!file.type.startsWith('image/') && !ESTENSIONI_IMMAGINE.includes(estensione)) {
        throw new ImmagineError('Carica un\'immagine (jpg, png, webp, heic).')
    }
    // 0 byte = la causa dell'errore "no content provided" di Supabase.
    if (file.size === 0) {
        throw new ImmagineError('Il file e\' vuoto (0 byte): se la foto e\' su iCloud, aprila prima nell\'app Foto per scaricarla, poi riprova.')
    }
    if (file.size > PESO_MASSIMO_SORGENTE) {
        throw new ImmagineError('File troppo grande (max 25 MB).')
    }
}

/** Porzione della sorgente da tenere, in pixel della sorgente stessa. */
export type Ritaglio = { x: number; y: number; w: number; h: number }

export type OpzioniImmagine = {
    /** Lato lungo massimo del risultato, in pixel. */
    latoMax: number
    /**
     * Rapporto larghezza/altezza del riquadro in cui l'immagine verra' mostrata.
     * Se c'e', il risultato esce esattamente di quel rapporto: e' cosi' che
     * l'immagine smette di essere tagliata dalla cornice del sito.
     * Se manca, si tiene il rapporto originale.
     */
    ratio?: number
    /**
     * Porzione scelta a mano dall'operatore. Se manca si prende il centro,
     * che e' quasi sempre il soggetto della foto.
     */
    ritaglio?: Ritaglio
    /** Qualita' di compressione, 0-1. */
    qualita?: number
    tipo?: 'image/jpeg' | 'image/webp'
}

/**
 * Il ritaglio piu' grande possibile con il rapporto chiesto, centrato.
 * Usato quando l'operatore non ne sceglie uno a mano.
 */
export function ritaglioCentrato(w: number, h: number, ratio: number): Ritaglio {
    const ratioSorgente = w / h
    if (ratioSorgente > ratio) {
        // Sorgente piu' larga del riquadro: tolgo ai lati.
        const larghezza = h * ratio
        return { x: (w - larghezza) / 2, y: 0, w: larghezza, h }
    }
    // Sorgente piu' alta del riquadro: tolgo sopra e sotto.
    const altezza = w / ratio
    return { x: 0, y: (h - altezza) / 2, w, h: altezza }
}

/**
 * Quanto e' lontana la foto dal rapporto del riquadro, in percentuale di area
 * che verrebbe buttata via. Serve solo per avvisare l'operatore.
 */
export function percentualeTagliata(w: number, h: number, ratio: number): number {
    if (!w || !h) return 0
    const r = ritaglioCentrato(w, h, ratio)
    return Math.round((1 - (r.w * r.h) / (w * h)) * 100)
}

/**
 * Restituisce l'immagine pronta per lo storage: ridimensionata, eventualmente
 * ritagliata al rapporto del riquadro, ri-codificata.
 * Solleva ImmagineError con il messaggio da mostrare quando non si puo' fare.
 */
export async function preparaImmagine(file: File, opzioni: OpzioniImmagine): Promise<Blob> {
    controllaFileImmagine(file)
    const decodificata = await decodificaImmagine(file)
    try {
        return await disegnaImmagine(decodificata, opzioni)
    } finally {
        decodificata.libera()
    }
}

/**
 * Come `preparaImmagine`, ma su una sorgente gia' decodificata: la finestra di
 * ritaglio decodifica una volta sola per mostrare l'anteprima, e poi riusa la
 * stessa sorgente per produrre il file.
 */
export async function disegnaImmagine(
    { src, w, h }: ImmagineDecodificata,
    { latoMax, ratio, ritaglio, qualita = 0.85, tipo = 'image/jpeg' }: OpzioniImmagine
): Promise<Blob> {
    if (!w || !h) throw new ImmagineError('Immagine senza dimensioni leggibili: esportala in JPG e riprova.')

    const area = ritaglio ?? (ratio ? ritaglioCentrato(w, h, ratio) : { x: 0, y: 0, w, h })
    // Il ritaglio arriva da un'interfaccia a trascinamento: lo riporto dentro
    // la sorgente, altrimenti drawImage disegna bordi trasparenti.
    const sx = Math.max(0, Math.min(area.x, w - 1))
    const sy = Math.max(0, Math.min(area.y, h - 1))
    const sw = Math.max(1, Math.min(area.w, w - sx))
    const sh = Math.max(1, Math.min(area.h, h - sy))

    // Non ingrandisco mai: una foto piccola resta piccola invece di diventare
    // sfocata e pesante per niente.
    const scala = Math.min(1, latoMax / Math.max(sw, sh))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(sw * scala))
    canvas.height = Math.max(1, Math.round(sh * scala))

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new ImmagineError('Conversione non disponibile su questo browser.')
    ctx.imageSmoothingQuality = 'high'
    // Il JPEG non ha trasparenza: senza questo un PNG trasparente esce nero.
    if (tipo === 'image/jpeg') {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, tipo, qualita))
    if (!blob || blob.size === 0) throw new ImmagineError('Conversione della foto fallita: esportala in JPG e riprova.')
    return blob
}

/** `accept` del file picker: gli stessi formati che sappiamo convertire. */
export const IMMAGINE_ACCEPT = 'image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif'
