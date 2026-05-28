import { getCorsOrigin } from './cors-headers'
import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { getMessageTemplate } from './utils/messageTemplates';
import { getMarketingConfig } from './utils/loadMarketing';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
// GOOGLE_REVIEW_URL ora letto da centralina_pro_config.config.marketing
// via getGoogleReviewLink() — vedi inizio handler.

type SendChannel = 'EMAIL_ONLY' | 'WHATSAPP_ONLY' | 'EMAIL_AND_WHATSAPP';
type SendMode = 'AUTOMATIC' | 'MANUAL';

const getHeaders = (origin?: string) => ({
  'Access-Control-Allow-Origin': getCorsOrigin(origin),
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
});

/**
 * Cleans a phone number to Green API format (e.g. 393457905205)
 */
function cleanPhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-\+\(\)]/g, '');
  if (cleaned.startsWith('00')) {
    cleaned = cleaned.substring(2);
  }
  if (cleaned.length === 10) {
    cleaned = '39' + cleaned;
  }
  return cleaned;
}

/**
 * Replaces template placeholders with actual values
 */
function renderTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}

const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: getHeaders(event.headers.origin), body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: getHeaders(event.headers.origin), body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { candidateId, sendChannel, sendMode } = JSON.parse(event.body || '{}') as {
      candidateId: string;
      sendChannel: SendChannel;
      sendMode: SendMode;
    };

    if (!candidateId || !sendChannel || !sendMode) {
      return {
        statusCode: 400,
        headers: getHeaders(event.headers.origin),
        body: JSON.stringify({ error: 'Missing required fields: candidateId, sendChannel, sendMode' }),
      };
    }

    // 1. Load candidate
    const { data: candidate, error: candidateError } = await supabase
      .from('review_candidates')
      .select('*')
      .eq('id', candidateId)
      .single();

    if (candidateError || !candidate) {
      console.error('[review-send] Candidate not found:', candidateError);
      return {
        statusCode: 404,
        headers: getHeaders(event.headers.origin),
        body: JSON.stringify({ error: 'Candidato non trovato' }),
      };
    }

    // 2. Validate eligibility
    const allowedStatuses = sendMode === 'MANUAL'
      ? ['ELIGIBLE', 'TO_REVIEW']
      : ['ELIGIBLE'];

    if (!allowedStatuses.includes(candidate.eligibility_status)) {
      return {
        statusCode: 400,
        headers: getHeaders(event.headers.origin),
        body: JSON.stringify({
          error: `Candidato non idoneo per l'invio. Stato: ${candidate.eligibility_status}`,
        }),
      };
    }

    // Validate contact availability based on channel
    // 2026-05-28: review flow e' WhatsApp-only. Anche se il caller passa
    // EMAIL_ONLY o EMAIL_AND_WHATSAPP (ad esempio da cron legacy o template
    // di settings), ignoriamo l'email branch — solo WhatsApp esce. Cosi'
    // nessun candidato riceve mai un'email recensione.
    void sendChannel
    const needsEmail = false
    const needsWhatsapp = true

    if (needsEmail && !candidate.contact_available_email) {
      return {
        statusCode: 400,
        headers: getHeaders(event.headers.origin),
        body: JSON.stringify({ error: 'Email non disponibile per questo candidato' }),
      };
    }

    if (needsWhatsapp && !candidate.contact_available_whatsapp) {
      return {
        statusCode: 400,
        headers: getHeaders(event.headers.origin),
        body: JSON.stringify({ error: 'WhatsApp non disponibile per questo candidato' }),
      };
    }

    // 3. Anti-duplication check: no existing SENT request for this candidate
    const { data: existingRequest } = await supabase
      .from('review_requests')
      .select('id')
      .eq('candidate_id', candidateId)
      .eq('send_status', 'SENT')
      .limit(1);

    if (existingRequest && existingRequest.length > 0) {
      return {
        statusCode: 409,
        headers: getHeaders(event.headers.origin),
        body: JSON.stringify({ error: 'Richiesta di recensione gi\u00e0 inviata per questo candidato' }),
      };
    }

    // 4. Generate review link + load full marketing config so social-link
    //    placeholders ({website}, {instagram}, {facebook}, custom links)
    //    si auto-popolano nella stessa call. In passato passavamo solo
    //    {review_link} e qualunque template che usasse {instagram} o un
    //    link personalizzato finiva in WhatsApp con il placeholder letterale.
    const marketing = await getMarketingConfig(supabase);
    const reviewLink = marketing.google_review_link;

    // 5. Load templates based on service_type + channel
    const serviceTypeLabel = candidate.service_type === 'WASH' ? 'lavaggio' : 'noleggio';
    const serviceTypeLabelCap = candidate.service_type === 'WASH' ? 'Lavaggio' : 'Noleggio';
    const firstName = (candidate.customer_name || 'Cliente').split(' ')[0];

    const templateVars: Record<string, string> = {
      customer_name: candidate.customer_name || 'Cliente',
      first_name: firstName,
      review_link: reviewLink,
      website: marketing.website_url || '',
      sito: marketing.website_url || '',
      instagram: marketing.instagram_url || '',
      facebook: marketing.facebook_url || '',
      service_type: serviceTypeLabel,
      Service_type: serviceTypeLabelCap,
      servizio: serviceTypeLabel,
      Servizio: serviceTypeLabelCap,
      vehicle_name: candidate.vehicle_name || candidate.source_details?.vehicle_name || '',
    };

    // Link personalizzati creati in Centralina > Marketing (Social Links).
    // Slug = lowercase del titolo con underscore (stesso del send-whatsapp-notification).
    // Letti direttamente da centralina_pro_config perche' getMarketingConfig
    // espone solo i 4 link standard; i custom non sono tipizzati.
    try {
      const { data: cfgRow } = await supabase.from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle();
      const mk = ((cfgRow?.config || {}) as { marketing?: { custom_links?: Array<{ title?: string; url?: string }> } }).marketing || {};
      if (Array.isArray(mk.custom_links)) {
        for (const l of mk.custom_links) {
          if (typeof l?.title !== 'string' || typeof l?.url !== 'string') continue;
          const slug = l.title.toLowerCase().trim()
            .replace(/[^a-z0-9\s\-_]/g, '')
            .replace(/[\s\-]+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '')
            .substring(0, 30);
          if (slug) templateVars[slug] = l.url;
        }
      }
    } catch {
      // non-blocking: custom links resta vuoto se la lettura fallisce
    }

    let emailSubject = '';
    let emailBody = '';
    let whatsappMessage = '';

    if (needsEmail) {
      // 2026-05-19: review email passa per Messaggi di Sistema Pro
      // (system_messages) come tutti gli altri messaggi. Niente piu'
      // review_templates separato + fallback hardcoded. Il template per
      // l'email recensione e' lo STESSO usato per WhatsApp
      // (review_request_whatsapp), perche' l'utente ha riconfigurato
      // tutto in Messaggi di Sistema Pro come un unico template per
      // servizio. Subject letto dalla prima riga oppure default.
      const fullText = (await getMessageTemplate('review_request_whatsapp', templateVars)) ?? '';
      emailBody = fullText;
      // Subject: prima riga del template se identificata, altrimenti
      // fallback minimo (no leak \u2014 l'admin puo' definirla nel template).
      const firstLine = fullText.split('\n')[0].trim();
      emailSubject = firstLine.length > 0 && firstLine.length <= 120
        ? firstLine
        : 'DR7 \u2014 Lascia la tua recensione';
      if (!emailBody) {
        console.warn('[review-send] template review_request_whatsapp mancante in Messaggi di Sistema Pro \u2014 email skippata');
      }
    }

    if (needsWhatsapp) {
      // WhatsApp body comes EXCLUSIVELY from Messaggi di Sistema Pro.
      // review_request_whatsapp gets routed to the mapped pro_* template by the resolver.
      // The Pro template uses {var} syntax (single braces), which getMessageTemplate substitutes.
      const proVars: Record<string, string> = {
        ...templateVars,
        nome: firstName,
        review_link: reviewLink,
      };
      whatsappMessage = (await getMessageTemplate('review_request_whatsapp', proVars)) || '';
    }

    // 6. Create review_request record with TO_SEND status
    const { data: request, error: insertError } = await supabase
      .from('review_requests')
      .insert({
        candidate_id: candidateId,
        send_channel: sendChannel,
        send_mode: sendMode,
        send_status: 'TO_SEND',
        review_link: reviewLink,
      })
      .select()
      .single();

    if (insertError || !request) {
      console.error('[review-send] Error creating review_request:', insertError);
      return {
        statusCode: 500,
        headers: getHeaders(event.headers.origin),
        body: JSON.stringify({ error: 'Errore nella creazione della richiesta' }),
      };
    }

    // 7. Send messages
    let emailSent = false;
    let whatsappSent = false;
    let emailSentAt: string | null = null;
    let whatsappSentAt: string | null = null;
    const sendErrors: string[] = [];

    // Send EMAIL via Resend
    if (needsEmail && candidate.customer_email) {
      try {
        const resendApiKey = process.env.RESEND_API_KEY;
        if (!resendApiKey) {
          throw new Error('RESEND_API_KEY not configured');
        }

        const resend = new Resend(resendApiKey);
        const { error: resendError } = await resend.emails.send({
          from: 'DR7 Empire <info@dr7.app>',
          to: candidate.customer_email,
          subject: emailSubject || 'Come \u00e8 stata la tua esperienza con DR7?',
          html: emailBody,
        });

        if (resendError) {
          throw new Error(resendError.message);
        }

        emailSent = true;
        emailSentAt = new Date().toISOString();
        console.log(`[review-send] Email sent to ${candidate.customer_email}`);
      } catch (err: any) {
        console.error('[review-send] Email send error:', err);
        sendErrors.push(`Email: ${err.message}`);
      }
    }

    // Send WHATSAPP via Green API
    if (needsWhatsapp && candidate.customer_phone) {
      try {
        if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
          throw new Error('Green API not configured');
        }

        const targetPhone = cleanPhone(candidate.customer_phone);
        const greenApiUrl = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;

        const response = await fetch(greenApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chatId: `${targetPhone}@c.us`,
            message: whatsappMessage,
          }),
        });

        const result = await response.json();

        if (!response.ok || result.error) {
          throw new Error(result.error || 'Green API error');
        }

        whatsappSent = true;
        whatsappSentAt = new Date().toISOString();
        console.log(`[review-send] WhatsApp sent to ${targetPhone}, messageId: ${result.idMessage}`);

        // Log to sent_messages_log
        try {
          const fullMessage = whatsappMessage;
          await supabase.from('sent_messages_log').insert({
            customer_name: candidate.customer_name || 'N/A',
            customer_phone: candidate.customer_phone,
            message_text: fullMessage,
            template_label: 'Review Notification (WhatsApp)',
            status: 'sent',
          });
        } catch (logErr) {
          console.error('Failed to log message:', logErr);
        }
      } catch (err: any) {
        console.error('[review-send] WhatsApp send error:', err);
        sendErrors.push(`WhatsApp: ${err.message}`);
      }
    }

    // 8. Determine final send_status
    const anySucceeded = emailSent || whatsappSent;
    const allFailed = !emailSent && needsEmail && !whatsappSent && needsWhatsapp;
    const finalStatus = allFailed ? 'FAILED' : anySucceeded ? 'SENT' : 'FAILED';

    // Update review_request
    const { error: updateRequestError } = await supabase
      .from('review_requests')
      .update({
        email_sent: emailSent,
        whatsapp_sent: whatsappSent,
        email_sent_at: emailSentAt,
        whatsapp_sent_at: whatsappSentAt,
        send_status: finalStatus,
        error_message: sendErrors.length > 0 ? sendErrors.join('; ') : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', request.id);

    if (updateRequestError) {
      console.error('[review-send] Error updating review_request:', updateRequestError);
    }

    // 9. Update candidate send_status
    const { error: updateCandidateError } = await supabase
      .from('review_candidates')
      .update({
        send_status: finalStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', candidateId);

    if (updateCandidateError) {
      console.error('[review-send] Error updating candidate:', updateCandidateError);
    }

    // 10. Create audit log
    await supabase.from('review_audit_logs').insert({
      candidate_id: candidateId,
      review_request_id: request.id,
      action: finalStatus === 'SENT' ? 'MANUAL_SEND_TRIGGERED' : 'SEND_FAILED',
      details: {
        send_channel: sendChannel,
        send_mode: sendMode,
        email_sent: emailSent,
        whatsapp_sent: whatsappSent,
        errors: sendErrors.length > 0 ? sendErrors : undefined,
        final_status: finalStatus,
      },
      created_at: new Date().toISOString(),
    });

    // Re-fetch updated request
    const { data: updatedRequest } = await supabase
      .from('review_requests')
      .select('*')
      .eq('id', request.id)
      .single();

    return {
      statusCode: 200,
      headers: getHeaders(event.headers.origin),
      body: JSON.stringify({
        success: anySucceeded,
        request: updatedRequest || request,
        errors: sendErrors.length > 0 ? sendErrors : undefined,
      }),
    };
  } catch (error: any) {
    console.error('[review-send] Fatal error:', error);
    return {
      statusCode: 500,
      headers: getHeaders(event.headers.origin),
      body: JSON.stringify({ error: error.message }),
    };
  }
};

export { handler };
