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

const EXTRACTION_PROMPT = `Estrai i dati da questo documento italiano.

!!! REGOLA CRITICA PER PATENTE !!!
Il NUMERO PATENTE si trova SOLO sul FRONTE della patente, al campo numero 5.
Sul RETRO della patente NON c'è il numero patente - c'è solo la tabella delle categorie.
Se stai guardando il FRONTE della patente, cerca il campo "5." che contiene il numero (es: U1234567A).
Se stai guardando il RETRO, NON estrarre patente_numero perché non è presente sul retro.

REGOLA FONDAMENTALE: Trascrivi ESATTAMENTE quello che leggi. NON inventare, NON aggiungere caratteri, NON indovinare.

=== FORMATI ESATTI ===

NUMERO DOCUMENTO CIE (Carta Identità Elettronica):
- Formato: 2 lettere + 5 numeri + 2 lettere
- Esempio: CA12345AB, CA44528GJ
- ESATTAMENTE 9 caratteri, non di più, non di meno

!!! ATTENZIONE - NON INCLUDERE "ITA" !!!
Sul fronte della CIE, in alto a destra, c'è scritto "ITA" (codice paese Italia).
"ITA" NON FA PARTE del numero documento!
Il numero documento è SOTTO "ITA", nel formato CA12345AB.
Se leggi "ITA CA44528GJ", il numero documento è SOLO "CA44528GJ" (9 caratteri).
NON scrivere mai "ITA" nel campo documento_numero!

DATA DI NASCITA:
- Sul documento: GG.MM.AAAA oppure GG/MM/AAAA
- Estrai come: YYYY-MM-DD
- Esempio: 15.03.1990 → 1990-03-15

NOME e COGNOME:
- Trascrivi LETTERA PER LETTERA quello che vedi
- Sul documento sono in MAIUSCOLO, tu convertili in: Prima Lettera Maiuscola
- Esempio: MARIO → Mario, ROSSI → Rossi

CODICE FISCALE:
- ESATTAMENTE 16 caratteri
- Formato: LLLLLLNNLNNLNNNL (L=lettera, N=numero)
- NON aggiungere caratteri extra

=== CAMPI DA ESTRARRE ===

{
  "nome": "Nome di battesimo",
  "cognome": "Cognome",
  "sesso": "M o F",
  "data_nascita": "YYYY-MM-DD",
  "luogo_nascita": "Comune di nascita",
  "provincia_nascita": "XX (2 lettere)",
  "codice_fiscale": "16 caratteri esatti",
  "indirizzo": "Via/Piazza nome",
  "numero_civico": "numero",
  "codice_postale": "5 cifre",
  "citta_residenza": "Comune",
  "provincia_residenza": "XX (2 lettere)",
  "documento_tipo": "Carta d'Identità Elettronica",
  "documento_numero": "9 caratteri per CIE",
  "documento_rilascio": "YYYY-MM-DD",
  "documento_scadenza": "YYYY-MM-DD",
  "documento_ente": "Comune di rilascio",
  "document_type": "carta_identita",
  "confidence": "high/medium/low",
  "notes": "eventuali problemi"
}

=== PATENTE DI GUIDA ITALIANA ===

FRONTE della patente - campi numerati (TUTTI i dati principali sono sul FRONTE!):
- Campo 1: Cognome
- Campo 2: Nome
- Campo 3: Data e luogo di nascita
- Campo 4a: Data rilascio patente
- Campo 4b: DATA SCADENZA PATENTE
- Campo 4c: Ente rilascio (es: MCTC, UCO)
- Campo 5: NUMERO PATENTE (es: U1234567A o MI1234567A) ← IL NUMERO È QUI SUL FRONTE!
- Campo 9: Categorie

ATTENZIONE IMPORTANTE:
- Il NUMERO PATENTE (patente_numero) è al campo 5 sul FRONTE - NON prenderlo dal retro!
- La SCADENZA PATENTE (patente_scadenza) è al campo 4b sul FRONTE
- Sul RETRO c'è solo la tabella delle categorie per il tipo patente

RETRO della patente - TABELLA CATEGORIE:
La tabella mostra TUTTE le categorie possibili: AM, A1, A2, A, B1, B, C1, C, D1, D, BE, C1E, CE, D1E, DE

IMPORTANTE PER TIPO PATENTE:
- Colonna 10 = data rilascio categoria
- Colonna 11 = data scadenza categoria
- Colonna 12 = restrizioni

Il titolare possiede SOLO le categorie che hanno DATE scritte nelle colonne 10 e 11.
Le righe SENZA date = categorie NON possedute, NON includerle!

Esempio: Se solo la riga "B" ha date (10: 15.03.2015, 11: 15.03.2025), allora patente_tipo = "B"
Se le righe "AM" e "B" hanno date, allora patente_tipo = "AM, B"

Per PATENTE:
{
  "nome": "dal campo 2 FRONTE",
  "cognome": "dal campo 1 FRONTE",
  "data_nascita": "dal campo 3 FRONTE, formato YYYY-MM-DD",
  "luogo_nascita": "dal campo 3 FRONTE",
  "patente_numero": "dal campo 5 FRONTE (NON dal retro!) - es: U1234567A",
  "patente_tipo": "SOLO categorie con date sul RETRO (es: B oppure AM, B)",
  "patente_rilascio": "dal campo 4a FRONTE, YYYY-MM-DD",
  "patente_scadenza": "dal campo 4b FRONTE, YYYY-MM-DD",
  "patente_ente": "dal campo 4c FRONTE",
  "document_type": "patente"
}

=== REGOLE RIGIDE ===

1. Se non riesci a leggere un campo chiaramente, OMETTILO dal JSON
2. NON aggiungere numeri o lettere extra a nessun campo
3. Il numero documento CIE è SEMPRE 9 caratteri (es: CA12345AB)
4. La data è SEMPRE nel formato YYYY-MM-DD
5. Il codice fiscale è SEMPRE 16 caratteri

Rispondi SOLO con JSON valido.`;

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

        // Call Claude Vision API - using Opus for best OCR accuracy
        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 4000,
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
