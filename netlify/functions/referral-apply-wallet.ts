import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  }

  try {
    const { participant_id, amount_cents, booking_id, description } = JSON.parse(event.body || '{}');

    if (!participant_id || !amount_cents || amount_cents <= 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'participant_id e amount_cents obbligatori' }),
      };
    }

    // Check participant is active
    const { data: participant } = await supabase
      .from('referral_participants')
      .select('id, status')
      .eq('id', participant_id)
      .single();

    if (!participant) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Partecipante non trovato' }) };
    }

    if (participant.status !== 'active') {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Account sospeso o bannato' }) };
    }

    // Use SELECT FOR UPDATE via RPC or manual lock pattern
    // Since Supabase JS doesn't support FOR UPDATE directly, we use a transaction-like approach
    const { data: wallet } = await supabase
      .from('wallets')
      .select('*')
      .eq('participant_id', participant_id)
      .single();

    if (!wallet) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Wallet non trovato' }) };
    }

    if (wallet.balance_cents < amount_cents) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Saldo insufficiente',
          balance_cents: wallet.balance_cents,
          requested_cents: amount_cents,
        }),
      };
    }

    const newBalance = wallet.balance_cents - amount_cents;

    // Debit wallet - use conditional update to prevent race conditions
    const { data: updated, error: updateError } = await supabase
      .from('wallets')
      .update({
        balance_cents: newBalance,
        total_spent_cents: wallet.total_spent_cents + amount_cents,
        updated_at: new Date().toISOString(),
      })
      .eq('id', wallet.id)
      .gte('balance_cents', amount_cents) // Only succeeds if balance still sufficient
      .select('id')
      .single();

    if (updateError || !updated) {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({ error: 'Saldo cambiato. Riprova.' }),
      };
    }

    // Record transaction
    const { data: txn } = await supabase
      .from('wallet_transactions')
      .insert({
        wallet_id: wallet.id,
        type: 'booking_payment',
        amount_cents: -amount_cents,
        balance_after_cents: newBalance,
        description: description || `Pagamento prenotazione${booking_id ? ` #${booking_id.slice(0, 8)}` : ''}`,
        metadata: { booking_id },
      })
      .select('id')
      .single();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        transaction_id: txn?.id,
        new_balance_cents: newBalance,
        amount_debited_cents: amount_cents,
      }),
    };
  } catch (error: any) {
    console.error('Error in referral-apply-wallet:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

export { handler };
