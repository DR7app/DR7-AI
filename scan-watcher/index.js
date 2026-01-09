require('dotenv').config();
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { createClient } = require('@supabase/supabase-js');
const { PDFDocument } = require('pdf-lib');
// Note: specialized imports might be needed for canvas/jsqr integration with PDF
// For this MVP, we will try to detect the QR code from the first page if possible,
// or just upload it and let the backend/frontend handle it if node-canvas is too heavy.

// Configuration
const WATCH_DIR = process.env.WATCH_DIR || './scans_incoming';
const PROCESSED_DIR = process.env.PROCESSED_DIR || './scans_processed';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // Needs service role to bypass some RLS if needed, or just regular authenticated user

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing Supabase credentials in .env');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Ensure directories exist
if (!fs.existsSync(WATCH_DIR)) fs.mkdirSync(WATCH_DIR, { recursive: true });
if (!fs.existsSync(PROCESSED_DIR)) fs.mkdirSync(PROCESSED_DIR, { recursive: true });

console.log(`Starting DR7 Scan Watcher...`);
console.log(`Watching: ${WATCH_DIR}`);

const watcher = chokidar.watch(WATCH_DIR, {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    awaitWriteFinish: {
        stabilityThreshold: 2000, // Wait for 2 seconds of no file size change
        pollInterval: 100
    }
});

watcher
    .on('add', async (filePath) => {
        console.log(`File detected: ${filePath}`);
        if (!filePath.toLowerCase().endsWith('.pdf')) {
            console.log('Not a PDF, skipping.');
            return;
        }

        try {
            await processFile(filePath);
        } catch (err) {
            console.error(`Error processing file ${filePath}:`, err);
        }
    });

async function processFile(filePath) {
    const fileName = path.basename(filePath);

    // 1. Lock/Rename to .processing (optional, but good practice if multiple watchers, 
    // though here we might just read it directly to avoid race conditions with lock files)
    // For simplicity, we process it as is.

    console.log(`Processing ${fileName}...`);
    const fileBuffer = fs.readFileSync(filePath);

    // TODO: Extract QR Code from First Page here
    // For now, we assume no Job ID found locally and let the UI handle assignment 
    // OR we implement the QR reading if libraries allow.
    let detectedJobId = null;

    // 2. Upload to Supabase Storage
    const storagePath = `${Date.now()}_${fileName}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
        .from('scans')
        .upload(storagePath, fileBuffer, {
            contentType: 'application/pdf'
        });

    if (uploadError) {
        throw new Error(`Storage upload failed: ${uploadError.message}`);
    }

    // 3. Create DB Record
    const { data: dbData, error: dbError } = await supabase
        .from('document_uploads')
        .insert([
            {
                file_path: storagePath, // Or full URL if needed
                original_filename: fileName,
                mime_type: 'application/pdf',
                size_bytes: fileBuffer.length,
                scan_job_id: detectedJobId,
                status: detectedJobId ? 'processing' : 'ready', // ready for manual assignment if no ID
                metadata: {
                    source: 'scan-watcher',
                    processed_at: new Date().toISOString()
                }
            }
        ])
        .select();

    if (dbError) {
        // If DB insert fails, we might want to cleanup storage, but for now just error out
        throw new Error(`DB insert failed: ${dbError.message}`);
    }

    console.log(`Successfully processed: ${fileName} -> DB ID: ${dbData[0].id}`);

    // 4. Automatically trigger OCR processing
    try {
        console.log(`Triggering auto-OCR for document ${dbData[0].id}...`);
        const ocrResponse = await fetch(`${process.env.NETLIFY_SITE_URL || 'https://www.dr7empire.com'}/.netlify/functions/process-document-ocr`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ documentId: dbData[0].id })
        });

        if (ocrResponse.ok) {
            console.log(`✅ Auto-OCR completed successfully for ${fileName}`);
        } else {
            console.warn(`⚠️ Auto-OCR failed for ${fileName}: ${ocrResponse.statusText}`);
        }
    } catch (ocrError) {
        console.error(`❌ Auto-OCR error for ${fileName}:`, ocrError.message);
        // Don't throw - we still want to move the file even if OCR fails
    }

    // 5. Move to Processed folder
    const destPath = path.join(PROCESSED_DIR, fileName);
    fs.renameSync(filePath, destPath);
    console.log(`Moved local file to: ${destPath}`);
}
