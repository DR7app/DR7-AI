import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const REGISTRATION_WALLET_BONUS_CENTS = 1500; // €15 wallet credit
const REGISTRATION_BUONO_CENTS = 5000; // €50 buono sconto
const BUONO_VALIDITY_DAYS = 365; // 1 year

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateBuonoCode(): string {
  let code = 'BUONO-';
  for (let i = 0; i < 8; i++) {
    if (i === 4) code += '-';
    code += CHARSET[Math.floor(Math.random() * CHARSET.length)];
  }
  return code;
}

async function createBuonoSconto(participantId: string, amountCents: number, reason: 'registration' | 'friend_topup' | 'milestone') {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + BUONO_VALIDITY_DAYS);

  // Try up to 5 times to generate a unique code
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateBuonoCode();
    const { data, error } = await supabase
      .from('referral_discount_codes')
      .insert({
        participant_id: participantId,
        code,
        amount_cents: amountCents,
        reason,
        scope: ['noleggio', 'supercar'],
        expires_at: expiresAt.toISOString(),
      })
      .select('code')
      .single();

    if (!error && data) return data.code;
    if (error && !error.message.includes('unique')) throw error;
  }
  throw new Error('Failed to generate unique buono code');
}

function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-\+\(\)]/g, '');
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
    const { nome, cognome, telefono, email, referralCode, fingerprint } = JSON.parse(event.body || '{}');

    if (!nome || !cognome || !telefono) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Nome, cognome e telefono obbligatori' }),
      };
    }

    const normalizedPhone = normalizePhone(telefono);
    const clientIp = event.headers['x-forwarded-for']?.split(',')[0]?.trim() || event.headers['client-ip'] || '';

    // Verify OTP was completed for this phone
    const { data: verifiedOtp } = await supabase
      .from('otp_codes')
      .select('id')
      .eq('telefono', normalizedPhone)
      .eq('verified', true)
      .gte('expires_at', new Date(Date.now() - 10 * 60 * 1000).toISOString()) // within last 10 min
      .limit(1)
      .single();

    if (!verifiedOtp) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Verifica OTP non completata. Riprova.' }),
      };
    }

    // Check if phone already registered
    const { data: existing } = await supabase
      .from('referral_participants')
      .select('id, referral_code')
      .eq('telefono', normalizedPhone)
      .single();

    if (existing) {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({
          error: 'Questo numero è già registrato',
          referral_code: existing.referral_code,
          participant_id: existing.id,
        }),
      };
    }

    // Fraud: max 5 registrations per IP per 24h
    if (clientIp) {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from('referral_participants')
        .select('*', { count: 'exact', head: true })
        .eq('registration_ip', clientIp)
        .gte('created_at', twentyFourHoursAgo);

      if ((count || 0) >= 5) {
        return {
          statusCode: 429,
          headers,
          body: JSON.stringify({ error: 'Troppe registrazioni. Riprova domani.' }),
        };
      }
    }

    // Resolve referrer
    let referredById: string | null = null;
    if (referralCode) {
      const { data: referrer } = await supabase
        .from('referral_participants')
        .select('id, telefono, status')
        .eq('referral_code', referralCode.toUpperCase().trim())
        .single();

      if (referrer) {
        // No self-referral
        if (referrer.telefono === normalizedPhone) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Non puoi usare il tuo stesso codice referral' }),
          };
        }
        if (referrer.status === 'active') {
          referredById = referrer.id;
        }
      }
    }

    // Create participant
    const { data: participant, error: createError } = await supabase
      .from('referral_participants')
      .insert({
        nome,
        cognome,
        telefono: normalizedPhone,
        email: email || null,
        referred_by: referredById,
        phone_verified: true,
        registration_ip: clientIp || null,
        device_fingerprint: fingerprint || null,
      })
      .select('id, referral_code')
      .single();

    if (createError || !participant) {
      console.error('Error creating participant:', createError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Errore nella registrazione' }),
      };
    }

    // Create wallet
    const { data: wallet, error: walletError } = await supabase
      .from('wallets')
      .insert({ participant_id: participant.id })
      .select('id')
      .single();

    if (walletError || !wallet) {
      console.error('Error creating wallet:', walletError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Errore nella creazione del wallet' }),
      };
    }

    // Credit registration wallet bonus (€15)
    const newBalance = REGISTRATION_WALLET_BONUS_CENTS;
    await supabase.from('wallet_transactions').insert({
      wallet_id: wallet.id,
      type: 'registration_bonus',
      amount_cents: REGISTRATION_WALLET_BONUS_CENTS,
      balance_after_cents: newBalance,
      description: 'Bonus di benvenuto: €15 credito wallet',
    });

    await supabase
      .from('wallets')
      .update({
        balance_cents: newBalance,
        total_earned_cents: REGISTRATION_WALLET_BONUS_CENTS,
        updated_at: new Date().toISOString(),
      })
      .eq('id', wallet.id);

    // Generate buono sconto €50 (monouso, solo noleggio/supercar)
    let buonoCode: string | null = null;
    try {
      buonoCode = await createBuonoSconto(participant.id, REGISTRATION_BUONO_CENTS, 'registration');
    } catch (err) {
      console.error('Error creating registration buono:', err);
    }

    // Check milestone for referrer (if this new user was referred)
    if (referredById) {
      await checkMilestone(referredById);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        participant_id: participant.id,
        referral_code: participant.referral_code,
        balance_cents: newBalance,
        buono_code: buonoCode,
        buono_amount: REGISTRATION_BUONO_CENTS / 100,
      }),
    };
  } catch (error: any) {
    console.error('Error in referral-register:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

async function checkMilestone(referrerId: string) {
  try {
    // Count total referrals (just registered, not necessarily topped up - milestones are based on qualifying friends)
    // Actually per plan, milestone is for every 10 qualifying referrals (those who topped up ≥€100)
    // We'll check this but the milestone only triggers when a topup happens,
    // so here we just track the referral count for future use
    // The actual milestone check happens in the topup callback
  } catch (err) {
    console.error('Error checking milestone:', err);
  }
}

export { handler };
