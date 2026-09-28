/**
 * EMTN — comunicazione al cliente e notifica di approvazione a DR7
 * (workflow, fasi 8 e 9). Testi in Messaggi di Sistema Pro:
 *   pro_emtn_segnalazione_cliente      email al cliente
 *   pro_emtn_segnalazione_approvazione WhatsApp al numero admin
 * Invio email come send-whatsapp-notification (Resend, mittente da Centralina,
 * interruttore System Control "invio_email").
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { renderTemplate } from './messageTemplates'
import { getEmailFrom, estraiIndirizzoEmail } from './emailFrom'
import { funzioneFerma } from './systemControl'
import { getAdminNotificationPhone } from './notificationPhone'

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function htmlEmail(testo: string): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1d1d1f;">
<div style="max-width:600px;margin:24px auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
<div style="font-size:14px;line-height:1.6;">${escapeHtml(testo).replace(/\n/g, '<br>')}</div>
</div></body></html>`
}

/** Dati dell'operatore segnalante da Centralina Pro > Locatore. */
export async function operatoreSegnalante(sb: SupabaseClient): Promise<{ nome: string; email: string }> {
    const { data } = await sb.from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle()
    const loc = ((data?.config || {}) as { locatore?: { ragione_sociale?: string; email?: string } }).locatore || {}
    const mittente = estraiIndirizzoEmail(await getEmailFrom('DR7 <noreply@dr7.app>'))
    return { nome: String(loc.ragione_sociale || 'DR7').trim(), email: String(loc.email || mittente).trim() }
}

export async function emailAlCliente(
    destinatario: string,
    variabili: Record<string, string>,
): Promise<{ ok: boolean; errore?: string; oggetto?: string }> {
    const testo = await renderTemplate('pro_emtn_segnalazione_cliente', variabili)
    if (!testo) return { ok: false, errore: 'Messaggio "EMTN: Segnalazione al cliente" spento o assente in Messaggi di Sistema Pro' }
    const ferma = await funzioneFerma('invio_email', '*')
    if (ferma) return { ok: false, errore: ferma }
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) return { ok: false, errore: 'RESEND_API_KEY mancante' }

    const { createClient } = await import('@supabase/supabase-js')
    const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: meta } = await sb.from('system_messages').select('email_subject, label').eq('message_key', 'pro_emtn_segnalazione_cliente').maybeSingle()
    const oggetto = String(meta?.email_subject || meta?.label || 'EMTN – European Mobility Trust Network').trim()

    try {
        const risposta = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: await getEmailFrom('DR7 <noreply@dr7.app>'), to: [destinatario], subject: oggetto, html: htmlEmail(testo) }),
        })
        if (!risposta.ok) return { ok: false, errore: `Resend ${risposta.status}: ${(await risposta.text()).slice(0, 300)}`, oggetto }
        return { ok: true, oggetto }
    } catch (e) {
        return { ok: false, errore: e instanceof Error ? e.message : 'errore di rete', oggetto }
    }
}

export async function whatsappApprovazione(variabili: Record<string, string>): Promise<{ ok: boolean; errore?: string }> {
    const testo = await renderTemplate('pro_emtn_segnalazione_approvazione', variabili)
    if (!testo) return { ok: false, errore: 'Messaggio "EMTN: Segnalazione da approvare" spento o assente' }
    try {
        const telefono = await getAdminNotificationPhone()
        const risposta = await fetch(`${process.env.URL || 'https://platform.dr7ai.com'}/.netlify/functions/send-whatsapp-notification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customPhone: telefono, customMessage: testo, notifyAdmin: true, type: 'EMTN approvazione' }),
        })
        return risposta.ok ? { ok: true } : { ok: false, errore: `HTTP ${risposta.status}` }
    } catch (e) {
        return { ok: false, errore: e instanceof Error ? e.message : 'errore di rete' }
    }
}
