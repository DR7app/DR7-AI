
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' }
    }

    try {
        const { userId } = JSON.parse(event.body || '{}')

        if (!userId) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing userId' }) }
        }

        console.log(`[get-customer-documents] Fetching for ${userId}`)

        // 1. Fetch from 'user_documents' table (DB records)
        const { data: dbDocuments, error: dbError } = await supabase
            .from('user_documents')
            .select('*')
            .eq('user_id', userId)

        if (dbError) console.error('Error fetching user_documents:', dbError)

        const licenseUrls: any[] = []
        const idUrls: any[] = []
        const codiceFiscaleUrls: any[] = []
        const processedFileNames = new Set<string>()

        // Helper to add to correct list
        const addToList = (bucket: string, fileObj: any) => {
            if (bucket === 'driver-licenses') licenseUrls.push(fileObj)
            else if (bucket === 'codice-fiscale') codiceFiscaleUrls.push(fileObj)
            else if (bucket === 'driver-ids' || bucket === 'carta-identita') idUrls.push(fileObj)
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
                    })
                    processedFileNames.add(fileName)
                }
            }
        }

        // 2. Fetch from Storage Buckets (Direct list) to catch files not in DB
        const BUCKETS = ['driver-licenses', 'driver-ids', 'codice-fiscale', 'carta-identita']

        await Promise.all(BUCKETS.map(async (bucket) => {
            const { data: files } = await supabase.storage
                .from(bucket)
                .list(userId, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } })

            if (files) {
                for (const file of files) {
                    // Skip placeholders and already processed files
                    if (!file.id || file.name.includes('.emptyFolderPlaceholder')) continue
                    if (processedFileNames.has(file.name)) continue

                    const path = `${userId}/${file.name}`
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
                    codiceFiscale: codiceFiscaleUrls
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
