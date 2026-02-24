import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-\+\(\)]/g, '');
  if (cleaned.startsWith('00')) cleaned = cleaned.substring(2);
  if (cleaned.length === 10) cleaned = '39' + cleaned;
  return cleaned;
}

const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
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
    const { telefono, code } = JSON.parse(event.body || '{}');

    if (!telefono || !code) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Telefono e codice obbligatori' }),
      };
    }

    const normalizedPhone = normalizePhone(telefono);

    // Find the latest non-expired, non-verified OTP for this phone
    const { data: otpRecord, error: fetchError } = await supabase
      .from('otp_codes')
      .select('*')
      .eq('telefono', normalizedPhone)
      .eq('verified', false)
      .gte('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (fetchError || !otpRecord) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Codice scaduto o non trovato. Richiedi un nuovo codice.' }),
      };
    }

    // Check max attempts
    if (otpRecord.attempts >= 5) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({ error: 'Troppi tentativi errati. Richiedi un nuovo codice.' }),
      };
    }

    // Increment attempts
    await supabase
      .from('otp_codes')
      .update({ attempts: otpRecord.attempts + 1 })
      .eq('id', otpRecord.id);

    // Verify code
    if (otpRecord.code !== code.trim()) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Codice errato',
          attemptsRemaining: 4 - otpRecord.attempts,
        }),
      };
    }

    // Mark as verified
    await supabase
      .from('otp_codes')
      .update({ verified: true })
      .eq('id', otpRecord.id);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, verified: true }),
    };
  } catch (error: any) {
    console.error('Error in referral-verify-otp:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

export { handler };
