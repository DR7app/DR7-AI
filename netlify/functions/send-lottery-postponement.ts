import { Handler } from '@netlify/functions'
import nodemailer from 'nodemailer'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
    },
})

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) }
    }

    try {
        console.log('[send-lottery-postponement] Starting email campaign...')

        // 1. Get all unique customers who bought lottery tickets
        const { data: tickets, error: ticketsError } = await supabase
            .from('commercial_operation_tickets')
            .select('email, full_name')
            .order('email')

        if (ticketsError) {
            console.error('[send-lottery-postponement] Error fetching tickets:', ticketsError)
            return { statusCode: 500, body: JSON.stringify({ error: 'Failed to fetch tickets: ' + ticketsError.message }) }
        }

        if (!tickets || tickets.length === 0) {
            console.log('[send-lottery-postponement] No tickets found')
            return { statusCode: 200, body: JSON.stringify({ success: true, message: 'No tickets found', sent: 0 }) }
        }

        // 2. Get unique customers (deduplicate by email)
        const uniqueCustomers = Array.from(
            new Map(tickets.map(t => [t.email.toLowerCase(), t])).values()
        )

        console.log('[send-lottery-postponement] Found', uniqueCustomers.length, 'unique customers')

        // 3. Verify SMTP credentials
        const smtpUser = process.env.GMAIL_USER
        const smtpPass = process.env.GMAIL_APP_PASSWORD

        if (!smtpUser || !smtpPass) {
            console.error('[send-lottery-postponement] Missing SMTP credentials')
            return { statusCode: 500, body: JSON.stringify({ error: 'SMTP credentials not configured' }) }
        }

        // 4. Send email to each customer
        let successCount = 0
        let failCount = 0
        const errors: string[] = []

        for (const customer of uniqueCustomers) {
            try {
                const mailOptions = {
                    from: `"DR7 Empire - Lotteria" <${smtpUser}>`,
                    to: customer.email,
                    subject: '🎟️ Importante: Estrazione Lotteria DR7 Rinviata al 24 Gennaio - ULTIMI BIGLIETTI',
                    html: `
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <meta charset="UTF-8">
                            <style>
                                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                                .header { background: linear-gradient(135deg, #FFD700 0%, #FFA500 100%); color: #000; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                                .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
                                .highlight { background: #FFD700; color: #000; padding: 15px; border-radius: 5px; text-align: center; font-weight: bold; font-size: 18px; margin: 20px 0; }
                                .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
                                .button { display: inline-block; background: #FFD700; color: #000; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; margin: 15px 0; }
                            </style>
                        </head>
                        <body>
                            <div class="container">
                                <div class="header">
                                    <h1 style="margin: 0;">🎟️ DR7 EMPIRE LOTTERIA</h1>
                                    <p style="margin: 10px 0 0 0; font-size: 16px;">Comunicazione Importante - ULTIMI BIGLIETTI</p>
                                </div>
                                <div class="content">
                                    <p>Gentile,</p>
                                    
                                    <p>Ti scriviamo per informarti di un importante aggiornamento riguardo alla <strong>Lotteria DR7 Empire. ULTIMI BIGLIETTI.</strong></p>
                                    
                                    <div class="highlight">
                                        📅 L'estrazione è stata RINVIATA al<br>
                                        <span style="font-size: 24px;">24 GENNAIO 2025</span><br>
                                        <span style="font-size: 14px; font-weight: normal;">TEMPO MASSIMO COME DA REGOLAMENTO</span>
                                    </div>
                                    
                                    <p><strong>Il tuo biglietto rimane valido!</strong></p>
                                    
                                    <p>Tutti i biglietti acquistati parteciperanno regolarmente all'estrazione nella nuova data. Non è necessaria alcuna azione da parte tua.</p>
                                    
                                    <p><strong>Cosa significa per te:</strong></p>
                                    <ul>
                                        <li>✅ Il tuo biglietto è confermato e valido</li>
                                        <li>✅ Hai più tempo per acquistare biglietti aggiuntivi</li>
                                        <li>✅ L'estrazione si terrà il 24 gennaio 2025</li>
                                        <li>✅ I premi rimangono invariati</li>
                                    </ul>
                                    
                                    <p>Ci scusiamo per l'inconveniente e ti ringraziamo per la comprensione.</p>
                                    
                                    <p style="text-align: center; margin-top: 30px;">
                                        <a href="https://dr7empire.com" class="button">Visita DR7 Empire</a>
                                    </p>
                                    
                                    <p style="margin-top: 30px;">Per qualsiasi domanda, non esitare a contattarci.</p>
                                    
                                    <p><strong>Buona fortuna! 🍀</strong></p>
                                    
                                    <p style="margin-top: 20px;">
                                        Cordiali saluti,<br>
                                        <strong>Il Team DR7 Empire</strong>
                                    </p>
                                </div>
                                <div class="footer">
                                    <p>DR7 Empire - Luxury Car Rental & Services</p>
                                    <p>Questa è una comunicazione ufficiale riguardante la tua partecipazione alla Lotteria DR7.</p>
                                </div>
                            </div>
                        </body>
                        </html>
                    `,
                    text: `
Gentile,

Ti scriviamo per informarti di un importante aggiornamento riguardo alla Lotteria DR7 Empire. ULTIMI BIGLIETTI.

📅 L'ESTRAZIONE È STATA RINVIATA AL 24 GENNAIO 2025
TEMPO MASSIMO COME DA REGOLAMENTO

Il tuo biglietto rimane valido!

Tutti i biglietti acquistati parteciperanno regolarmente all'estrazione nella nuova data. Non è necessaria alcuna azione da parte tua.

Cosa significa per te:
✅ Il tuo biglietto è confermato e valido
✅ Hai più tempo per acquistare biglietti aggiuntivi
✅ L'estrazione si terrà il 24 gennaio 2025
✅ I premi rimangono invariati

Ci scusiamo per l'inconveniente e ti ringraziamo per la comprensione.

Per qualsiasi domanda, non esitare a contattarci.

Buona fortuna! 🍀

Cordiali saluti,
Il Team DR7 Empire

---
DR7 Empire - Luxury Car Rental & Services
Questa è una comunicazione ufficiale riguardante la tua partecipazione alla Lotteria DR7.
                    `
                }

                await transporter.sendMail(mailOptions)
                successCount++
                console.log(`[send-lottery-postponement] ✅ Email sent to: ${customer.email}`)

                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 100))

            } catch (error: any) {
                failCount++
                const errorMsg = `Failed to send to ${customer.email}: ${error.message}`
                errors.push(errorMsg)
                console.error(`[send-lottery-postponement] ❌ ${errorMsg}`)
            }
        }

        console.log('[send-lottery-postponement] Campaign completed:', { successCount, failCount })

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: `Email campaign completed`,
                sent: successCount,
                failed: failCount,
                total: uniqueCustomers.length,
                errors: errors.length > 0 ? errors : undefined
            })
        }

    } catch (error: any) {
        console.error('[send-lottery-postponement] Error:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: error.message || 'Unknown error occurred',
                details: error.toString()
            })
        }
    }
}
