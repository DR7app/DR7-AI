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

// Birthday email template with new premium text
function getBirthdayEmailHTML(nome: string, cognome: string): string {
    return `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #000000; color: #ffffff; padding: 40px 20px;">
      <div style="text-align: center; margin-bottom: 30px;">
        <img src="https://dr7-empire-admin.netlify.app/DR7logo1.png" alt="DR7 Empire" style="height: 60px;" />
      </div>
      
      <h1 style="color: #d4af37; font-size: 24px; margin-bottom: 20px; text-align: left;">Ciao 👋🏻</h1>
      
      <p style="font-size: 16px; line-height: 1.6; color: #cccccc; margin-bottom: 20px; text-align: left;">
        Mancano esattamente 7 giorni a una data speciale: il tuo compleanno.🥳
      </p>

      <p style="font-size: 16px; line-height: 1.6; color: #cccccc; margin-bottom: 20px; text-align: left;">
        Non siamo qui per anticipare gli auguri, ma per fare qualcosa di più sincero e raro: riconoscere il tuo valore, prima ancora di celebrarlo.
      </p>

      <p style="font-size: 16px; line-height: 1.6; color: #cccccc; margin-bottom: 20px; text-align: left;">
        In qualità di nostro cliente, ci fa piacere riservarti un pensiero autentico, all’altezza del tuo stile.🎁
      </p>

      <div style="background-color: #111; border: 1px solid #d4af37; padding: 20px; margin: 30px 0; border-radius: 8px;">
        <p style="font-size: 18px; line-height: 1.6; color: #d4af37; margin: 0; text-align: center;">
          Per questo, abbiamo predisposto per te un <strong>credito personale del valore di €100</strong> utilizzabile per un noleggio DR7 e un <strong>buono sconto del valore di €10</strong> per un lavaggio auto DR7.
        </p>
      </div>

      <p style="font-size: 16px; line-height: 1.6; color: #cccccc; margin-bottom: 20px; text-align: left;">
        È un invito, discreto ma reale, a concederti un momento diverso.
      </p>

      <p style="font-size: 16px; line-height: 1.6; color: #cccccc; margin-bottom: 30px; text-align: left;">
        Non un semplice regalo, ma un’occasione per guidare qualcosa che ti rappresenti: potente, elegante, inconfondibile.
      </p>

      <div style="border-top: 1px solid #333; padding-top: 30px; margin-top: 40px;">
        <p style="font-size: 16px; line-height: 1.6; color: #999999; margin-bottom: 10px; text-align: left;">
          Con stima e attenzione,
        </p>
        <p style="font-size: 18px; font-weight: bold; color: #ffffff; margin-bottom: 5px; text-align: left;">
          Dubai Rent 7.0 – S.p.A.
        </p>
        <p style="font-size: 14px; font-style: italic; color: #d4af37; margin: 0; text-align: left;">
          Ogni compleanno merita uno stile all’altezza.
        </p>
      </div>
    </div>
  `
}

import { schedule } from '@netlify/functions'

const scheduledHandler: Handler = async (event) => {
    // ... function body ...
}

// Check every day at 10:00 AM
export const handler = schedule('0 10 * * *', scheduledHandler)
