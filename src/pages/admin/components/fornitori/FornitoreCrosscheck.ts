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

interface CrosscheckContext {
    fornitoreNome?: string
    anno?: number
    mese?: number
}

const MESI_IT = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']

function fmtPeriodo(anno?: number, mese?: number): string {
    if (!anno || !mese || mese < 1 || mese > 12) return ''
    return `${MESI_IT[mese - 1]} ${anno}`
}

/**
 * Apply the cross-check result to each fattura's stato.
 * - Only changes 'caricato', 'verificato', 'anomalia' states (auto-states).
 * - Won't override manual states like 'in_verifica', 'approvato', 'pagato', etc.
 *
 * The optional `context` argument enriches alert messages with the fornitore
 * name and the period being checked, so admins can see at a glance what's
 * wrong without opening the document.
 */
export async function applyCrosscheckToFatture(
    rows: CrosscheckRow[],
    fatture: FornitoreDocument[],
    context: CrosscheckContext = {},
): Promise<void> {
    const AUTO_STATES = new Set(['caricato', 'verificato', 'anomalia'])
    const updates: PromiseLike<unknown>[] = []
    const periodo = fmtPeriodo(context.anno, context.mese)
    const fornitoreLabel = context.fornitoreNome ? ` — ${context.fornitoreNome}` : ''

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

        if (row.stato_calcolato === 'anomalia') {
            const fatturaDataIT = row.fattura_data
                ? new Date(row.fattura_data).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
                : ''
            const dataLabel = fatturaDataIT ? ` del ${fatturaDataIT}` : ''
            const periodoLabel = periodo ? ` (periodo ${periodo})` : ''

            // Detailed reason — admins should know exactly WHY the alert fired.
            let messaggio: string
            let tipo: 'bolle_mancanti' | 'anomalia_importi'
            if (row.ddt_totale === 0) {
                tipo = 'bolle_mancanti'
                messaggio = `Fattura n.${row.fattura_numero}${dataLabel} di €${row.fattura_totale.toFixed(2)}${fornitoreLabel}: nessun DDT/bolla caricato${periodoLabel}. Verificare ricezione merce o caricare i documenti corrispondenti.`
            } else {
                tipo = 'anomalia_importi'
                const sign = row.differenza > 0 ? '+' : ''
                messaggio = `Fattura n.${row.fattura_numero}${dataLabel} di €${row.fattura_totale.toFixed(2)}${fornitoreLabel}: importo non corrispondente ai DDT/bolle (€${row.ddt_totale.toFixed(2)})${periodoLabel}. Differenza ${sign}€${row.differenza.toFixed(2)}. Verificare quantità, prezzi unitari o sconti.`
            }

            updates.push(
                supabase.from('fornitore_alerts').insert({
                    fornitore_id: fattura.fornitore_id,
                    document_id: fattura.id,
                    tipo,
                    severity: 'error',
                    messaggio,
                    metadata: {
                        fattura_numero: row.fattura_numero,
                        fattura_data: row.fattura_data,
                        fattura_totale: row.fattura_totale,
                        ddt_totale: row.ddt_totale,
                        differenza: row.differenza,
                        periodo_anno: context.anno ?? null,
                        periodo_mese: context.mese ?? null,
                        fornitore_nome: context.fornitoreNome ?? null,
                    },
                }).then()
            )
        }
    }
    await Promise.all(updates)
}
