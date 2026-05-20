/**
 * Debug endpoint: lista i nomi dei campi AcroForm del PDF master_contract.
 *
 * Apri https://admin.dr7empire.com/.netlify/functions/list-contract-fields
 * in un browser per vedere tutti i field name esatti del template PDF.
 * Serve per scoprire come nominare i field nel data map di generate-contract.
 *
 * No auth — read-only, espone solo nomi (no dati PII).
 */
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { PDFDocument } from 'pdf-lib'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const handler: Handler = async () => {
    try {
        const { data: tplData, error: tplErr } = await supabase
            .storage
            .from('contracts')
            .download('templates/master_contract.pdf')

        if (tplErr || !tplData) {
            return {
                statusCode: 500,
                body: `Errore download template: ${tplErr?.message || 'no data'}`,
            }
        }

        const templateBytes = new Uint8Array(await tplData.arrayBuffer())
        const pdfDoc = await PDFDocument.load(templateBytes)
        const form = pdfDoc.getForm()
        const fields = form.getFields()

        const fieldList = fields.map(f => ({
            name: f.getName(),
            type: f.constructor.name,
        }))

        const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Contract PDF Fields</title>
<style>
body { font-family: -apple-system, sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
h1 { color: #1d1d1f; }
table { border-collapse: collapse; width: 100%; }
th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e5ea; }
th { background: #f5f5f7; font-weight: 600; }
.name { font-family: 'SF Mono', Menlo, monospace; color: #007aff; }
.type { color: #6e6e73; font-size: 12px; }
.count { color: #6e6e73; margin-bottom: 16px; }
</style></head><body>
<h1>Contract PDF — AcroForm fields</h1>
<div class="count">${fieldList.length} campi totali nel template</div>
<table>
<thead><tr><th>Nome field (esatto)</th><th>Tipo</th></tr></thead>
<tbody>
${fieldList.map(f => `<tr><td class="name">${escapeHtml(f.name)}</td><td class="type">${escapeHtml(f.type)}</td></tr>`).join('\n')}
</tbody>
</table>
</body></html>`

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            body: html,
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return {
            statusCode: 500,
            body: `Errore: ${msg}`,
        }
    }
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
