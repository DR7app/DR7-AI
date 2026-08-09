/**
 * Verifica lato SERVER di un'autorizzazione OTP (roadmap #43).
 *
 * Il pattern "avviso sempre, blocco mai" funziona da solo finche' il blocco
 * vive nel browser: si avvisa, si chiede l'OTP, si procede. Non basta quando
 * la stessa regola e' ripetuta in una Netlify Function, perche' l'operatore
 * otterrebbe l'autorizzazione della direzione e poi un 400 dal server —
 * peggio del blocco secco, perche' l'OTP e' gia' stato disturbato.
 *
 * Da qui: il client passa l'`overrideId` restituito da limitation-override-otp
 * e il server controlla che sia davvero approvato, non scaduto e relativo alla
 * regola giusta. Non ci si fida MAI del solo fatto che il client dica "sono
 * autorizzato": l'id viene riletto dal database.
 *
 * Uso:
 *   const authorized = await hasApprovedOverride(supabase, body.overrideId, 'fattura.booking_non_pagato')
 *   if (!paid && !authorized) return 400
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/** Stati in cui l'autorizzazione e' valida e spendibile. */
const VALID_STATUSES = ['active', 'consumed']

/**
 * true se `overrideId` e' un'autorizzazione approvata, non scaduta e per il
 * codice atteso. Qualsiasi anomalia (id assente, codice diverso, scaduta,
 * errore di lettura) -> false: in caso di dubbio si nega, l'operatore vede il
 * messaggio di blocco e puo' richiedere l'OTP.
 *
 * `consumed` e' accettato perche' il client marca l'override come consumato
 * appena l'azione parte: al momento in cui il server verifica puo' gia' essere
 * in quello stato. La finestra resta comunque limitata da `expires_at`.
 */
export async function hasApprovedOverride(
    supabase: SupabaseClient,
    overrideId: unknown,
    expectedCode: string
): Promise<boolean> {
    if (!overrideId || typeof overrideId !== 'string') return false
    try {
        const { data, error } = await supabase
            .from('limitation_overrides')
            .select('id, limitation_code, status, expires_at')
            .eq('id', overrideId)
            .maybeSingle()
        if (error || !data) {
            if (error) console.warn('[verifyOverride] lettura fallita:', error.message)
            return false
        }
        if (data.limitation_code !== expectedCode) {
            console.warn(`[verifyOverride] codice non corrispondente: atteso ${expectedCode}, trovato ${data.limitation_code}`)
            return false
        }
        if (!VALID_STATUSES.includes(String(data.status))) {
            console.warn(`[verifyOverride] override ${overrideId} in stato ${data.status}: non valido`)
            return false
        }
        if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
            console.warn(`[verifyOverride] override ${overrideId} scaduto il ${data.expires_at}`)
            return false
        }
        console.log(`[verifyOverride] override ${overrideId} valido per ${expectedCode}`)
        return true
    } catch (err) {
        console.error('[verifyOverride] errore inatteso:', (err as Error).message)
        return false
    }
}
