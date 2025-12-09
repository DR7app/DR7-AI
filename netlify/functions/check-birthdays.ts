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

// Birthday email template
function getBirthdayEmailHTML(nome: string, cognome: string): string {
    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; text-align: center; padding: 20px;">
      <h1 style="color: #d4af37; font-size: 32px; margin-bottom: 10px;">🎉 Buon Compleanno ${nome}! 🎂</h1>
      <p style="font-size: 18px; color: #333; margin: 20px 0;">
        Tanti auguri di buon compleanno da tutto il team di DR7 Empire!
      </p>
      <p style="font-size: 16px; color: #666; margin: 20px 0;">
        Per festeggiare il tuo giorno speciale, abbiamo un regalo per te:
      </p>
      <img src="cid:birthday-voucher" alt="Buono Regalo Compleanno" style="max-width: 100%; height: auto; margin: 20px 0; border-radius: 10px;"/>
      <p style="font-size: 14px; color: #999; margin-top: 30px;">
        Grazie per essere un cliente speciale!<br/>
        <strong>DR7 Empire Team</strong>
      </p>
    </div>
  `
}

export const handler: Handler = async (event) => {
    try {
        console.log('[check-birthdays] Starting birthday check...')

        // Calculate target date (7 days from now)
        const today = new Date()
        const targetDate = new Date(today)
        targetDate.setDate(today.getDate() + 7)

        const targetMonth = targetDate.getMonth() + 1 // 1-12
        const targetDay = targetDate.getDate()
        const currentYear = today.getFullYear()

        console.log(`[check-birthdays] Looking for birthdays on ${targetMonth}/${targetDay}`)

        // Query customers with birthdays on target date
        const { data: customers, error: customersError } = await supabase
            .from('customers_extended')
            .select('id, nome, cognome, email, data_nascita')
            .not('data_nascita', 'is', null)
            .not('email', 'is', null)

        if (customersError) {
            console.error('[check-birthdays] Error fetching customers:', customersError)
            throw customersError
        }

        console.log(`[check-birthdays] Found ${customers?.length || 0} customers with birthdays`)

        // Filter customers with birthdays on target date
        const birthdayCustomers = (customers || []).filter(customer => {
            if (!customer.data_nascita) return false
            const birthDate = new Date(customer.data_nascita)
            return birthDate.getMonth() + 1 === targetMonth && birthDate.getDate() === targetDay
        })

        console.log(`[check-birthdays] ${birthdayCustomers.length} customers have birthdays in 7 days`)

        let sentCount = 0
        const errors: string[] = []

        for (const customer of birthdayCustomers) {
            try {
                // Check if voucher already sent this year
                const { data: existingVoucher } = await supabase
                    .from('birthday_vouchers')
                    .select('id')
                    .eq('customer_id', customer.id)
                    .eq('voucher_year', currentYear)
                    .single()

                if (existingVoucher) {
                    console.log(`[check-birthdays] Voucher already sent to ${customer.email} this year`)
                    continue
                }

                // Get default birthday voucher image URL (you'll need to upload this)
                const birthdayImageUrl = process.env.BIRTHDAY_VOUCHER_IMAGE_URL || ''

                let imageBuffer: Buffer | undefined

                if (birthdayImageUrl) {
                    // Download image
                    const response = await fetch(birthdayImageUrl)
                    if (response.ok) {
                        const arrayBuffer = await response.arrayBuffer()
                        imageBuffer = Buffer.from(arrayBuffer)
                    }
                }

                // Send birthday email
                const mailOptions = {
                    from: `"DR7 Empire" <${process.env.GMAIL_USER}>`,
                    to: customer.email,
                    subject: `🎉 Buon Compleanno ${customer.nome}!`,
                    html: getBirthdayEmailHTML(customer.nome || '', customer.cognome || ''),
                    attachments: imageBuffer ? [{
                        filename: 'buono-regalo-compleanno.jpg',
                        content: imageBuffer,
                        cid: 'birthday-voucher'
                    }] : []
                }

                await transporter.sendMail(mailOptions)
                console.log(`[check-birthdays] Birthday email sent to: ${customer.email}`)

                // Record in database
                await supabase
                    .from('birthday_vouchers')
                    .insert({
                        customer_id: customer.id,
                        customer_email: customer.email,
                        customer_name: `${customer.nome} ${customer.cognome}`,
                        birthday_date: customer.data_nascita,
                        voucher_year: currentYear,
                        email_sent: true
                    })

                sentCount++
            } catch (error: any) {
                console.error(`[check-birthdays] Error processing ${customer.email}:`, error)
                errors.push(`${customer.nome} ${customer.cognome}: ${error.message}`)
            }
        }

        console.log(`[check-birthdays] Completed. Sent ${sentCount} birthday emails.`)

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                checked: birthdayCustomers.length,
                sent: sentCount,
                errors: errors.length > 0 ? errors : undefined,
                date: targetDate.toISOString()
            })
        }

    } catch (error: any) {
        console.error('[check-birthdays] Error:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: error.message || 'Unknown error occurred',
                details: error.toString()
            })
        }
    }
}
