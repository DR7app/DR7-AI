// =============================================================================
// sync-ipa — Job mensile di aggiornamento della rubrica enti_notificatori dal
// registro ufficiale IPA (Indice dei domicili digitali della PA).
// Spec "Multe — Destinatario PEC dinamico" FASE 5. Nessuna chiamata esterna in
// fase di invio: qui importiamo una volta al mese e l'invio legge la tabella
// locale. Fonte: amministrazioni.txt (tab-separated) — contiene denominazione,
// comune, provincia, regione e le PEC (mail1..5 con tipo_mailN='pec').
//
// Endpoint verificato sul portale (23/07/2026):
//   https://indicepa.gov.it/ipa-dati/dataset/amministrazioni/resource/...
// Override possibile via env IPA_AMMINISTRAZIONI_URL.
//
// Trigger: schedulato (1 del mese, 03:00 UTC) + POST manuale (bottone in UI).
// Upsert per codice_ipa: NON tocca le righe fonte 'manuale'/'verbale' (hanno
// codice_ipa NULL, quindi niente conflitto).
// =============================================================================
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const IPA_URL = process.env.IPA_AMMINISTRAZIONI_URL
    || 'https://indicepa.gov.it/ipa-dati/dataset/502ff370-1b2c-4310-94c7-f39ceb7500e3/resource/3ed63523-ff9c-41f6-a6fe-980f3d9e501f/download/amministrazioni.txt'

// Classifica il tipo_ente dalla denominazione (best-effort; default 'altro').
function classifyTipo(denom: string): string {
    const d = (denom || '').toLowerCase()
    if (/polizia\s+local|polizia\s+municipal|corpo.*vigili|comando.*vigili/.test(d)) return 'polizia_locale'
    if (/polizia\s+provincial/.test(d)) return 'polizia_provinciale'
    if (/polizia\s+strada|polizia\s+di\s+stato|questura|prefettura/.test(d)) return 'polizia_stradale'
    if (/carabinier/.test(d)) return 'carabinieri'
    if (/guardia\s+di\s+finanza/.test(d)) return 'gdf'
    if (/autostrad|concessionar/.test(d)) return 'concessionaria'
    return 'altro'
}

interface EnteRow {
    codice_ipa: string
    denominazione: string
    comune: string | null
    provincia: string | null
    regione: string | null
    pec: string
    tipo_ente: string
    fonte: string
    verificata_il: string
}

async function fetchAndParse(): Promise<EnteRow[]> {
    const res = await fetch(IPA_URL, { headers: { 'User-Agent': 'DR7-gestionale/sync-ipa' } })
    if (!res.ok) throw new Error(`Download IPA fallito: HTTP ${res.status}`)
    const buf = await res.arrayBuffer()
    const text = new TextDecoder('utf-8').decode(buf)

    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0)
    if (lines.length < 2) throw new Error('File IPA vuoto o non valido')

    const header = lines[0].split('\t').map(h => h.trim().toLowerCase())
    const idx = (name: string) => header.indexOf(name)
    const iCod = idx('cod_amm')
    const iDes = idx('des_amm')
    const iComune = idx('comune')
    const iProv = idx('provincia')
    const iReg = idx('regione')
    // Coppie mail/tipo (mail1..mail5) + eventuale colonna domicilio_digitale.
    const mailCols: Array<{ mail: number; tipo: number }> = []
    for (let n = 1; n <= 5; n++) {
        const m = idx(`mail${n}`); const t = idx(`tipo_mail${n}`)
        if (m >= 0) mailCols.push({ mail: m, tipo: t })
    }
    const iDomicilio = idx('domicilio_digitale')

    if (iCod < 0 || iDes < 0) {
        throw new Error(`Header IPA inatteso (cod_amm/des_amm mancanti). Colonne: ${header.join(', ')}`)
    }

    const now = new Date().toISOString()
    const out: EnteRow[] = []
    const seen = new Set<string>()
    for (let r = 1; r < lines.length; r++) {
        const c = lines[r].split('\t')
        const codice_ipa = (c[iCod] || '').trim()
        const denominazione = (c[iDes] || '').trim()
        if (!codice_ipa || !denominazione || seen.has(codice_ipa)) continue

        // Trova la PEC: prima le coppie mail/tipo con tipo='pec', poi domicilio_digitale.
        let pec = ''
        for (const mc of mailCols) {
            const tipo = mc.tipo >= 0 ? (c[mc.tipo] || '').trim().toLowerCase() : ''
            const mail = (c[mc.mail] || '').trim().toLowerCase()
            if (mail && (tipo === 'pec' || (!mc.tipo && /pec|legalmail|postecert/.test(mail)))) { pec = mail; break }
        }
        if (!pec && iDomicilio >= 0) {
            const dm = (c[iDomicilio] || '').trim().toLowerCase()
            if (/\S+@\S+\.\S+/.test(dm)) pec = dm
        }
        if (!pec || !/\S+@\S+\.\S+/.test(pec)) continue

        seen.add(codice_ipa)
        out.push({
            codice_ipa,
            denominazione,
            comune: (iComune >= 0 ? c[iComune] : '')?.trim() || null,
            provincia: (iProv >= 0 ? c[iProv] : '')?.trim() || null,
            regione: (iReg >= 0 ? c[iReg] : '')?.trim() || null,
            pec,
            tipo_ente: classifyTipo(denominazione),
            fonte: 'ipa',
            verificata_il: now,
        })
    }
    return out
}

export async function runSync(): Promise<{ total: number; upserted: number; batches: number }> {
    const rows = await fetchAndParse()
    let upserted = 0
    let batches = 0
    const BATCH = 500
    for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH)
        const { error } = await supabase
            .from('enti_notificatori')
            .upsert(chunk, { onConflict: 'codice_ipa', ignoreDuplicates: false })
        if (error) {
            console.error(`[sync-ipa] batch ${batches} errore:`, error.message)
        } else {
            upserted += chunk.length
        }
        batches++
    }
    console.log(`[sync-ipa] fatto: ${rows.length} enti con PEC, ${upserted} upserted in ${batches} batch`)
    return { total: rows.length, upserted, batches }
}

// POST manuale (bottone "Aggiorna rubrica da IPA") — risposta con il conteggio.
export const handler = async (event: { httpMethod?: string }) => {
    if (event?.httpMethod && event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
    }
    try {
        const result = await runSync()
        return { statusCode: 200, body: JSON.stringify({ ok: true, ...result }) }
    } catch (e) {
        console.error('[sync-ipa] errore:', e)
        return { statusCode: 500, body: JSON.stringify({ ok: false, error: (e as Error).message }) }
    }
}
