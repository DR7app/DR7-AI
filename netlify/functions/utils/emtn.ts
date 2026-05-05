/**
 * EMTN shared utilities — validation, OTP, audit log, booking gate.
 *
 * Tutte le Netlify Functions di EMTN (emtn-search, emtn-otp-request,
 * emtn-otp-verify, emtn-event-create, emtn-event-document, emtn-report)
 * importano da qui per restare omogenee sulle hard rules.
 */
import crypto from 'crypto'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

// ── Supabase service client (singleton) ────────────────────
let _sb: SupabaseClient | null = null
export function getServiceSupabase(): SupabaseClient {
    if (_sb) return _sb
    const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error('Supabase service env not configured')
    _sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
    return _sb
}

// ── Codice fiscale validation ──────────────────────────────
const CF_REGEX = /^[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]$/

export function isValidCF(cf: string): boolean {
    return CF_REGEX.test((cf || '').trim().toUpperCase())
}

export function normalizeCF(cf: string): string {
    return (cf || '').trim().toUpperCase()
}

// ── OTP generation + hashing ───────────────────────────────
// Codice 6 cifre, hash SHA-256 hex. Non memorizziamo mai il codice in
// chiaro: la verify confronta hash(input) col campo otp_code_hash.
export function generateOtpCode(): string {
    // 100000-999999 in modo crittograficamente sicuro
    const buf = crypto.randomBytes(4)
    const n = buf.readUInt32BE(0) % 900000 + 100000
    return String(n)
}

export function hashOtpCode(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex')
}

// ── Booking gate ───────────────────────────────────────────
// Hard rule: "no EMTN access without active booking_id". L'admin che
// consulta deve riferirsi a un booking esistente nel sistema DR7. Non
// accettiamo lookup speculativi (anti-fishing).
export interface BookingContext {
    id: string
    customer_name: string | null
    vehicle_plate: string | null
    pickup_date: string | null
    status: string | null
}

export async function requireActiveBooking(
    sb: SupabaseClient,
    bookingId: string | undefined | null,
): Promise<{ booking?: BookingContext; error?: string }> {
    if (!bookingId) return { error: 'booking_id obbligatorio' }
    const { data, error } = await sb
        .from('bookings')
        .select('id, customer_name, vehicle_plate, pickup_date, status')
        .eq('id', bookingId)
        .maybeSingle()
    if (error) return { error: `booking lookup failed: ${error.message}` }
    if (!data) return { error: 'booking_id non trovato' }
    // Status accettati: tutto tranne cancellati. Anche le prenotazioni
    // gia' completate sono "active" ai fini EMTN — il caso d'uso
    // tipico e' segnalare DOPO il rientro.
    const status = String(data.status || '').toLowerCase()
    if (status === 'cancelled' || status === 'annullata') {
        return { error: 'booking cancellato — accesso EMTN non consentito' }
    }
    return { booking: data as BookingContext }
}

// ── Audit log helper ───────────────────────────────────────
// Hard rule: "ALL actions must be logged". Mai eccezioni: anche le
// chiamate fallite generano una riga (success=false) cosi' un eventuale
// abuso o tentativo brute-force resta tracciato.
export type EmtnAction =
    | 'SEARCH'
    | 'REQUEST_OTP'
    | 'VERIFY_OTP'
    | 'VIEW_REPORT'
    | 'REPORT_EVENT'
    | 'UPLOAD_DOCUMENT'

export interface AuditPayload {
    operatorId: string
    operatorEmail?: string
    clientId?: string | null
    bookingId?: string | null
    action: EmtnAction
    success?: boolean
    metadata?: Record<string, unknown>
    ip?: string | null
    userAgent?: string | null
}

export async function audit(sb: SupabaseClient, p: AuditPayload): Promise<void> {
    try {
        await sb.from('emtn_access_logs').insert({
            operator_id: p.operatorId,
            operator_email: p.operatorEmail || null,
            client_id: p.clientId || null,
            booking_id: p.bookingId || null,
            action: p.action,
            success: p.success !== false,
            ip_address: p.ip || null,
            user_agent: p.userAgent || null,
            metadata: p.metadata || null,
        })
    } catch (err) {
        // Loggiamo localmente ma non blocchiamo il flusso principale:
        // un audit fallito non deve far cadere una segnalazione gia'
        // accettata. Pero' va monitorato.
        console.error('[EMTN audit] insert failed:', err)
    }
}

export function clientIp(headers: Record<string, string | undefined>): string | null {
    const xff = headers['x-forwarded-for'] || headers['x-nf-client-connection-ip']
    if (!xff) return null
    return String(xff).split(',')[0].trim() || null
}

// ── OTP unlock check ───────────────────────────────────────
// Hard rule: "no report visibility without OTP verified". Una verify
// conta come "sblocco" se appartiene allo stesso (operator, client),
// e' verified=true e non e' scaduta. La finestra di sblocco e'
// implicita: il record OTP scade come da expires_at.
export async function isReportUnlocked(
    sb: SupabaseClient,
    operatorId: string,
    clientId: string,
): Promise<boolean> {
    const { data } = await sb
        .from('emtn_otp_requests')
        .select('id, expires_at, verified')
        .eq('operator_id', operatorId)
        .eq('client_id', clientId)
        .eq('verified', true)
        .gt('expires_at', new Date().toISOString())
        .order('verified_at', { ascending: false })
        .limit(1)
    return !!(data && data.length > 0)
}

// ── Standard JSON response helper ──────────────────────────
export function jsonResponse(statusCode: number, body: unknown, origin?: string) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': origin || '*',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        },
        body: JSON.stringify(body),
    }
}
