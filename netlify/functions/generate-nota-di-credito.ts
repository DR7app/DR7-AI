import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { generateInvoicePDF } from './invoice-pdf-utils'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN

/**
 * Generate a Nota di Credito (TD04) from an existing fattura.
 * Creates a new fatture row with tipo_fattura='nota_di_credito',
 * linked to the original via related_invoice_id.
 * Same items/amounts — the TD04 document type tells SDI it's a credit.
 */
export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    try {
        const { invoiceId } = JSON.parse(event.body || '{}')

        if (!invoiceId) {
            return { statusCode: 400, body: JSON.stringify({ error: 'invoiceId is required' }) }
        }

        // Fetch original invoice
        const { data: original, error: fetchError } = await supabase
            .from('fatture')
            .select('*')
            .eq('id', invoiceId)
            .single()

        if (fetchError || !original) {
            return { statusCode: 404, body: JSON.stringify({ error: 'Fattura non trovata' }) }
        }

        // Check: don't create nota di credito for a nota di credito
        if (original.tipo_fattura === 'nota_di_credito') {
            return { statusCode: 400, body: JSON.stringify({ error: 'Non puoi creare una nota di credito da una nota di credito' }) }
        }

        // Check: don't create duplicate nota di credito
        const { data: existingNdc } = await supabase
            .from('fatture')
            .select('id, numero_fattura')
            .eq('related_invoice_id', invoiceId)
            .eq('tipo_fattura', 'nota_di_credito')
            .maybeSingle()

        if (existingNdc) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: `Nota di credito già esistente: ${existingNdc.numero_fattura}`
                })
            }
        }

        // Generate new invoice number
        const currentYear = new Date().getFullYear()
        const { data: seqResult, error: seqError } = await supabase.rpc('next_invoice_number', { p_year: currentYear })

        if (seqError || seqResult == null) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'Errore generazione numero', details: seqError?.message })
            }
        }

        const notaNumber = `DR7-${currentYear}-${String(seqResult).padStart(4, '0')}`
        const today = new Date().toISOString().split('T')[0]

        // Create the nota di credito record
        const notaRecord = {
            numero_fattura: notaNumber,
            data_emissione: today,
            customer_name: original.customer_name,
            customer_email: original.customer_email,
            customer_phone: original.customer_phone,
            customer_address: original.customer_address,
            customer_tax_code: original.customer_tax_code,
            customer_vat: original.customer_vat,
            customer_sdi_code: original.customer_sdi_code,
            customer_pec: original.customer_pec,
            items: original.items,
            subtotal: original.subtotal,
            vat_amount: original.vat_amount,
            exempt_amount: original.exempt_amount,
            importo_totale: original.importo_totale,
            stato: 'paid',
            booking_id: original.booking_id,
            tipo_fattura: 'nota_di_credito',
            related_invoice_id: invoiceId,
            sdi_status: 'draft',
        }

        const { data: nota, error: insertError } = await supabase
            .from('fatture')
            .insert([notaRecord])
            .select()
            .single()

        if (insertError || !nota) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'Errore creazione nota di credito', details: insertError?.message })
            }
        }

        // Genera il PDF della Nota di Credito, lo salva e lo invia AUTOMATICAMENTE
        // al cliente via WhatsApp (come la fattura). Non-bloccante: se fallisce,
        // la nota resta creata.
        let pdfUrl: string | null = null
        try {
            const pdfBytes = await generateInvoicePDF(nota as any)
            const pdfFileName = `nota_credito_${nota.numero_fattura.replace(/\//g, '-')}_${Date.now()}.pdf`
            const { error: uploadError } = await supabase.storage
                .from('invoices')
                .upload(pdfFileName, pdfBytes, { contentType: 'application/pdf', upsert: true })
            if (uploadError) {
                console.error('[NotaCredito] PDF upload failed:', uploadError.message)
            } else {
                const { data: { publicUrl } } = supabase.storage.from('invoices').getPublicUrl(pdfFileName)
                pdfUrl = publicUrl
                await supabase.from('fatture').update({ pdf_url: pdfUrl }).eq('id', nota.id)

                const customerPhone = nota.customer_phone || ''
                if (customerPhone && GREEN_API_INSTANCE_ID && GREEN_API_TOKEN) {
                    let cleanPhone = String(customerPhone).replace(/\D/g, '')
                    if (cleanPhone.startsWith('00')) cleanPhone = cleanPhone.substring(2)
                    if (cleanPhone.length === 10) cleanPhone = '39' + cleanPhone
                    const greenApiUrl = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendFileByUrl/${GREEN_API_TOKEN}`
                    const waResponse = await fetch(greenApiUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chatId: `${cleanPhone}@c.us`,
                            urlFile: pdfUrl,
                            fileName: `Nota_di_Credito_${nota.numero_fattura}.pdf`,
                            caption: `Nota di Credito ${nota.numero_fattura} - DR7`,
                        }),
                    })
                    const waResult = await waResponse.json().catch(() => ({}))
                    if (waResponse.ok && !waResult.error) {
                        console.log('[NotaCredito] PDF inviato via WhatsApp:', waResult.idMessage)
                    } else {
                        console.error('[NotaCredito] WhatsApp send failed:', waResult)
                    }
                } else {
                    console.log('[NotaCredito] Nessun telefono o Green API non configurato — invio WhatsApp saltato')
                }
            }
        } catch (pdfErr: any) {
            console.error('[NotaCredito] PDF generazione/invio fallito (nota comunque creata):', pdfErr?.message)
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                notaDiCredito: {
                    id: nota.id,
                    numero_fattura: nota.numero_fattura,
                    importo_totale: nota.importo_totale,
                    pdf_url: pdfUrl,
                },
                message: `Nota di credito ${notaNumber} creata${pdfUrl ? ' e PDF inviato al cliente' : ''}. Invia a SDI per completare.`
            })
        }
    } catch (error: any) {
        console.error('Error in generate-nota-di-credito:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal server error', message: error.message })
        }
    }
}
