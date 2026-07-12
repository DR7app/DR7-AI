// 2026-07-12: Controllo incrociato AUTOMATICO di fine mese fatture vs bolle/DDT
// per TUTTI i fornitori. Prima il crosscheck (runCrosscheck +
// applyCrosscheckToFatture) girava solo quando l'admin apriva la Panoramica di
// un fornitore: le anomalie di fine mese restavano invisibili finché qualcuno
// non ci entrava. Questo cron gira il 1° del mese e controlla il mese PRECEDENTE
// per ogni fornitore: aggiorna lo stato fattura (verificato/anomalia) e crea gli
// alert di discrepanza, esattamente come il pulsante manuale.
import { schedule } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const MESI_IT = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']
const AUTO_STATES = new Set(['caricato', 'verificato', 'anomalia'])

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CrosscheckRow = any

async function upsertAlert(p: { fornitore_id: string; document_id: string; tipo: string; messaggio: string; metadata: Record<string, unknown> }): Promise<boolean> {
    // Dedupe: salta se esiste già un alert aperto per (document_id, tipo).
    const { data: existing } = await supabase
        .from('fornitore_alerts')
        .select('id')
        .eq('document_id', p.document_id)
        .eq('tipo', p.tipo)
        .in('status', ['open', 'acknowledged'])
        .maybeSingle()
    if (existing) return false
    const { error } = await supabase.from('fornitore_alerts').insert({
        fornitore_id: p.fornitore_id,
        document_id: p.document_id,
        tipo: p.tipo,
        severity: 'error',
        messaggio: p.messaggio,
        metadata: p.metadata,
    })
    if (error) { console.error('[fornitori-crosscheck-cron] alert insert error', error.message); return false }
    return true
}

const cronHandler = async () => {
    // Mese PRECEDENTE (a inizio mese controlliamo il mese appena chiuso).
    const now = new Date()
    let anno = now.getFullYear()
    let mese = now.getMonth() // getMonth() 0-based → questo è il mese precedente in 1-based
    if (mese === 0) { mese = 12; anno -= 1 }
    console.log(`[fornitori-crosscheck-cron] controllo periodo ${MESI_IT[mese - 1]} ${anno}`)

    // Tutte le fatture del periodo (per conoscere lo stato corrente + il fornitore).
    const { data: fatture, error: fErr } = await supabase
        .from('fornitore_documents')
        .select('id, fornitore_id, stato, periodo_anno, periodo_mese, fornitori:fornitori(nome)')
        .eq('tipo', 'fattura')
        .eq('periodo_anno', anno)
        .eq('periodo_mese', mese)
    if (fErr) { console.error('[fornitori-crosscheck-cron] fatture fetch error', fErr.message); return { statusCode: 500, body: fErr.message } }
    if (!fatture || fatture.length === 0) {
        console.log('[fornitori-crosscheck-cron] nessuna fattura nel periodo — niente da controllare')
        return { statusCode: 200, body: JSON.stringify({ ok: true, checked: 0 }) }
    }

    // Raggruppa per fornitore.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byFornitore = new Map<string, { nome: string; fatture: any[] }>()
    for (const f of fatture as any[]) {
        if (!byFornitore.has(f.fornitore_id)) byFornitore.set(f.fornitore_id, { nome: f.fornitori?.nome || 'fornitore', fatture: [] })
        byFornitore.get(f.fornitore_id)!.fatture.push(f)
    }

    let statiAggiornati = 0, alertCreati = 0, fornitoriControllati = 0
    const periodoLabel = `${MESI_IT[mese - 1]} ${anno}`

    for (const [fornitoreId, info] of byFornitore) {
        fornitoriControllati++
        const { data: rows, error: rpcErr } = await supabase.rpc('fornitore_fatture_crosscheck', {
            p_fornitore_id: fornitoreId, p_anno: anno, p_mese: mese,
        })
        if (rpcErr) { console.error(`[fornitori-crosscheck-cron] RPC error fornitore ${fornitoreId}:`, rpcErr.message); continue }

        for (const row of (rows || []) as CrosscheckRow[]) {
            const fattura = info.fatture.find(x => x.id === row.fattura_id)
            if (!fattura) continue
            if (!AUTO_STATES.has(fattura.stato)) continue           // non toccare stati manuali
            if (fattura.stato === row.stato_calcolato) continue     // già allineato

            const { error: upErr } = await supabase.from('fornitore_documents').update({ stato: row.stato_calcolato }).eq('id', fattura.id)
            if (!upErr) statiAggiornati++

            if (row.stato_calcolato === 'anomalia') {
                const fatturaDataIT = row.fattura_data ? new Date(row.fattura_data).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''
                const dataLabel = fatturaDataIT ? ` del ${fatturaDataIT}` : ''
                let tipo: string, messaggio: string
                if (Number(row.ddt_totale) === 0) {
                    tipo = 'bolle_mancanti'
                    messaggio = `Fattura n.${row.fattura_numero}${dataLabel} di €${Number(row.fattura_totale).toFixed(2)} — ${info.nome}: nessun DDT/bolla caricato (periodo ${periodoLabel}). Verificare ricezione merce o caricare i documenti corrispondenti.`
                } else {
                    tipo = 'anomalia_importi'
                    const sign = Number(row.differenza) > 0 ? '+' : ''
                    messaggio = `Fattura n.${row.fattura_numero}${dataLabel} di €${Number(row.fattura_totale).toFixed(2)} — ${info.nome}: importo non corrispondente ai DDT/bolle (€${Number(row.ddt_totale).toFixed(2)}) (periodo ${periodoLabel}). Differenza ${sign}€${Number(row.differenza).toFixed(2)}. Verificare quantità, prezzi unitari o sconti.`
                }
                const created = await upsertAlert({
                    fornitore_id: fornitoreId,
                    document_id: fattura.id,
                    tipo,
                    messaggio,
                    metadata: {
                        fattura_numero: row.fattura_numero, fattura_data: row.fattura_data,
                        fattura_totale: row.fattura_totale, ddt_totale: row.ddt_totale, differenza: row.differenza,
                        periodo_anno: anno, periodo_mese: mese, fornitore_nome: info.nome, auto: true,
                    },
                })
                if (created) alertCreati++
            }
        }
    }

    console.log(`[fornitori-crosscheck-cron] fatto: ${fornitoriControllati} fornitori, ${statiAggiornati} stati aggiornati, ${alertCreati} alert creati (periodo ${periodoLabel})`)
    return { statusCode: 200, body: JSON.stringify({ ok: true, periodo: periodoLabel, fornitoriControllati, statiAggiornati, alertCreati }) }
}

// Gira il 1° del mese alle 07:00 (Rome ~= UTC+1/2) sul mese precedente.
export const handler = schedule('0 7 1 * *', cronHandler)
