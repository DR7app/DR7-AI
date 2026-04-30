import { supabase } from '../../../../supabaseClient'
import type { FornitoreDocument, CrosscheckRow } from './types'

/**
 * Cross-check fatture vs DDT/bolle in a given month for a fornitore.
 * Calls the SQL function fornitore_fatture_crosscheck and returns rows.
 */
export async function runCrosscheck(fornitoreId: string, anno: number, mese: number): Promise<CrosscheckRow[]> {
    const { data, error } = await supabase.rpc('fornitore_fatture_crosscheck', {
        p_fornitore_id: fornitoreId,
        p_anno: anno,
        p_mese: mese,
    })
    if (error) {
        console.error('[crosscheck] error', error)
        return []
    }
    return (data || []) as CrosscheckRow[]
}

/**
 * Apply the cross-check result to each fattura's stato.
 * - Only changes 'caricato', 'verificato', 'anomalia' states (auto-states).
 * - Won't override manual states like 'in_verifica', 'approvato', 'pagato', etc.
 */
export async function applyCrosscheckToFatture(rows: CrosscheckRow[], fatture: FornitoreDocument[]): Promise<void> {
    const AUTO_STATES = new Set(['caricato', 'verificato', 'anomalia'])
    // Supabase's query builder is PromiseLike, not Promise. Promise.all
    // accepts PromiseLike so this is fine — the typed annotation just has
    // to match what the calls actually return.
    const updates: PromiseLike<unknown>[] = []
    for (const row of rows) {
        const fattura = fatture.find(f => f.id === row.fattura_id)
        if (!fattura) continue
        if (!AUTO_STATES.has(fattura.stato)) continue
        if (fattura.stato === row.stato_calcolato) continue
        updates.push(
            supabase.from('fornitore_documents')
                .update({ stato: row.stato_calcolato })
                .eq('id', fattura.id)
                .then()
        )
        // Create alert if anomalia
        if (row.stato_calcolato === 'anomalia') {
            const messaggio = row.ddt_totale === 0
                ? `Fattura n.${row.fattura_numero} (€${row.fattura_totale.toFixed(2)}) priva di DDT/bolle nel mese`
                : `Fattura n.${row.fattura_numero} (€${row.fattura_totale.toFixed(2)}) non quadra con DDT/bolle (€${row.ddt_totale.toFixed(2)}) — diff €${row.differenza.toFixed(2)}`
            updates.push(
                supabase.from('fornitore_alerts').insert({
                    fornitore_id: fattura.fornitore_id,
                    document_id: fattura.id,
                    tipo: row.ddt_totale === 0 ? 'bolle_mancanti' : 'anomalia_importi',
                    severity: 'error',
                    messaggio,
                    metadata: {
                        fattura_totale: row.fattura_totale,
                        ddt_totale: row.ddt_totale,
                        differenza: row.differenza,
                    },
                }).then()
            )
        }
    }
    await Promise.all(updates)
}
