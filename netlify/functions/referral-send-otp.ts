import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { renderTemplate } from './utils/messageTemplates';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;

function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('00')) cleaned = cleaned.substring(2);
  if (cleaned.length === 10) cleaned = '39' + cleaned;
  return cleaned;
}

const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  }

  try {
    const { telefono } = JSON.parse(event.body || '{}');

    if (!telefono) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Numero di telefono obbligatorio' }),
      };
    }

    const normalizedPhone = normalizePhone(telefono);

    // Rate limit: max 3 OTP per phone per 15 minutes
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from('otp_codes')
      .select('*', { count: 'exact', head: true })
      .eq('telefono', normalizedPhone)
      .gte('created_at', fifteenMinAgo);

    if ((count || 0) >= 3) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({ error: 'Troppi tentativi. Riprova tra qualche minuto.' }),
      };
    }

    // Generate 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min

    // Save OTP
    const { error: otpError } = await supabase.from('otp_codes').insert({
      telefono: normalizedPhone,
      code,
      expires_at: expiresAt,
    });

    if (otpError) {
      console.error('Error saving OTP:', otpError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Errore nel salvataggio OTP' }),
      };
    }

    // Send via WhatsApp Green API
    if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
      console.error('Green API not configured');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Servizio WhatsApp non configurato' }),
      };
    }

    const message = await renderTemplate('referral_otp_whatsapp', { code });
    if (!message) {
      console.error('[referral-send-otp] Pro template referral_otp_whatsapp missing/disabled');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Template OTP non configurato in Messaggi di Sistema Pro' }),
      };
    }

    const greenApiUrl = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;

    const response = await fetch(greenApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId: `${normalizedPhone}@c.us`,
        message: message,
      }),
    });

    const result = await response.json();

    if (!response.ok || result.error) {
      console.error('Green API error:', result);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Errore nell\'invio del messaggio WhatsApp' }),
      };
    }

    console.log('✅ OTP sent to', normalizedPhone);

    // Log to sent_messages_log
    try {
      const fullMessage = message;
      await supabase.from('sent_messages_log').insert({
        customer_name: 'N/A',
        customer_phone: normalizedPhone,
        message_text: fullMessage,
        template_label: 'Referral OTP',
        status: 'sent',
      });
    } catch (logErr) {
      console.error('Failed to log message:', logErr);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: 'Codice OTP inviato via WhatsApp' }),
    };
  } catch (error: any) {
    console.error('Error in referral-send-otp:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

export { handler };
