
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from './require-auth'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' }
    }

    // 02/09/2026: queste due righe stavano DENTRO l'if qui sopra, dopo il
    // `return`. Su una POST non venivano mai eseguite: la funzione serviva
    // patenti, carte d'identita' e codici fiscali (URL firmati validi 24 h) a
    // chiunque conoscesse un userId. Il controllo va prima di leggere il body.
    const { error: authErr } = await requireAuth(event)
    if (authErr) return authErr

    try {
        const { userId } = JSON.parse(event.body || '{}')

        if (!userId) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing userId' }) }
        }

        console.log(`[get-customer-documents] Fetching for ${userId}`)

        // Un cliente ha DUE identificativi: quello dell'account (auth) e
        // quello della scheda (customers_extended). Il sito carica i
        // documenti sotto il primo, il gestionale sotto il secondo. Guardare
        // solo uno dei due voleva dire non vedere meta' dei documenti.
        const idCollegati = new Set<string>([userId])
        const { data: schede } = await supabase
            .from('customers_extended')
            .select('id, user_id')
            .or(`id.eq.${userId},user_id.eq.${userId}`)
        for (const riga of schede || []) {
            if (riga.id) idCollegati.add(riga.id)
            if (riga.user_id) idCollegati.add(riga.user_id)
        }
        const identificativi = [...idCollegati]

        // 1. Fetch from 'user_documents' table (DB records)
        const { data: dbDocuments, error: dbError } = await supabase
            .from('user_documents')
            .select('*')
            .in('user_id', identificativi)

        if (dbError) console.error('Error fetching user_documents:', dbError)

        const licenseUrls: any[] = []
        const idUrls: any[] = []
        const codiceFiscaleUrls: any[] = []
        const nauticaUrls: any[] = []
        const processedFileNames = new Set<string>()

        // La patente NAUTICA sta nel bucket `driver-licenses` (stesse policy
        // della patente di guida) ma non e' la stessa cosa: senza questo
        // controllo finiva elencata sotto "Patente di Guida", dove nessuno la
        // cerca. Si riconosce dal nome del file, che l'upload scrive sempre
        // come `patente_nautica_front_*` / `_back_*`.
        const isNautica = (fileName: string, documentType?: string | null) =>
            /^patente_nautica/i.test(String(fileName || '')) || /^patente_nautica/i.test(String(documentType || ''))

        // Helper to add to correct list
        const addToList = (bucket: string, fileObj: any, documentType?: string | null) => {
            if (isNautica(fileObj?.fileName, documentType)) nauticaUrls.push(fileObj)
            else if (bucket === 'driver-licenses') licenseUrls.push(fileObj)
            else if (bucket === 'codice-fiscale') codiceFiscaleUrls.push(fileObj)
            else if (bucket === 'driver-ids' || bucket === 'carta-identita' || bucket === 'customer-documents') idUrls.push(fileObj)
        }

        // Process DB docs
        if (dbDocuments) {
            for (const doc of dbDocuments) {
                const bucket = doc.bucket || 'driver-ids'
                const fileName = doc.file_path.split('/').pop() || doc.document_type

                // Generate signed URL
                const { data: signed, error: signError } = await supabase.storage
                    .from(bucket)
                    .createSignedUrl(doc.file_path, 86400)

                if (signed?.signedUrl) {
                    addToList(bucket, {
                        url: signed.signedUrl,
                        fileName: fileName,
                        status: doc.status,
                        source: 'db'
                    }, doc.document_type)
                    processedFileNames.add(fileName)
                }
            }
        }

        // 2. Fetch from Storage Buckets (Direct list) to catch files not in DB
        const BUCKETS = ['driver-licenses', 'driver-ids', 'codice-fiscale', 'carta-identita', 'customer-documents']

        const coppie = BUCKETS.flatMap(bucket => identificativi.map(id => ({ bucket, id })))

        await Promise.all(coppie.map(async ({ bucket, id }) => {
            const { data: files } = await supabase.storage
                .from(bucket)
                .list(id, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } })

            if (files) {
                for (const file of files) {
                    // Skip placeholders and already processed files
                    if (!file.id || file.name.includes('.emptyFolderPlaceholder')) continue
                    if (processedFileNames.has(file.name)) continue
                    processedFileNames.add(file.name)

                    const path = `${id}/${file.name}`
                    const { data: signed } = await supabase.storage
                        .from(bucket)
                        .createSignedUrl(path, 86400)

                    if (signed?.signedUrl) {
                        addToList(bucket, {
                            url: signed.signedUrl,
                            fileName: file.name,
                            source: 'storage'
                        })
                    }
                }
            }
        }))

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                documents: {
                    licenses: licenseUrls,
                    ids: idUrls,
                    codiceFiscale: codiceFiscaleUrls,
                    nautica: nauticaUrls
                }
            })
        }

    } catch (error: any) {
        console.error('Error in get-customer-documents:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        }
    }
}
