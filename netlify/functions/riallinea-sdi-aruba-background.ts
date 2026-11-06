/**
 * riallinea-sdi-aruba-background — rilegge su Aruba, UNA PER UNA, lo stato
 * SDI di tutte le fatture gia' trasmesse e allinea il gestionale.
 *
 * 07/11/2026: 114 fatture "Accettata" nel gestionale erano "Scartata" su
 * Aruba. Il giro automatico guardava solo le fatture in attesa e il
 * riallineamento in blocco non leggeva la lista Aruba. Questa function e'
 * il riallineamento una tantum (bottone "Verifica tutte su Aruba" in
 * Fatturazione): stessa lettura del giro automatico (getByFilename),
 * stessa tabella di stati (utils/statoSdiAruba.ts).
 *
 * - Solo lettura verso Aruba: nessun reinvio, nessuna fattura nuova.
 * - Fatture: sending / sent / accepted / rejected con un file Aruba.
 *   Le bozze (anche quelle riportate in bozza per il reinvio) e gli
 *   'error' di caricamento non si toccano.
 * - Ordine: prima le mai verificate, poi la verifica piu' vecchia
 *   (sdi_response.verificato_il). Ogni fattura letta riceve l'ora della
 *   verifica, quindi rilanciare riparte da dove si era fermata.
 * - Ritmo: 1 lettura ogni 1,2 s (Aruba risponde 429 sopra ~1/s), circa
 *   650 fatture per giro di 14 minuti (limite Netlify: 15).
 *
 * Background function: risponde 202 subito, il lavoro continua dietro.
 */
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from './require-auth'
import { COLONNE_VERIFICA_SDI, verificaFatturaSuAruba, type RigaVerificaSdi } from './_check-sdi-statuses'

const supabase = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ARUBA_THROTTLE_MS = 1200
const PAUSA_429_MS = 30_000
const MAX_429_DI_FILA = 4
const BUDGET_MS = 14 * 60 * 1000
const BLOCCO = 50
const STATI_DA_VERIFICARE = ['sending', 'sent', 'accepted', 'rejected', 'scartata']

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export const handler: Handler = async (event) => {
    const { error: authErr, user } = await requireAuth(event as unknown as { headers: Record<string, string> })
    if (authErr) return authErr

    const inizio = Date.now()
    const avvio = new Date(inizio).toISOString()
    let verificate = 0
    let errori = 0
    let di429 = 0
    const cambi: { numero: string; da: string | null; a: string | null; statoAruba: string }[] = []
    const giaProvate = new Set<string>()

    console.log(`[riallinea-sdi] avvio da ${user?.email || user?.id || '?'} alle ${avvio}`)

    try {
        while (Date.now() - inizio < BUDGET_MS) {
            const { data, error } = await supabase
                .from('fatture')
                .select(COLONNE_VERIFICA_SDI)
                .in('sdi_status', STATI_DA_VERIFICARE)
                // Ogni caricamento su Aruba scrive xml_filename insieme ad
                // aruba_upload_filename (send-invoice-to-sdi, auto-invio).
                .not('xml_filename', 'is', null)
                // Solo quelle non ancora lette in questo giro.
                .or(`sdi_response->>verificato_il.is.null,sdi_response->>verificato_il.lt."${avvio}"`)
                .order('sdi_response->>verificato_il', { ascending: true, nullsFirst: true })
                .order('sdi_sent_at', { ascending: false, nullsFirst: false })
                .limit(BLOCCO)
            if (error) throw new Error('DB: ' + error.message)
            // Una fattura che Aruba non trova resta senza verificato_il:
            // la si salta per non ripescarla all'infinito in questo giro.
            const righe = ((data || []) as RigaVerificaSdi[]).filter(r => !giaProvate.has(r.id))
            if (righe.length === 0) break

            for (const riga of righe) {
                if (Date.now() - inizio >= BUDGET_MS) break
                giaProvate.add(riga.id)
                try {
                    const esito = await verificaFatturaSuAruba(riga)
                    verificate++
                    di429 = 0
                    if (esito.cambiato) {
                        cambi.push({ numero: riga.numero_fattura || '', da: esito.da, a: esito.a, statoAruba: esito.statoAruba })
                    }
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err)
                    if (msg.includes('429')) {
                        di429++
                        giaProvate.delete(riga.id) // la si riprova dopo la pausa
                        if (di429 >= MAX_429_DI_FILA) throw new Error('Aruba continua a rispondere 429: giro interrotto, rilanciare piu\' tardi')
                        console.warn(`[riallinea-sdi] 429 da Aruba, pausa ${PAUSA_429_MS / 1000}s`)
                        await sleep(PAUSA_429_MS)
                        continue
                    }
                    errori++
                    console.warn(`[riallinea-sdi] ${riga.numero_fattura}: ${msg.slice(0, 200)}`)
                }
                await sleep(ARUBA_THROTTLE_MS)
            }
        }
    } catch (err: unknown) {
        console.error('[riallinea-sdi] interrotto:', err instanceof Error ? err.message : String(err))
    }

    const perTipo: Record<string, number> = {}
    for (const c of cambi) perTipo[`${c.da}->${c.a}`] = (perTipo[`${c.da}->${c.a}`] || 0) + 1
    console.log('[riallinea-sdi] fine', JSON.stringify({
        verificate, errori, cambiate: cambi.length, perTipo,
        minuti: Math.round((Date.now() - inizio) / 60000),
        esempi: cambi.slice(0, 30),
    }))

    return { statusCode: 202, body: '' }
}
