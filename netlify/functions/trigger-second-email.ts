import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { PDFDocument } from 'pdf-lib'
import crypto from 'crypto'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
    }

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers, body: '' }
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    try {
        const { addebitoId } = JSON.parse(event.body || '{}')
        if (!addebitoId) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'addebitoId required' }) }
        }

        // Fetch the addebito
        const { data: addebito, error: fetchErr } = await supabase
            .from('pending_addebiti')
            .select('*')
            .eq('id', addebitoId)
            .single()

        if (fetchErr || !addebito) {
            return { statusCode: 404, headers, body: JSON.stringify({ error: 'Addebito non trovato' }) }
        }

        const amountFormatted = (addebito.amount_cents / 100).toFixed(2)

        const emailBody = `Spett.le ${addebito.customer_name || 'Cliente'},

con la presente Le comunichiamo formalmente che, in relazione al contratto di noleggio n. ${addebito.contract_number}, è stato rilevato un importo a Suo carico derivante da obbligazioni contrattuali maturate nel corso o al termine del periodo di utilizzo del veicolo.

L'importo complessivo oggetto di addebito è pari a € ${amountFormatted}, con la seguente causale:
• ${addebito.causale}

Tale importo è determinato in conformità:
• alle condizioni generali di contratto sottoscritte e accettate;
• alla documentazione contrattuale e/o tecnica disponibile (ove applicabile);
• alle disposizioni normative vigenti.

Ai sensi dell'art. 1218 c.c., il debitore che non esegue esattamente la prestazione dovuta è tenuto al risarcimento del danno.
Ai sensi dell'art. 1372 c.c., il contratto ha forza di legge tra le parti.
Ai sensi dell'art. 1588 c.c., il conduttore risponde della perdita e del deterioramento del bene locato.

Si richiama inoltre quanto espressamente previsto nel contratto di noleggio in merito:
• alla responsabilità del cliente per costi, danni, penali e oneri accessori;
• all'autorizzazione preventiva all'addebito di importi ulteriori rispetto al corrispettivo iniziale;
• all'utilizzo del metodo di pagamento fornito per operazioni successive (MIT – Merchant Initiated Transactions).

Pertanto, in conformità alle suddette disposizioni contrattuali e normative, si sta procedendo all'addebito dell'importo sopra indicato mediante il metodo di pagamento da Lei utilizzato in fase di noleggio.

Resta a disposizione, su richiesta, la documentazione a supporto dell'addebito (contratto, report, documentazione fotografica, verbali, ecc.).

La presente costituisce comunicazione formale dell'addebito in corso.

Cordiali saluti,
Dubai Rent 7.0 S.p.A.`

        const emailHtml = `<pre style="font-family: Arial, sans-serif; white-space: pre-wrap;">${emailBody}</pre>`

        // Collect photo URLs — first from pending_addebiti, then fallback to booking_details.danni
        let photoUrls: string[] = (addebito.photo_urls && Array.isArray(addebito.photo_urls))
            ? addebito.photo_urls.filter((u: any) => typeof u === 'string' && u.length > 0)
            : []

        // If no photos in addebito record, look them up from booking_details.danni
        if (photoUrls.length === 0 && addebito.booking_id) {
            console.log(`[trigger-second-email] No photo_urls in addebito, checking booking ${addebito.booking_id}`)
            const { data: booking } = await supabase
                .from('bookings')
                .select('booking_details')
                .eq('id', addebito.booking_id)
                .single()

            if (booking?.booking_details?.danni && Array.isArray(booking.booking_details.danni)) {
                for (const d of booking.booking_details.danni) {
                    if (d.photos && Array.isArray(d.photos)) {
                        photoUrls.push(...d.photos.filter((u: any) => typeof u === 'string' && u.length > 0))
                    }
                }
            }

            // Also save them to the addebito record for future use
            if (photoUrls.length > 0) {
                await supabase.from('pending_addebiti').update({ photo_urls: photoUrls }).eq('id', addebitoId)
                console.log(`[trigger-second-email] Found ${photoUrls.length} photos from booking_details, saved to addebito`)
            }
        }

        console.log(`[trigger-second-email] Addebito ${addebitoId}: ${photoUrls.length} photo URLs total`)

        // Build PDF with danni photos
        const attachments: { filename: string; content: string }[] = []
        if (photoUrls.length > 0) {
            try {
                const pdfDoc = await PDFDocument.create()
                let embeddedCount = 0

                for (let i = 0; i < photoUrls.length; i++) {
                    const url = photoUrls[i]
                    try {
                        console.log(`[trigger-second-email] Fetching photo ${i + 1}/${photoUrls.length}: ${url.substring(0, 100)}`)
                        const imgRes = await fetch(url)
                        if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`)

                        const imgBytes = new Uint8Array(await imgRes.arrayBuffer())
                        const contentType = (imgRes.headers.get('content-type') || '').toLowerCase()
                        console.log(`[trigger-second-email] Photo ${i + 1}: ${contentType}, ${imgBytes.length} bytes`)

                        let image
                        if (contentType.includes('png')) {
                            image = await pdfDoc.embedPng(imgBytes)
                        } else if (contentType.includes('jpg') || contentType.includes('jpeg') || contentType.includes('octet-stream') || contentType === '') {
                            image = await pdfDoc.embedJpg(imgBytes)
                        } else {
                            try { image = await pdfDoc.embedJpg(imgBytes) }
                            catch { image = await pdfDoc.embedPng(imgBytes) }
                        }

                        const pageWidth = 595
                        const pageHeight = 842
                        const margin = 40
                        const maxW = pageWidth - margin * 2
                        const maxH = pageHeight - margin * 2 - 30
                        const scale = Math.min(maxW / image.width, maxH / image.height, 1)
                        const w = image.width * scale
                        const h = image.height * scale

                        const page = pdfDoc.addPage([pageWidth, pageHeight])
                        page.drawText(`Danno ${i + 1} di ${photoUrls.length} — Contratto ${addebito.contract_number}`, {
                            x: margin, y: pageHeight - margin, size: 10,
                        })
                        page.drawImage(image, {
                            x: (pageWidth - w) / 2,
                            y: (pageHeight - h) / 2 - 10,
                            width: w,
                            height: h,
                        })
                        embeddedCount++
                    } catch (imgErr: any) {
                        console.error(`[trigger-second-email] Photo ${i + 1} failed: ${imgErr.message}`)
                        const page = pdfDoc.addPage([595, 842])
                        page.drawText(`Foto ${i + 1}: errore — ${imgErr.message}`, { x: 40, y: 400, size: 10 })
                    }
                }

                if (pdfDoc.getPageCount() > 0) {
                    const pdfBytes = await pdfDoc.save()
                    attachments.push({
                        filename: `Documentazione_Danni_${addebito.contract_number}.pdf`,
                        content: Buffer.from(pdfBytes).toString('base64'),
                    })
                    console.log(`[trigger-second-email] PDF: ${embeddedCount}/${photoUrls.length} photos, ${pdfBytes.length} bytes`)
                }
            } catch (pdfErr: any) {
                console.error(`[trigger-second-email] PDF creation failed: ${pdfErr.message}`)
            }
        }

        const pdfAttached = attachments.length > 0

        const resend = new Resend(process.env.RESEND_API_KEY)
        const { data: emailData, error: emailError } = await resend.emails.send({
            from: 'DR7 Empire <info@dr7.app>',
            to: addebito.customer_email,
            subject: `Comunicazione formale addebito in corso - Contratto ${addebito.contract_number}`,
            html: pdfAttached
                ? emailHtml + `<br/><p style="font-family: Arial, sans-serif;"><strong>Documentazione fotografica danni in allegato PDF.</strong></p>`
                : emailHtml,
            attachments: pdfAttached ? attachments : undefined,
        })

        if (emailError) {
            console.error(`[trigger-second-email] Resend error:`, emailError)
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: `Email non inviata: ${emailError.message}`, details: emailError })
            }
        }

        console.log(`[trigger-second-email] Email sent to ${addebito.customer_email}, Resend ID: ${emailData?.id}, PDF: ${pdfAttached}`)

        // Update status
        await supabase.from('pending_addebiti').update({
            status: 'second_email_sent',
            second_email_sent_at: new Date().toISOString(),
            mit_charge_after: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
        }).eq('id', addebitoId)

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: `2a email inviata a ${addebito.customer_email}`,
                pdfAttached,
                photoCount: photoUrls.length,
                resendId: emailData?.id,
            })
        }
    } catch (err: any) {
        console.error('[trigger-second-email] Error:', err.message)
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: err.message })
        }
    }
}
