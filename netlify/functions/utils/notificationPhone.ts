// Shared helper for outgoing WhatsApp notifications. Lookup order:
//   1) centralina_pro_config.config.notifications.admin_whatsapp_phone
//   2) process.env.NOTIFICATION_PHONE
//   3) hardcoded fallback '393457905205' (historical admin number)
// Direzione can change the receiving number from the admin UI (Gestione OTP
// > Canali di notifica) without redeploying.
import { createClient } from '@supabase/supabase-js'

const HARDCODED_FALLBACK = '393457905205'

let cachedClient: ReturnType<typeof createClient> | null = null
function getClient() {
    if (cachedClient) return cachedClient
    const url = process.env.VITE_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) return null
    cachedClient = createClient(url, key)
    return cachedClient
}

function sanitize(p: unknown): string | null {
    if (typeof p !== 'string') return null
    const cleaned = p.replace(/[\s+-]/g, '')
    return /^\d{9,15}$/.test(cleaned) ? cleaned : null
}

/**
 * Returns the WhatsApp number used for admin/operational notifications.
 * Empty config falls through to env var, then hardcoded fallback.
 */
export async function getAdminNotificationPhone(): Promise<string> {
    try {
        const client = getClient()
        if (client) {
            const { data } = await client
                .from('centralina_pro_config')
                .select('config')
                .eq('id', 'main')
                .maybeSingle()
            const cfg = (data?.config || {}) as Record<string, unknown>
            const notif = (cfg.notifications || {}) as Record<string, unknown>
            const v = sanitize(notif.admin_whatsapp_phone)
            if (v) return v
        }
    } catch (e) {
        console.warn('[notificationPhone] config lookup failed, using fallback', e)
    }
    return sanitize(process.env.NOTIFICATION_PHONE) || HARDCODED_FALLBACK
}
