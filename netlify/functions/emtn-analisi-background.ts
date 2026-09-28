/**
 * EMTN — analisi AI della pratica (background function, fino a 15 minuti).
 *
 * POST { analisiId } con l'autenticazione dell'operatore. Risponde 202
 * subito; lo schermo segue lo stato su emtn-pratica (azione "stato").
 *
 * Passi (workflow EMTN, fasi 2-7): legge tutti i documenti della pratica,
 * Claude li analizza e li confronta, il risultato viene normalizzato
 * (categorie, stati, residui, ritardi, termini vietati), confrontato con il
 * gestionale DR7 e completato con i motivi di revisione manuale obbligatoria.
 * Il risultato grezzo dell'AI resta salvato accanto a quello normalizzato.
 */
import { Handler } from '@netlify/functions'
import { requireAuth } from './require-auth'
import { getServiceSupabase } from './utils/emtn'
import { analizzaDocumentiEMTN, type DocumentoAnalisi } from './utils/emtnAnalisiAI'
import { controlloGestionale } from './utils/emtnGestionale'
import { normalizzaRisultato, motiviRevisioneManuale } from '../../src/utils/emtnMobilityRisk'

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: '' }
    const { user, error: authErr } = await requireAuth(event)
    if (authErr) return authErr
    const sb = getServiceSupabase()
    const body = (() => { try { return JSON.parse(event.body || '{}') } catch { return {} } })() as { analisiId?: string }
    const analisiId = String(body.analisiId || '').trim()
    if (!analisiId) return { statusCode: 400, body: '' }

    const { data: analisi } = await sb.from('emtn_analisi').select('id, client_id, posizione_id, documenti, created_by, stato').eq('id', analisiId).maybeSingle()
    if (!analisi || analisi.created_by !== user!.id) return { statusCode: 404, body: '' }
    if (analisi.stato === 'inviata') return { statusCode: 409, body: '' }
    const documentiPratica = (Array.isArray(analisi.documenti) ? analisi.documenti : []) as { path: string; nome: string; estensione: string }[]
    if (documentiPratica.length === 0) {
        await sb.from('emtn_analisi').update({ stato: 'errore', errore: 'Nessun documento caricato' }).eq('id', analisiId)
        return { statusCode: 400, body: '' }
    }
    await sb.from('emtn_analisi').update({ stato: 'in_corso', errore: null }).eq('id', analisiId)

    try {
        const documenti: DocumentoAnalisi[] = []
        for (const d of documentiPratica) {
            const { data: blob, error } = await sb.storage.from('emtn-documents').download(d.path)
            if (error || !blob) throw new Error(`Documento ${d.nome} non leggibile dallo storage`)
            documenti.push({ nome: d.nome, estensione: d.estensione, dati: Buffer.from(await blob.arrayBuffer()) })
        }

        let posizioneAttuale: unknown = null
        if (analisi.posizione_id) {
            const { data: pos } = await sb.from('emtn_posizioni').select('stato, titolo, report, eventi, pratica').eq('id', analisi.posizione_id).maybeSingle()
            posizioneAttuale = pos || null
        }

        const { input, modello } = await analizzaDocumentiEMTN(documenti, posizioneAttuale)
        const { risultato, avvisi } = normalizzaRisultato(input)

        const { data: cliente } = await sb.from('emtn_clients').select('codice_fiscale').eq('id', analisi.client_id).maybeSingle()
        const { controlli, bookingId } = await controlloGestionale(sb, cliente?.codice_fiscale || null, risultato)
        const motivi = motiviRevisioneManuale(risultato, controlli)
        if (motivi.length) risultato.esito_verifica = 'REVISIONE_MANUALE_OBBLIGATORIA'

        await sb.from('emtn_analisi').update({
            stato: 'pronta',
            risultato_ai: input,
            risultato: { ...risultato, motivi_revisione: motivi },
            avvisi,
            controlli_gestionale: controlli,
            booking_id: bookingId,
            modello,
            completed_at: new Date().toISOString(),
        }).eq('id', analisiId)
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Analisi non riuscita'
        console.error('[emtn-analisi-background]', analisiId, msg)
        await sb.from('emtn_analisi').update({ stato: 'errore', errore: msg.slice(0, 500), completed_at: new Date().toISOString() }).eq('id', analisiId)
    }
    return { statusCode: 202, body: '' }
}
