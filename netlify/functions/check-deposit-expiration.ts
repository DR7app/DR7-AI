import { Handler, schedule } from '@netlify/functions'
import nodemailer from 'nodemailer'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// SMTP configuration - uses info@dr7.app
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.secureserver.net',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
    },
})

interface Cauzione {
    id: string
    scadenza_cauzione: string
    importo: number
    metodo: string
    stato: string
    data_restituzione_veicolo: string
    cliente_id: string
    veicolo_id: string
    note?: string
}

function getExpirationAlarmHTML(cauzioni: any[]): string {
    const cauzioneRows = cauzioni.map(c => `
        <tr style="border-bottom: 1px solid #333;">
            <td style="padding: 12px; color: #ffffff;">${c.cliente_nome || 'N/A'}</td>
            <td style="padding: 12px; color: #ffffff;">${c.veicolo_nome || 'N/A'}</td>
            <td style="padding: 12px; color: #d4af37; font-weight: bold;">€${c.importo.toFixed(2)}</td>
            <td style="padding: 12px; color: #ffffff;">${c.metodo}</td>
            <td style="padding: 12px; color: #ffffff;">${new Date(c.data_restituzione_veicolo + 'T00:00:00').toLocaleDateString('it-IT')}</td>
            <td style="padding: 12px; color: #ff4444; font-weight: bold;">${new Date(c.scadenza_cauzione + 'T00:00:00').toLocaleDateString('it-IT')}</td>
        </tr>
    `).join('')

    return `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 900px; margin: 0 auto; background-color: #000000; color: #ffffff; padding: 40px 20px;">
      <div style="text-align: center; margin-bottom: 30px;">
        <img src="https://dr7-empire-admin.netlify.app/DR7logo1.png" alt="DR7 Empire" style="height: 60px;" />
      </div>
      
      <h1 style="color: #ff9900; font-size: 24px; margin-bottom: 20px; text-align: center;">⏰ ALLARME SCADENZA CAUZIONE</h1>
      
      <p style="font-size: 16px; line-height: 1.6; color: #cccccc; margin-bottom: 20px;">
        Le seguenti cauzioni <strong style="color: #d4af37;">scadono OGGI</strong> (14° giorno lavorativo dalla restituzione veicolo):
      </p>

      <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background-color: #111;">
        <thead>
          <tr style="background-color: #222; border-bottom: 2px solid #d4af37;">
            <th style="padding: 12px; text-align: left; color: #d4af37;">Cliente</th>
            <th style="padding: 12px; text-align: left; color: #d4af37;">Veicolo</th>
            <th style="padding: 12px; text-align: left; color: #d4af37;">Importo</th>
            <th style="padding: 12px; text-align: left; color: #d4af37;">Metodo</th>
            <th style="padding: 12px; text-align: left; color: #d4af37;">Data Restituzione</th>
            <th style="padding: 12px; text-align: left; color: #d4af37;">Scadenza</th>
          </tr>
        </thead>
        <tbody>
          ${cauzioneRows}
        </tbody>
      </table>

      <div style="background-color: #1a1000; border-left: 4px solid #ff9900; padding: 20px; margin: 30px 0;">
        <p style="font-size: 16px; color: #ffffff; margin: 0;">
          <strong>⚠️ AZIONE RICHIESTA:</strong> Procedere con la restituzione/sblocco delle cauzioni entro oggi per rispettare i termini contrattuali.
        </p>
      </div>

      <div style="border-top: 1px solid #333; padding-top: 20px; margin-top: 30px; text-align: center;">
        <p style="font-size: 14px; color: #999999; margin: 0;">
          Sistema Automatico Allarmi Cauzione – DR7 Empire Admin
        </p>
        <p style="font-size: 12px; color: #666666; margin-top: 10px;">
          Le scadenze sono calcolate automaticamente escludendo weekend e festività italiane
        </p>
      </div>
    </div>
    `
}

const scheduledHandler: Handler = async (event) => {
    console.log('🔍 Checking for deposit expirations...')

    try {
        const today = new Date().toISOString().split('T')[0]

        // Query cauzioni expiring today that are still active
        const { data: expiringCauzioni, error } = await supabase
            .from('cauzioni')
            .select(`
                *,
                customers_extended!cauzioni_cliente_id_fkey (
                    nome,
                    cognome
                ),
                vehicles!cauzioni_veicolo_id_fkey (
                    name
                )
            `)
            .eq('scadenza_cauzione', today)
            .in('stato', ['Attiva', 'In scadenza'])

        if (error) {
            console.error('❌ Error fetching cauzioni:', error)
            return {
                statusCode: 500,
                body: JSON.stringify({ error: error.message })
            }
        }

        if (!expiringCauzioni || expiringCauzioni.length === 0) {
            console.log('✅ No deposits expiring today')
            return {
                statusCode: 200,
                body: JSON.stringify({ message: 'No deposits expiring today' })
            }
        }

        // Enrich data for email
        const enrichedCauzioni = expiringCauzioni.map(c => ({
            ...c,
            cliente_nome: c.customers_extended
                ? `${c.customers_extended.nome} ${c.customers_extended.cognome}`
                : 'Cliente sconosciuto',
            veicolo_nome: c.vehicles?.name || 'Veicolo sconosciuto'
        }))

        // Send alarm email to admin
        const adminEmail = process.env.ADMIN_EMAIL || 'info@dr7.app'

        await transporter.sendMail({
            from: '"DR7 Empire Allarmi" <info@dr7.app>',
            to: adminEmail,
            subject: `⏰ SCADENZA CAUZIONE: ${expiringCauzioni.length} cauzione/i in scadenza OGGI`,
            html: getExpirationAlarmHTML(enrichedCauzioni),
        })

        console.log(`✅ Expiration alarm sent for ${expiringCauzioni.length} deposit(s)`)

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Expiration alarm sent',
                count: expiringCauzioni.length,
                cauzioni: enrichedCauzioni.map(c => ({
                    id: c.id,
                    cliente: c.cliente_nome,
                    veicolo: c.veicolo_nome,
                    importo: c.importo,
                    scadenza: c.scadenza_cauzione
                }))
            })
        }

    } catch (error: any) {
        console.error('❌ Error in check-deposit-expiration:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        }
    }
}

// Run every day at 9:00 AM to check for expirations
export const handler = schedule('0 9 * * *', scheduledHandler)
