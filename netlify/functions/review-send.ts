import { getCorsOrigin } from './cors-headers'
import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
const GOOGLE_REVIEW_URL = process.env.GOOGLE_REVIEW_URL || 'https://g.page/r/CQwgJt7OYpsfEBM/review';

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
    const needsEmail = sendChannel === 'EMAIL_ONLY' || sendChannel === 'EMAIL_AND_WHATSAPP';
    const needsWhatsapp = sendChannel === 'WHATSAPP_ONLY' || sendChannel === 'EMAIL_AND_WHATSAPP';

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

    // 4. Generate review link
    const reviewLink = GOOGLE_REVIEW_URL;

    // 5. Load templates based on service_type + channel
    const serviceTypeLabel = candidate.service_type === 'WASH' ? 'lavaggio' : 'noleggio';
    const serviceTypeLabelCap = candidate.service_type === 'WASH' ? 'Lavaggio' : 'Noleggio';
    const firstName = (candidate.customer_name || 'Cliente').split(' ')[0];

    const templateVars: Record<string, string> = {
      customer_name: candidate.customer_name || 'Cliente',
      first_name: firstName,
      review_link: reviewLink,
      service_type: serviceTypeLabel,
      Service_type: serviceTypeLabelCap,
      servizio: serviceTypeLabel,
      Servizio: serviceTypeLabelCap,
      vehicle_name: candidate.vehicle_name || candidate.source_details?.vehicle_name || '',
    };

    let emailSubject = '';
    let emailBody = '';
    let whatsappMessage = '';

    if (needsEmail) {
      const templateKey = `${candidate.service_type}_EMAIL`; // e.g. RENTAL_EMAIL, WASH_EMAIL
      const { data: emailTemplate } = await supabase
        .from('review_templates')
        .select('*')
        .eq('template_key', templateKey)
        .single();

      if (emailTemplate) {
        emailSubject = renderTemplate(emailTemplate.subject || '', templateVars);
        emailBody = renderTemplate(emailTemplate.body || '', templateVars);
      } else {
        // Fallback default email template
        emailSubject = 'Come \u00e8 stata la tua esperienza con DR7?';
        emailBody = `<div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #111; color: #fff; padding: 0;">
          <div style="padding: 40px 20px; text-align: center;">
            <p style="color: #ccc; font-size: 16px; line-height: 1.6; margin-bottom: 30px;">
              Ciao ${templateVars.customer_name},
            </p>
            <p style="color: #ccc; font-size: 16px; line-height: 1.6; margin-bottom: 30px;">
              La tua esperienza con noi \u00e8 importante. Se ti fa piacere, lascia una recensione a 5 stelle raccontando il tuo Servizio ricevuto.
            </p>
            <p style="color: #ccc; font-size: 16px; line-height: 1.6; margin-bottom: 30px;">
              In segno di gratitudine, inviandoci uno screenshot della recensione riceverai subito un buono sconto da 100\u20ac sul tuo prossimo noleggio e uno da 10\u20ac sul tuo prossimo lavaggio.
            </p>
            <a href="${reviewLink}"
               style="display: inline-block; background-color: #D4AF37; color: #000; padding: 15px 30px; text-decoration: none; font-weight: bold; border-radius: 5px; font-size: 16px; margin: 10px 0;">
              LASCIA UNA RECENSIONE
            </a>
          </div>
        </div>`;
      }
    }

    if (needsWhatsapp) {
      const waTemplateKey = `${candidate.service_type}_WHATSAPP`; // e.g. RENTAL_WHATSAPP, WASH_WHATSAPP
      const { data: whatsappTemplate } = await supabase
        .from('review_templates')
        .select('*')
        .eq('template_key', waTemplateKey)
        .single();

      if (whatsappTemplate) {
        whatsappMessage = renderTemplate(whatsappTemplate.body || '', templateVars);
      } else {
        // Fallback default WhatsApp template
        const custName = candidate.customer_name || 'Cliente';
        whatsappMessage = `Ciao ${custName}! 👋\nLa tua esperienza con noi è importante.\n\nSe ti fa piacere, lascia una recensione a 5 stelle raccontando il tuo Servizio ricevuto, è il modo migliore per crescere insieme.\n\nIn segno di gratitudine, inviandoci uno screenshot della recensione riceverai subito un codice sconto da 100€ sul tuo prossimo noleggio e uno da 10€ sul tuo prossimo lavaggio utilizzabile sul sito.\n\nClicca qui per lasciarla!👇🏻\n ${reviewLink}\n\n\nDR7`;
      }
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
            message: `*MESSAGGIO AUTOMATICO GENERATO DA RENTORA*\n_Questo messaggio \u00e8 stato inviato tramite il sistema automatizzato sviluppato da Rentora._\n\n${whatsappMessage}\n\n_Se questo messaggio non era destinato a lei, oppure lo ha gi\u00e0 ricevuto in precedenza, pu\u00f2 semplicemente ignorarlo._`,
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
          const fullMessage = `*MESSAGGIO AUTOMATICO GENERATO DA RENTORA*\n_Questo messaggio è stato inviato tramite il sistema automatizzato sviluppato da Rentora._\n\n${whatsappMessage}\n\n_Se questo messaggio non era destinato a lei, oppure lo ha già ricevuto in precedenza, può semplicemente ignorarlo._`;
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
