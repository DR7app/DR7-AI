/**
 * Link di pagamento rimasti `pending` su una prenotazione: quando ne nasce uno
 * nuovo, o la prenotazione risulta pagata, i vecchi diventano `superseded`.
 *
 * 01/10/2026: senza questo ogni rigenerazione lasciava il link precedente
 * "In attesa" per sempre (463 righe pending in produzione) e non si capiva
 * quale link era quello buono. `nexi_transactions.status` non ha CHECK
 * constraint: 'superseded' e' un valore nuovo ma ammesso.
 *
 * ATTENZIONE: il link sostituito resta PAGABILE su Nexi fino alla sua data di
 * scadenza (Nexi accetta solo una data). Se il cliente lo paga, il callback lo
 * tratta come un pagamento da verificare (vedi pagamentoTardivo.ts): non si
 * perde e non si applica due volte.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/** Scopo del link: in metadata.payment_purpose, 'booking' se assente. */
export function scopoLink(metadata: unknown): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = (metadata || {}) as Record<string, any>
    return String(m.payment_purpose || 'booking').trim().toLowerCase() || 'booking'
}

/**
 * Marca `superseded` i link `pending` della prenotazione con uno degli scopi
 * indicati, tranne `escludiId`. Best-effort: non lancia mai.
 * Ritorna quante righe sono state sostituite.
 */
export async function sostituisciLinkInAttesa(
    supabase: SupabaseClient,
    params: { bookingId: string; scopi: string[]; escludiId?: string | null; sostituitoDa?: string | null; motivo: string },
): Promise<number> {
    try {
        if (!params.bookingId || params.scopi.length === 0) return 0
        const { data, error } = await supabase
            .from('nexi_transactions')
            .select('id, order_id, metadata')
            .eq('booking_id', params.bookingId)
            .eq('status', 'pending')
        if (error) {
            console.warn('[linkInAttesa] lettura fallita:', error.message)
            return 0
        }
        const scopi = new Set(params.scopi.map(s => s.toLowerCase()))
        const daSostituire = (data || []).filter(r => r.id !== params.escludiId && scopi.has(scopoLink(r.metadata)))
        let n = 0
        const adesso = new Date().toISOString()
        for (const r of daSostituire) {
            const { data: agg } = await supabase
                .from('nexi_transactions')
                .update({
                    status: 'superseded',
                    metadata: {
                        ...((r.metadata as Record<string, unknown>) || {}),
                        superseded_at: adesso,
                        superseded_by: params.sostituitoDa || null,
                        superseded_reason: params.motivo,
                    },
                    updated_at: adesso,
                })
                .eq('id', r.id)
                // Se nel frattempo il callback l'ha completato, non si tocca.
                .eq('status', 'pending')
                .select('id')
            if (agg && agg.length > 0) n++
        }
        if (n > 0) console.log(`[linkInAttesa] ${n} link pending sostituiti su booking ${params.bookingId} (${params.motivo})`)
        return n
    } catch (e) {
        console.warn('[linkInAttesa] sostituzione fallita (non bloccante):', e)
        return 0
    }
}
