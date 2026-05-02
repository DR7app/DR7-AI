import type { Handler } from '@netlify/functions'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { getCorsOrigin } from './cors-headers'

/**
 * Estrae dati strutturati da una bolla / DDT / fattura tramite Claude Vision.
 *
 * Input:  { documentId: string }  — id riga in fornitore_documents
 * Output: { numero_documento, data_documento, importo_imponibile, importo_iva, importo_totale, fornitore_nome_rilevato }
 *
 * Aggiorna la riga in fornitore_documents con i campi estratti.
 * I campi attualmente presenti vengono SOVRASCRITTI solo se Claude ne fornisce
 * una versione non-null e non-vuota — così non perdiamo dati già editati a mano.
 */

const supabase = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const EXTRACTION_SYSTEM = `Sei un assistente che estrae dati strutturati da bolle, DDT, fatture e note di credito italiane di fornitori.

Restituisci sempre il JSON conforme allo schema. Per ogni campo:
- numero_documento: il numero stampato sul documento (es. "2026/045", "FT-123", "1234"). Lascia null se illeggibile.
- data_documento: data del documento in formato YYYY-MM-DD. Lascia null se non chiaramente leggibile.
- importo_imponibile: importo imponibile in EUR (numero, NO simbolo). Null se non presente.
- importo_iva: importo IVA in EUR. Null se non presente.
- importo_totale: importo totale del documento in EUR (lordo, IVA inclusa). Null se non leggibile.
- fornitore_nome_rilevato: nome del fornitore stampato in alto. Null se non leggibile.

Importi: usa il punto come separatore decimale (es. 190.00 non 190,00). Non includere simboli.
Se il documento ha più totali (subtotale, totale lordo, totale documento), prendi quello finale (lordo).
NON inventare dati che non vedi sul documento.`

const SCHEMA = {
    type: 'object',
    properties: {
        numero_documento: { type: ['string', 'null'] },
        data_documento: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
        importo_imponibile: { type: ['number', 'null'] },
        importo_iva: { type: ['number', 'null'] },
        importo_totale: { type: ['number', 'null'] },
        fornitore_nome_rilevato: { type: ['string', 'null'] },
    },
    required: ['numero_documento', 'data_documento', 'importo_imponibile', 'importo_iva', 'importo_totale', 'fornitore_nome_rilevato'],
    additionalProperties: false,
}

interface ExtractedData {
    numero_documento: string | null
    data_documento: string | null
    importo_imponibile: number | null
    importo_iva: number | null
    importo_totale: number | null
    fornitore_nome_rilevato: string | null
}

const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json',
    }

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' }

    try {
        const { documentId } = JSON.parse(event.body || '{}')
        if (!documentId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'documentId required' }) }

        // 1. Carica il record
        const { data: doc, error: docErr } = await supabase
            .from('fornitore_documents')
            .select('id, fornitore_id, file_url, file_name, importo_imponibile, importo_iva, importo_totale, numero_documento, data_documento')
            .eq('id', documentId)
            .single()
        if (docErr || !doc) {
            return { statusCode: 404, headers, body: JSON.stringify({ error: 'Documento non trovato' }) }
        }
        if (!doc.file_url) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Documento senza file allegato' }) }
        }

        // 2. Scarica il file dallo storage
        const { data: fileData, error: dlErr } = await supabase.storage
            .from('fornitori-documents')
            .download(doc.file_url)
        if (dlErr || !fileData) {
            return { statusCode: 500, headers, body: JSON.stringify({ error: `Download fallito: ${dlErr?.message || 'no data'}` }) }
        }
        const fileBuf = Buffer.from(await fileData.arrayBuffer())
        const fileBase64 = fileBuf.toString('base64')

        // 3. Determina tipo MIME
        const fname = (doc.file_name || doc.file_url).toLowerCase()
        const isPdf = fname.endsWith('.pdf')
        const isJpg = fname.endsWith('.jpg') || fname.endsWith('.jpeg')
        const isPng = fname.endsWith('.png')
        const isWebp = fname.endsWith('.webp')

        if (!isPdf && !isJpg && !isPng && !isWebp) {
            return { statusCode: 415, headers, body: JSON.stringify({ error: 'Formato non supportato (solo PDF, JPG, PNG, WEBP)' }) }
        }

        // 4. Costruisci il content block per Claude
        const docBlock = isPdf
            ? {
                type: 'document' as const,
                source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: fileBase64 },
            }
            : {
                type: 'image' as const,
                source: {
                    type: 'base64' as const,
                    media_type: (isJpg ? 'image/jpeg' : isPng ? 'image/png' : 'image/webp') as 'image/jpeg' | 'image/png' | 'image/webp',
                    data: fileBase64,
                },
            }

        // 5. Chiamata Claude con structured output
        const response = await anthropic.messages.create({
            model: 'claude-opus-4-7',
            max_tokens: 16000,
            system: [
                {
                    type: 'text',
                    text: EXTRACTION_SYSTEM,
                    cache_control: { type: 'ephemeral' },
                },
            ],
            output_config: {
                format: { type: 'json_schema', schema: SCHEMA },
            },
            messages: [
                {
                    role: 'user',
                    content: [
                        docBlock,
                        { type: 'text', text: 'Estrai i dati strutturati di questo documento.' },
                    ],
                },
            ],
        })

        // 6. Estrai il JSON dalla risposta
        let extracted: ExtractedData | null = null
        for (const block of response.content) {
            if (block.type === 'text') {
                try {
                    extracted = JSON.parse(block.text)
                    break
                } catch { /* continue */ }
            }
        }
        if (!extracted) {
            return { statusCode: 502, headers, body: JSON.stringify({ error: 'Claude non ha restituito JSON valido' }) }
        }

        // 7. Costruisci l'update — sovrascrivi solo se Claude ha trovato un valore
        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
        if (extracted.numero_documento && extracted.numero_documento.trim()) {
            updates.numero_documento = extracted.numero_documento.trim()
        }
        if (extracted.data_documento && /^\d{4}-\d{2}-\d{2}$/.test(extracted.data_documento)) {
            updates.data_documento = extracted.data_documento
        }
        if (typeof extracted.importo_imponibile === 'number' && extracted.importo_imponibile >= 0) {
            updates.importo_imponibile = extracted.importo_imponibile
        }
        if (typeof extracted.importo_iva === 'number' && extracted.importo_iva >= 0) {
            updates.importo_iva = extracted.importo_iva
        }
        if (typeof extracted.importo_totale === 'number' && extracted.importo_totale > 0) {
            updates.importo_totale = extracted.importo_totale
        }

        // Salva una nota con il nome rilevato per controllo manuale
        const noteData: Record<string, unknown> = {
            ai_extracted_at: new Date().toISOString(),
            ai_fornitore_nome_rilevato: extracted.fornitore_nome_rilevato || null,
            ai_input_tokens: response.usage.input_tokens,
            ai_output_tokens: response.usage.output_tokens,
        }
        // Memorizza la traccia AI in metadata se la colonna esiste; fallback in note
        // (il campo metadata non e' presente in fornitore_documents in questo schema —
        // skip silenzioso per ora, manteniamo solo i campi di estrazione)
        void noteData

        if (Object.keys(updates).length > 1) {
            const { error: upErr } = await supabase
                .from('fornitore_documents')
                .update(updates)
                .eq('id', documentId)
            if (upErr) {
                return { statusCode: 500, headers, body: JSON.stringify({ error: `DB update fallito: ${upErr.message}` }) }
            }
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                extracted,
                updated_fields: Object.keys(updates).filter(k => k !== 'updated_at'),
                tokens: { input: response.usage.input_tokens, output: response.usage.output_tokens },
            }),
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[extract-bolla-data] error', err)
        return { statusCode: 500, headers, body: JSON.stringify({ error: msg }) }
    }
}

export { handler }
