import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../require-auth'

/**
 * Solo lo staff DR7 legge l'audit trail e la sicurezza delle firme.
 * 25/09/2026: prima signature-audit rispondeva a chiunque avesse l'id del
 * contratto (nome, email, telefono, IP del cliente). requireAuth da solo non
 * basta: anche un cliente registrato sul sito ha un token valido.
 * Stessa regola della RLS dr7_is_staff(): riga attiva in `admins`, piu' la
 * direzione (stesse email di dr7_is_direzione()).
 */
const DIREZIONE = new Set(['valerio@dr7.app', 'ilenia@dr7.app', 'ophe@dr7.app'])

type Risposta = { statusCode: number; headers?: Record<string, string>; body: string }

export async function richiediStaff(
    event: { headers: Record<string, string> },
): Promise<{ email: string; risposta: null } | { email: null; risposta: Risposta }> {
    const { user, error } = await requireAuth(event)
    if (error || !user) return { email: null, risposta: error || { statusCode: 401, body: JSON.stringify({ error: 'Non autenticato' }) } }

    const email = String(user.email || '').toLowerCase()
    if (user.id === 'admin' || DIREZIONE.has(email)) return { email: email || 'admin', risposta: null }

    const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data } = await supabase
        .from('admins')
        .select('id')
        .eq('user_id', user.id)
        .is('archived_at', null)
        .maybeSingle()
    if (!data) {
        return { email: null, risposta: { statusCode: 403, body: JSON.stringify({ error: 'Riservato allo staff DR7' }) } }
    }
    return { email, risposta: null }
}
