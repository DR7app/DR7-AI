
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
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

        // We'll try to fetch from customers_extended first
        const { data: users, error: usersError } = await supabase
            .from('customers_extended')
            .select('id, nome, cognome, email, created_at')
            .in('id', userIds)

        if (usersError) console.error('Error fetching users:', usersError)

        const userMap = new Map()
        if (users) {
            users.forEach(u => userMap.set(u.id, u))
        }

        // 3. Merge data
        const enrichedDocuments = documents.map(doc => {
            const user = userMap.get(doc.user_id)
            return {
                ...doc,
                user: {
                    id: doc.user_id,
                    full_name: user ? `${user.nome || ''} ${user.cognome || ''}`.trim() : (doc.user_full_name || 'Utente sconosciuto'),
                    email: user?.email || doc.user_email || 'Email non disponibile',
                    is_new: user?.created_at ? (new Date().getTime() - new Date(user.created_at).getTime()) < (7 * 24 * 60 * 60 * 1000) : false,
                    created_at: user?.created_at || doc.upload_date
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
