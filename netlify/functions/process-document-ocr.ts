import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import Tesseract from "tesseract.js";

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const handler: Handler = async (event) => {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    try {
        const { documentId } = JSON.parse(event.body || "{}");

        if (!documentId) {
            return { statusCode: 400, body: JSON.stringify({ error: "Missing documentId" }) };
        }

        // 1. Get document from DB
        const { data: doc, error: docError } = await supabase
            .from("document_uploads")
            .select("*")
            .eq("id", documentId)
            .single();

        if (docError || !doc) {
            return { statusCode: 404, body: JSON.stringify({ error: "Document not found" }) };
        }

        // 2. Download PDF from storage
        const { data: fileData, error: downloadError } = await supabase.storage
            .from("scans")
            .download(doc.file_path);

        if (downloadError || !fileData) {
            return { statusCode: 500, body: JSON.stringify({ error: "Failed to download file" }) };
        }

        // 3. Convert to image buffer (for Tesseract)
        // Note: For production, you'd convert PDF to image properly
        // For now, we'll process the file directly if it's an image, or first page if PDF
        const arrayBuffer = await fileData.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // 4. Run OCR
        console.log("Running OCR on document...");
        const { data: { text } } = await Tesseract.recognize(buffer, "ita", {
            logger: (m) => console.log(m),
        });

        console.log("OCR Text:", text);

        // 5. Parse Italian ID data
        const extractedData = parseItalianID(text);

        // 6. Update document with extracted data
        const { error: updateError } = await supabase
            .from("document_uploads")
            .update({
                extracted_data: extractedData,
                status: "ready",
                updated_at: new Date().toISOString(),
            })
            .eq("id", documentId);

        if (updateError) {
            console.error("Failed to update document:", updateError);
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                extractedData,
            }),
        };
    } catch (error: any) {
        console.error("OCR processing error:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};

// Parse Italian ID card text
function parseItalianID(text: string): any {
    const data: any = {
        doc_type: "identity_card",
        confidence: 0.7,
    };

    // Clean text
    const cleanText = text.replace(/\n/g, " ").toUpperCase();

    // Extract Nome (First Name)
    const nomeMatch = cleanText.match(/NOME[:\s]+([A-Z\s]+?)(?:COGNOME|DATA|LUOGO|\d)/);
    if (nomeMatch) {
        data.nome = nomeMatch[1].trim();
    }

    // Extract Cognome (Last Name)
    const cognomeMatch = cleanText.match(/COGNOME[:\s]+([A-Z\s]+?)(?:NOME|DATA|LUOGO|NATO|\d)/);
    if (cognomeMatch) {
        data.cognome = cognomeMatch[1].trim();
    }

    // Extract Data di Nascita (Birth Date)
    const birthDateMatch = cleanText.match(/NAT[OA][:\s]+.*?(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/);
    if (birthDateMatch) {
        data.data_nascita = birthDateMatch[1];
    }

    // Extract Luogo di Nascita (Birth Place)
    const birthPlaceMatch = cleanText.match(/NAT[OA][:\s]+[A-Z\s]+?IL\s+\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4}\s+A\s+([A-Z\s]+?)(?:RESIDENZA|\d|$)/);
    if (birthPlaceMatch) {
        data.luogo_nascita = birthPlaceMatch[1].trim();
    }

    // Extract Codice Fiscale
    const cfMatch = cleanText.match(/([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])/);
    if (cfMatch) {
        data.codice_fiscale = cfMatch[1];
    }

    // Extract Document Number
    const docNumMatch = cleanText.match(/N[°\.\s]+([A-Z0-9]{7,10})/);
    if (docNumMatch) {
        data.numero_documento = docNumMatch[1];
    }

    // Extract Expiry Date
    const expiryMatch = cleanText.match(/SCADEN[ZA]+[:\s]+(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/);
    if (expiryMatch) {
        data.data_scadenza = expiryMatch[1];
    }

    // Extract Address (if present)
    const addressMatch = cleanText.match(/RESIDENZA[:\s]+([A-Z0-9\s,\.]+?)(?:COMUNE|STATO|\d{5}|$)/);
    if (addressMatch) {
        data.indirizzo = addressMatch[1].trim();
    }

    return data;
}
