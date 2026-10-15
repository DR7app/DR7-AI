/**
 * Contratti programmati — scheduled cron (ogni 5 minuti, netlify.toml).
 *
 * 15/10/2026: con Centralina Pro > Contratto & Modifiche > Invio contratto
 * diverso da "Subito", signature-init non manda il link ma scrive l'orario in
 * contratti_invio_programmato. Questo cron prende le righe arrivate all'ora e
 * chiama signature-init con `immediato: true`, cosi' l'invio passa dagli
 * stessi controlli di sempre (prenotazione annullata, interruttori System
 * Control, firmatari gia' firmati, una sola richiesta attiva).
 *
 * - Contratto gia' firmato: la riga si chiude senza inviare nulla.
 * - signature-init risponde 409 (prenotazione annullata): riga annullata.
 * - Altri errori: si riprova al giro dopo, al massimo MAX_TENTATIVI volte.
 */
import { schedule } from '@netlify/functions'
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { conSystemControl } from './utils/systemControl'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const BASE_URL = process.env.URL || 'https://platform.dr7ai.com'

const MAX_TENTATIVI = 3
const MAX_PER_GIRO = 25

interface Programmato {
    booking_id: string
    invia_dopo: string
    resign: boolean
    tentativi: number
}

const cronHandler: Handler = async () => {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const ora = new Date().toISOString()

    const { data, error } = await supabase
        .from('contratti_invio_programmato')
        .select('booking_id, invia_dopo, resign, tentativi')
        .eq('stato', 'programmato')
        .lte('invia_dopo', ora)
        .order('invia_dopo', { ascending: true })
        .limit(MAX_PER_GIRO)
    if (error) {
        console.error('[contratti-programmati] lettura fallita:', error.message)
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) }
    }

    const righe = (data || []) as Programmato[]
    let inviati = 0, chiusi = 0, errori = 0

    for (const r of righe) {
        const aggiorna = (campi: Record<string, unknown>) => supabase
            .from('contratti_invio_programmato')
            .update({ ...campi, aggiornato_at: new Date().toISOString() })
            .eq('booking_id', r.booking_id)
            .eq('stato', 'programmato')

        // Contratto gia' firmato (es. firmato da un link mandato a mano):
        // niente da inviare.
        const { data: contratto } = await supabase
            .from('contracts')
            .select('signed_pdf_url')
            .eq('booking_id', r.booking_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        if (contratto?.signed_pdf_url && !r.resign) {
            await aggiorna({ stato: 'inviato', ultimo_errore: 'contratto gia firmato' })
            chiusi++
            continue
        }

        try {
            const res = await fetch(`${BASE_URL}/.netlify/functions/signature-init`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookingId: r.booking_id, immediato: true, ...(r.resign ? { resign: true } : {}) }),
            })
            const corpo = await res.json().catch(() => ({} as { error?: string }))
            if (res.ok) {
                // signature-init chiude gia' la riga; qui per sicurezza.
                await aggiorna({ stato: 'inviato', ultimo_errore: null })
                inviati++
            } else if (res.status === 409) {
                await aggiorna({ stato: 'annullato', ultimo_errore: corpo?.error || 'prenotazione annullata' })
                chiusi++
            } else {
                const tentativi = (r.tentativi || 0) + 1
                await aggiorna({
                    tentativi,
                    ultimo_errore: corpo?.error || `HTTP ${res.status}`,
                    ...(tentativi >= MAX_TENTATIVI ? { stato: 'errore' } : {}),
                })
                errori++
            }
        } catch (e) {
            const tentativi = (r.tentativi || 0) + 1
            await aggiorna({
                tentativi,
                ultimo_errore: (e as Error).message,
                ...(tentativi >= MAX_TENTATIVI ? { stato: 'errore' } : {}),
            })
            errori++
        }
    }

    console.log(`[contratti-programmati] ${righe.length} da inviare: ${inviati} inviati, ${chiusi} chiusi, ${errori} errori`)
    return { statusCode: 200, body: JSON.stringify({ trovati: righe.length, inviati, chiusi, errori }) }
}

export const handler = schedule('*/5 * * * *', conSystemControl('contratti-programmati-cron', cronHandler, { cron: true }))
