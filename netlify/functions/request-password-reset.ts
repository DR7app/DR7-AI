/**
 * request-password-reset — "Password dimenticata" del gestionale.
 *
 * 2026-08-25: il reset NATIVO di Supabase non funzionava per gli operatori.
 * `resetPasswordForEmail` chiedeva di tornare su platform.dr7ai.com, ma quel
 * dominio non e' fra i "Redirect URLs" del progetto Supabase (condiviso con il
 * sito pubblico): GoTrue scartava l'indirizzo richiesto e faceva ripiego sulla
 * "Site URL" del dashboard, cioe' il SITO. Chi chiedeva la password del
 * gestionale finiva sulla vetrina, senza poter reimpostare niente.
 *
 * Qui il link lo costruiamo noi, come gia' fa il sito (Sito/netlify/functions/
 * request-password-reset.js):
 *   1. `generateLink` produce il token di recupero lato server (service role);
 *   2. NON usiamo `action_link` — punta a /auth/v1/verify e da li' alla Site
 *      URL, cioe' esattamente il dominio sbagliato che vogliamo evitare;
 *   3. mandiamo via Resend un link DIRETTO a /reset-password?token_hash=...,
 *      che la pagina verifica con `verifyOtp` parlando con Supabase via SDK.
 *
 * Risultato: nessuna dipendenza dalla Site URL ne' dalla lista dei Redirect
 * URLs del dashboard. Non serve toccare la configurazione condivisa col sito.
 *
 * Endpoint PUBBLICO (chi ha perso la password non ha sessione), quindi:
 *  - risponde SEMPRE 200 senza dire se l'email esiste (niente enumerazione);
 *  - invia solo a chi e' un operatore attivo in `admins`: il gestionale non
 *    deve poter spedire email di reset ai clienti del sito.
 */
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from './cors-headers'
import { getEmailFrom } from './utils/emailFrom'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

/** Netlify valorizza URL con il dominio primario del sito (platform.dr7ai.com). */
const BASE_URL = process.env.URL || 'https://platform.dr7ai.com'

/** Risposta unica: non riveliamo mai se l'email e' registrata. */
function ok(headers: Record<string, string>) {
  return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) }
}

const handler: Handler = async (event) => {
  const headers = corsHeaders(event.headers.origin || event.headers.Origin)

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) }
  }

  let email = ''
  try {
    email = String((JSON.parse(event.body || '{}') as { email?: string }).email || '')
      .trim()
      .toLowerCase()
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Body non valido' }) }
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email non valida' }) }
  }

  try {
    // Solo operatori del gestionale, e non archiviati: un ex collaboratore non
    // deve poter rientrare, e un cliente del sito non deve ricevere questa mail.
    // ilike, non eq: le email storiche non sono tutte in minuscolo.
    const { data: admin } = await supabase
      .from('admins')
      .select('email, archived_at')
      .ilike('email', email)
      .maybeSingle()
    if (!admin || admin.archived_at) return ok(headers)

    // Niente options.redirectTo: finirebbe solo dentro action_link, che non
    // usiamo, e un indirizzo fuori lista bianca farebbe fallire la chiamata.
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email: admin.email || email,
    })
    if (linkError || !linkData?.properties?.hashed_token) {
      if (linkError) console.error('[request-password-reset] generateLink:', linkError.message)
      return ok(headers)
    }

    const tokenHash = encodeURIComponent(linkData.properties.hashed_token)
    const resetLink = `${BASE_URL}/reset-password?token_hash=${tokenHash}&type=recovery`

    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      console.error('[request-password-reset] RESEND_API_KEY mancante: email non inviata')
      return ok(headers)
    }
    const from = await getEmailFrom('DR7 A.I. <noreply@dr7.app>')

    const text = `Ciao,

Abbiamo ricevuto una richiesta per reimpostare la password del tuo accesso al gestionale DR7.

Reimpostala qui: ${resetLink}

Il link vale una sola volta e scade dopo un'ora. Se non l'hai richiesta tu, ignora questo messaggio: la password attuale resta valida.

DR7 A.I.`

    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#333">
<p>Ciao,</p>
<p>Abbiamo ricevuto una richiesta per reimpostare la password del tuo accesso al <strong>gestionale DR7</strong>.</p>
<p style="margin:24px 0"><a href="${resetLink}" style="background:#1a1a1a;color:#fff;padding:12px 28px;border-radius:4px;text-decoration:none;font-size:14px">Reimposta password</a></p>
<p style="font-size:13px;color:#666">Oppure copia questo link nel browser:<br><a href="${resetLink}" style="color:#666;word-break:break-all">${resetLink}</a></p>
<p style="font-size:12px;color:#999;margin-top:32px;border-top:1px solid #eee;padding-top:16px">Il link vale una sola volta e scade dopo un'ora. Se non hai richiesto tu la modifica, ignora questo messaggio: la password attuale resta valida.<br><br>DR7 A.I.</p>
</div>`

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [admin.email || email],
        subject: 'Reimposta la password del gestionale DR7',
        text,
        html,
      }),
    })
    if (!resp.ok) {
      console.error('[request-password-reset] Resend', resp.status, (await resp.text()).slice(0, 300))
    }
    return ok(headers)
  } catch (e) {
    // Anche in errore non blocchiamo l'utente con i dettagli.
    console.error('[request-password-reset]', e instanceof Error ? e.message : String(e))
    return ok(headers)
  }
}

export { handler }
