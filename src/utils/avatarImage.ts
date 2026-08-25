/**
 * Preparazione delle foto profilo prima dell'upload.
 *
 * 2026-08-25: l'upload della foto falliva con "no content provided", cioe'
 * Supabase Storage riceveva un file di 0 byte. Colpa delle foto iPhone:
 * - HEIC/HEIF, che Chrome non decodifica affatto e che il bucket
 *   `operator-avatars` rifiuta comunque (accetta solo jpeg/png/webp/gif);
 * - foto iCloud non ancora scaricate sul Mac, che il file picker consegna
 *   come nome senza contenuto.
 *
 * Invece di chiedere all'operatore di convertire a mano, ri-codifichiamo
 * SEMPRE in JPEG nel browser: il mime type diventa quello accettato dal
 * bucket, l'immagine viene rimpicciolita (il limite di 2 MB non si tocca
 * piu') e l'HEIC funziona dove il browser sa leggerlo (Safari).
 *
 * Usata da: AdminDashboard (foto propria dal menu utente), Rilevazione Orari
 * e Operatori (foto di un collaboratore). Un solo punto, cosi' le tre non
 * divergono.
 */

/** Lato massimo dell'avatar: oltre non serve, si vede in un cerchio piccolo. */
const AVATAR_LATO_MAX = 512
const ESTENSIONI_IMMAGINE = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'bmp', 'tif', 'tiff']

/** Errore con un messaggio gia' pronto da mostrare all'operatore. */
export class AvatarError extends Error {}

async function decodifica(file: File): Promise<{ src: CanvasImageSource; w: number; h: number; libera: () => void }> {
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
        throw new AvatarError(
            'Il browser non riesce a leggere questa foto (formato HEIC dell\'iPhone su Chrome?). Esportala in JPG — oppure riprova da Safari — e ricarica.'
        )
    }
}

/**
 * Controlla il file e restituisce il JPEG pronto per lo storage.
 * Solleva AvatarError con il messaggio da mostrare quando non si puo' fare.
 */
export async function preparaAvatarJpeg(file: File): Promise<Blob> {
    // Il mime type NON e' affidabile: le foto iPhone arrivano spesso con
    // `type` vuoto. Vale anche l'estensione; poi e' la decodifica a dire
    // davvero se e' un'immagine leggibile.
    const estensione = file.name.split('.').pop()?.toLowerCase() || ''
    if (!file.type.startsWith('image/') && !ESTENSIONI_IMMAGINE.includes(estensione)) {
        throw new AvatarError('Carica un\'immagine (jpg, png, webp, heic).')
    }
    // 0 byte = la causa dell'errore "no content provided" di Supabase.
    if (file.size === 0) {
        throw new AvatarError('Il file e\' vuoto (0 byte): se la foto e\' su iCloud, aprila prima nell\'app Foto per scaricarla, poi riprova.')
    }
    if (file.size > 25 * 1024 * 1024) {
        throw new AvatarError('File troppo grande (max 25 MB).')
    }

    const { src, w, h, libera } = await decodifica(file)
    try {
        if (!w || !h) throw new AvatarError('Immagine senza dimensioni leggibili: esportala in JPG e riprova.')
        const scala = Math.min(1, AVATAR_LATO_MAX / Math.max(w, h))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(w * scala))
        canvas.height = Math.max(1, Math.round(h * scala))
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new AvatarError('Conversione non disponibile su questo browser.')
        ctx.drawImage(src, 0, 0, canvas.width, canvas.height)
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
        if (!blob || blob.size === 0) throw new AvatarError('Conversione della foto fallita: esportala in JPG e riprova.')
        return blob
    } finally {
        libera()
    }
}

/** `accept` del file picker: gli stessi formati che sappiamo convertire. */
export const AVATAR_ACCEPT = 'image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif'
