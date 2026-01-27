import { Handler } from '@netlify/functions';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY!,
});

interface ExtractedPersonData {
    // Personal Info
    nome?: string;
    cognome?: string;
    sesso?: 'M' | 'F';
    data_nascita?: string; // YYYY-MM-DD
    luogo_nascita?: string;
    provincia_nascita?: string;
    codice_fiscale?: string;

    // Address
    indirizzo?: string;
    numero_civico?: string;
    codice_postale?: string;
    citta_residenza?: string;
    provincia_residenza?: string;

    // Document Info (ID Card)
    documento_tipo?: string;
    documento_numero?: string;
    documento_rilascio?: string; // YYYY-MM-DD
    documento_scadenza?: string; // YYYY-MM-DD
    documento_ente?: string;

    // Driver's License
    patente_numero?: string;
    patente_tipo?: string; // B, A, C, etc.
    patente_rilascio?: string; // YYYY-MM-DD
    patente_scadenza?: string; // YYYY-MM-DD
    patente_ente?: string;

    // Extraction metadata
    document_type?: 'carta_identita' | 'patente' | 'passaporto' | 'tessera_sanitaria' | 'unknown';
    confidence?: 'high' | 'medium' | 'low';
    raw_text?: string;
    notes?: string;
}

const EXTRACTION_PROMPT = `Sei un esperto di estrazione dati da documenti italiani. Analizza questa immagine di un documento e estrai TUTTI i dati visibili in modo strutturato.

TIPI DI DOCUMENTO SUPPORTATI:
- Carta d'Identità Italiana (CIE o cartacea)
- Patente di Guida Italiana
- Passaporto
- Tessera Sanitaria

ESTRAI QUESTI DATI (se presenti):

DATI PERSONALI:
- nome (nome di battesimo)
- cognome (cognome/i)
- sesso (M o F)
- data_nascita (formato YYYY-MM-DD)
- luogo_nascita (comune)
- provincia_nascita (sigla provincia, es: CA, MI, RM)
- codice_fiscale (16 caratteri alfanumerici)

INDIRIZZO DI RESIDENZA:
- indirizzo (via/piazza + nome)
- numero_civico
- codice_postale (CAP, 5 cifre)
- citta_residenza (comune)
- provincia_residenza (sigla)

DATI DOCUMENTO (per Carta d'Identità):
- documento_tipo ("Carta d'Identità")
- documento_numero
- documento_rilascio (data rilascio, YYYY-MM-DD)
- documento_scadenza (data scadenza, YYYY-MM-DD)
- documento_ente (comune che ha rilasciato)

DATI PATENTE (se è una patente):
- patente_numero
- patente_tipo (es: B, AM, A1, A2, A, C, D, BE, etc.)
- patente_rilascio (YYYY-MM-DD)
- patente_scadenza (YYYY-MM-DD)
- patente_ente (Motorizzazione o Prefettura)

METADATI:
- document_type: uno tra "carta_identita", "patente", "passaporto", "tessera_sanitaria", "unknown"
- confidence: "high" se tutti i dati sono chiari, "medium" se alcuni sono incerti, "low" se il documento è poco leggibile
- notes: eventuali problemi riscontrati (es: "documento scaduto", "foto poco leggibile", "dati parzialmente oscurati")

REGOLE IMPORTANTI:
1. Converti TUTTE le date nel formato YYYY-MM-DD (es: 15/03/1990 → 1990-03-15)
2. I nomi propri vanno con la prima lettera maiuscola (es: MARIO ROSSI → Mario Rossi)
3. Il codice fiscale deve essere tutto MAIUSCOLO
4. Se un campo non è visibile o leggibile, omettilo dal risultato
5. Per la patente, estrai TUTTI i tipi di patente visibili (es: "AM, B")
6. La provincia è sempre la sigla di 2 lettere (CA, MI, RM, TO, etc.)

Rispondi SOLO con un oggetto JSON valido, senza markdown o altro testo.`;

export const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    try {
        const { imageBase64, imageUrl, documentId } = JSON.parse(event.body || '{}');

        if (!imageBase64 && !imageUrl) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Either imageBase64 or imageUrl is required' })
            };
        }

        console.log('[extract-document-data] Processing document...');

        // Prepare image for Claude
        let imageContent: any;

        if (imageBase64) {
            // Direct base64 image
            const mediaType = imageBase64.startsWith('/9j/') ? 'image/jpeg' :
                             imageBase64.startsWith('iVBORw') ? 'image/png' :
                             'image/jpeg';
            imageContent = {
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: mediaType,
                    data: imageBase64
                }
            };
        } else if (imageUrl) {
            // URL-based image
            imageContent = {
                type: 'image',
                source: {
                    type: 'url',
                    url: imageUrl
                }
            };
        }

        // Call Claude Vision API
        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2000,
            messages: [
                {
                    role: 'user',
                    content: [
                        imageContent,
                        {
                            type: 'text',
                            text: EXTRACTION_PROMPT
                        }
                    ]
                }
            ]
        });

        // Parse the response
        const responseText = response.content[0].type === 'text' ? response.content[0].text : '';
        console.log('[extract-document-data] Claude response:', responseText);

        let extractedData: ExtractedPersonData;
        try {
            // Clean up the response (remove markdown code blocks if present)
            let cleanJson = responseText.trim();
            if (cleanJson.startsWith('```json')) {
                cleanJson = cleanJson.slice(7);
            }
            if (cleanJson.startsWith('```')) {
                cleanJson = cleanJson.slice(3);
            }
            if (cleanJson.endsWith('```')) {
                cleanJson = cleanJson.slice(0, -3);
            }
            extractedData = JSON.parse(cleanJson.trim());
        } catch (parseError) {
            console.error('[extract-document-data] Failed to parse Claude response:', parseError);
            return {
                statusCode: 422,
                headers,
                body: JSON.stringify({
                    error: 'Failed to parse extracted data',
                    raw_response: responseText
                })
            };
        }

        // If documentId provided, update the database record
        if (documentId) {
            const { error: updateError } = await supabase
                .from('document_uploads')
                .update({
                    extracted_data: extractedData,
                    status: 'extracted',
                    updated_at: new Date().toISOString()
                })
                .eq('id', documentId);

            if (updateError) {
                console.error('[extract-document-data] DB update error:', updateError);
            }
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                data: extractedData
            })
        };

    } catch (error: any) {
        console.error('[extract-document-data] Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message || 'Internal server error' })
        };
    }
};
