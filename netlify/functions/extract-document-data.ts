import { Handler } from '@netlify/functions';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

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

const EXTRACTION_PROMPT = `Sei un esperto OCR specializzato in documenti d'identità italiani. Analizza ATTENTAMENTE questa immagine, carattere per carattere.

PRIMA DI TUTTO: Osserva l'immagine con molta attenzione. Leggi ogni carattere singolarmente, specialmente per codici e numeri.

=== CARTA D'IDENTITÀ ELETTRONICA (CIE) - LAYOUT ===
FRONTE della CIE:
- In alto: "REPUBBLICA ITALIANA" e "CARTA D'IDENTITÀ"
- COGNOME: dopo "Cognome/Surname"
- NOME: dopo "Nome/Name"
- DATA NASCITA: dopo "Nascita/Birth" (formato GG.MM.AAAA o GG/MM/AAAA)
- SESSO: M o F
- LUOGO NASCITA: città di nascita
- SCADENZA: dopo "Scadenza/Expiry"
- NUMERO DOCUMENTO: codice alfanumerico (es: CA00000AA) in alto a destra

RETRO della CIE:
- CODICE FISCALE: 16 caratteri, di solito in alto (es: RSSMRA85M01H501X)
- INDIRIZZO: Via/Piazza + numero
- COMUNE RESIDENZA: città
- PROVINCIA: sigla 2 lettere
- CAP: 5 cifre
- ENTE RILASCIO: il comune che ha rilasciato

=== CARTA D'IDENTITÀ CARTACEA (vecchio formato) ===
- Numero documento in alto
- Dati personali su righe separate
- Codice fiscale spesso sul retro o in basso

=== DATI DA ESTRARRE ===

DATI PERSONALI:
- nome: solo il nome di battesimo
- cognome: il cognome
- sesso: M o F
- data_nascita: convertire in YYYY-MM-DD
- luogo_nascita: solo il comune
- provincia_nascita: sigla 2 lettere (es: MI, RM, NA)
- codice_fiscale: ESATTAMENTE 16 caratteri

INDIRIZZO:
- indirizzo: via/piazza + nome strada
- numero_civico: il numero
- codice_postale: CAP 5 cifre
- citta_residenza: comune
- provincia_residenza: sigla 2 lettere

DOCUMENTO:
- documento_tipo: "Carta d'Identità Elettronica" o "Carta d'Identità"
- documento_numero: il codice del documento
- documento_rilascio: data rilascio in YYYY-MM-DD
- documento_scadenza: data scadenza in YYYY-MM-DD
- documento_ente: comune di rilascio

PATENTE (se è una patente):
- patente_numero: numero patente (es: AB1234567X)
- patente_tipo: SOLO categorie con date (es: "B" o "AM, B")
- patente_rilascio: YYYY-MM-DD
- patente_scadenza: YYYY-MM-DD
- patente_ente: ente rilascio

METADATI:
- document_type: "carta_identita", "patente", "passaporto", "tessera_sanitaria", o "unknown"
- confidence: "high", "medium", o "low"
- notes: problemi riscontrati

=== REGOLE CRITICHE PER CODICE FISCALE ===
Il codice fiscale italiano è SEMPRE 16 caratteri con questa struttura FISSA:
- Posizioni 1-6: LETTERE (cognome+nome)
- Posizioni 7-8: NUMERI (anno)
- Posizione 9: LETTERA (mese: A,B,C,D,E,H,L,M,P,R,S,T)
- Posizioni 10-11: NUMERI (giorno: 01-31 o 41-71)
- Posizione 12: LETTERA (codice comune)
- Posizioni 13-15: NUMERI (codice comune)
- Posizione 16: LETTERA (controllo)

ATTENZIONE MASSIMA a questi errori comuni:
- 0 (zero) ↔ O (lettera): usa la regola posizionale!
- 1 (uno) ↔ I (lettera): usa la regola posizionale!
- 5 ↔ S: usa la regola posizionale!
- 8 ↔ B: usa la regola posizionale!

Esempio: se leggi "RSSMRA85M01H5O1X" ma posizione 15 deve essere un NUMERO, correggi in "RSSMRA85M01H501X"

=== REGOLE GENERALI ===
1. Date: converti SEMPRE in YYYY-MM-DD (15/03/1990 → 1990-03-15)
2. Nomi: Prima lettera maiuscola (MARIO ROSSI → Mario Rossi)
3. Province: sempre 2 lettere maiuscole (Milano = MI)
4. Se non riesci a leggere un campo, OMETTILO

Rispondi SOLO con JSON valido, senza markdown o commenti.`;

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

    // Initialize clients inside handler to ensure env vars are loaded
    const supabase = createClient(
        process.env.VITE_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY!,
    });

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
