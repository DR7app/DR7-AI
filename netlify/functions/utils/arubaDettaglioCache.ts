import { createClient } from '@supabase/supabase-js'

/**
 * Cache di numero/data/importo delle fatture ricevute da Aruba.
 *
 * L'elenco di findByUsername arriva senza quei tre campi, quindi ogni riga
 * costa una chiamata a getByFilename (~4,3s). Una fattura gia' emessa non
 * cambia piu': la si legge una volta e resta in `aruba_fatture_dettaglio`.
 *
 * La migrazione si lancia a mano. Finche' non e' passata la tabella non
 * esiste: qui NIENTE deve rompersi, si torna semplicemente a chiedere tutto
 * ad Aruba come prima. Per questo ogni errore e' inghiottito e loggato una
 * volta sola invece di essere rilanciato.
 */

export interface DettaglioFattura {
    numero_documento: string | null
    data_documento: string | null
    importo: number | null
}

const supabase = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// PostgREST manda i filtri nella query string: `in.()` con 500 filename
// sfonda l'URL e torna 400. Si legge a blocchi.
const BLOCCO = 100

let avvisoDato = false
function avvisa(dove: string, messaggio: string) {
    if (avvisoDato) return
    avvisoDato = true
    console.warn(`[aruba-cache] ${dove}: ${messaggio} — si continua senza cache`)
}

/** Legge i dettagli gia' noti. Mappa vuota se la tabella non c'e' ancora. */
export async function leggiDettagliCache(filenames: string[]): Promise<Map<string, DettaglioFattura>> {
    const out = new Map<string, DettaglioFattura>()
    const unici = [...new Set(filenames.filter(Boolean))]
    if (unici.length === 0) return out

    for (let i = 0; i < unici.length; i += BLOCCO) {
        const blocco = unici.slice(i, i + BLOCCO)
        const { data, error } = await supabase
            .from('aruba_fatture_dettaglio')
            .select('aruba_filename, numero_documento, data_documento, importo')
            .in('aruba_filename', blocco)
        if (error) {
            avvisa('lettura', error.message)
            return out
        }
        for (const r of data || []) {
            out.set(r.aruba_filename, {
                numero_documento: r.numero_documento,
                data_documento: r.data_documento,
                importo: r.importo != null ? Number(r.importo) : null,
            })
        }
    }
    return out
}

/**
 * Salva un dettaglio appena letto da Aruba. Non salva le righe vuote: se la
 * lettura non ha prodotto niente, la prossima volta va ritentata invece di
 * restare a vuoto per sempre in cache.
 */
export async function salvaDettaglioCache(filename: string, d: DettaglioFattura): Promise<void> {
    if (!filename) return
    if (d.numero_documento == null && d.data_documento == null && d.importo == null) return
    const { error } = await supabase
        .from('aruba_fatture_dettaglio')
        .upsert({
            aruba_filename: filename,
            numero_documento: d.numero_documento,
            data_documento: d.data_documento || null,
            importo: d.importo,
            letto_il: new Date().toISOString(),
        }, { onConflict: 'aruba_filename' })
    if (error) avvisa('scrittura', error.message)
}
