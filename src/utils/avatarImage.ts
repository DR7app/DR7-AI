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
 * 2026-08-31: gli stessi due problemi valgono per ogni immagine caricata
 * dall'admin, non solo per gli avatar, quindi la lettura del file vive ora in
 * `immagineUpload.ts`. Qui resta solo la misura dell'avatar. Un solo
 * decodificatore, cosi' le due strade non divergono.
 *
 * Usata da: AdminDashboard (foto propria dal menu utente), Rilevazione Orari
 * e Operatori (foto di un collaboratore).
 */
import { ImmagineError, preparaImmagine, IMMAGINE_ACCEPT } from './immagineUpload'

/** Lato massimo dell'avatar: oltre non serve, si vede in un cerchio piccolo. */
const AVATAR_LATO_MAX = 512

/** Errore con un messaggio gia' pronto da mostrare all'operatore. */
export { ImmagineError as AvatarError }

/**
 * Controlla il file e restituisce il JPEG pronto per lo storage.
 * Solleva AvatarError con il messaggio da mostrare quando non si puo' fare.
 */
export function preparaAvatarJpeg(file: File): Promise<Blob> {
    return preparaImmagine(file, { latoMax: AVATAR_LATO_MAX })
}

/** `accept` del file picker: gli stessi formati che sappiamo convertire. */
export const AVATAR_ACCEPT = IMMAGINE_ACCEPT
