
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: 'Method Not Allowed' }
    }

    try {
        console.log('[get-verification-requests] Fetching all documents...')

        // 1. Fetch all documents
        const { data: documents, error: docsError } = await supabase
            .from('user_documents')
            .select('*')
            .order('upload_date', { ascending: false })

        if (docsError) throw docsError

        if (!documents || documents.length === 0) {
            return {
                statusCode: 200,
                body: JSON.stringify({ success: true, documents: [] })
            }
        }

        // 2. Fetch user details for all unique user_ids
        const userIds = [...new Set(documents.map(d => d.user_id))]
        console.log(`[get-verification-requests] Resolving ${userIds.length} unique user_ids for ${documents.length} docs`)

        const CE_FIELDS = `
            id, user_id, tipo_cliente, nome, cognome, sesso, email,
            telefono, codice_fiscale, data_nascita, luogo_nascita,
            indirizzo, numero_civico, citta_residenza, provincia, cap,
            nazione, numero_patente, categoria_patente, ente_rilascio,
            data_rilascio, data_scadenza, ragione_sociale, denominazione,
            partita_iva, codice_destinatario, pec, codice_ipa,
            codice_univoco, rappresentante_legale, metadata, source,
            created_at, updated_at
        `

        // Chunk .in() queries — Postgres parameter limit + URL length safety.
        async function chunkedIn<T>(table: string, fields: string, col: string, ids: string[]): Promise<T[]> {
            if (ids.length === 0) return []
            const out: T[] = []
            const CHUNK = 200
            for (let i = 0; i < ids.length; i += CHUNK) {
                const slice = ids.slice(i, i + CHUNK)
                const { data, error } = await supabase
                    .from(table)
                    .select(fields)
                    .in(col, slice)
                if (error) {
                    console.error(`[get-verification-requests] ${table}.${col} chunk ${i} error:`, error.message)
                    continue
                }
                if (data) out.push(...(data as T[]))
            }
            return out
        }

        // Fire BOTH customers_extended lookups in parallel — by user_id
        // (real signups) and by id (legacy admin uploads where the doc's
        // user_id is the row PK). Both are fast Postgres queries.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [byUserId, byId] = await Promise.all([
            chunkedIn<any>('customers_extended', CE_FIELDS, 'user_id', userIds),
            chunkedIn<any>('customers_extended', CE_FIELDS, 'id', userIds),
        ])

        const userMap = new Map()
        // Prefer the user_id match — it's the canonical link
        byUserId.forEach(u => { if (u.user_id) userMap.set(u.user_id, u) })
        // Fill in legacy ones whose doc.user_id is actually customers_extended.id
        byId.forEach(u => {
            if (u.id && !userMap.has(u.id)) userMap.set(u.id, u)
        })

        // Optional legacy customers table fallback (best-effort, chunked)
        const stillMissing = userIds.filter(id => !userMap.has(id))
        if (stillMissing.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const legacy = await chunkedIn<any>('customers', 'id, full_name, email, created_at', 'id', stillMissing)
            legacy.forEach(u => userMap.set(u.id, u))
        }

        console.log(`[get-verification-requests] Resolved ${userMap.size}/${userIds.length} users (rest stay as 'Utente sconosciuto')`)

        // 4. Merge data — return everything. Truly orphan rows still show
        //    (with "Utente sconosciuto") so nothing is hidden from review.
        const enrichedDocuments = documents.map(doc => {
            const user = userMap.get(doc.user_id)

            // Determine the best display name
            let fullName = 'Utente sconosciuto';

            if (user) {
                if (user.full_name) {
                    fullName = user.full_name;
                } else if (user.nome || user.cognome) {
                    fullName = `${user.nome || ''} ${user.cognome || ''}`.trim();
                } else if (user.email) {
                    fullName = user.email.split('@')[0];
                }
            } else if (doc.user_full_name) {
                fullName = doc.user_full_name;
            }

            return {
                ...doc,
                user: {
                    id: doc.user_id,
                    full_name: fullName,
                    email: user?.email || doc.user_email || 'Email non disponibile',
                    telefono: user?.telefono,
                    sesso: user?.sesso,
                    codice_fiscale: user?.codice_fiscale,
                    data_nascita: user?.data_nascita,
                    luogo_nascita: user?.luogo_nascita,
                    indirizzo: user?.indirizzo,
                    numero_civico: user?.numero_civico,
                    citta_residenza: user?.citta_residenza,
                    provincia: user?.provincia,
                    cap: user?.cap,
                    nazione: user?.nazione,
                    numero_patente: user?.numero_patente,
                    categoria_patente: user?.categoria_patente,
                    ente_rilascio: user?.ente_rilascio,
                    data_rilascio: user?.data_rilascio,
                    data_scadenza: user?.data_scadenza,
                    ragione_sociale: user?.ragione_sociale,
                    denominazione: user?.denominazione,
                    partita_iva: user?.partita_iva,
                    codice_destinatario: user?.codice_destinatario,
                    pec: user?.pec,
                    codice_ipa: user?.codice_ipa,
                    codice_univoco: user?.codice_univoco,
                    rappresentante_legale: user?.rappresentante_legale,
                    metadata: user?.metadata,
                    tipo_cliente: user?.tipo_cliente,
                    source: user?.source,
                    is_new: user?.created_at ? (new Date().getTime() - new Date(user.created_at).getTime()) < (7 * 24 * 60 * 60 * 1000) : false,
                    created_at: user?.created_at || doc.upload_date,
                    updated_at: user?.updated_at
                }
            }
        })

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, documents: enrichedDocuments })
        }

    } catch (error: any) {
        console.error('Error in get-verification-requests:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        }
    }
}
