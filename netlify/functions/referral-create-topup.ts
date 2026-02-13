import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const NEXI_API_KEY = process.env.NEXI_API_KEY!;
const NEXI_BASE_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1';

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
    const { participant_id, amount } = JSON.parse(event.body || '{}');

    if (!participant_id || !amount || amount <= 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'participant_id e importo valido obbligatori' }),
      };
    }

    if (!NEXI_API_KEY) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Configurazione Nexi mancante' }),
      };
    }

    // Verify participant exists and is active
    const { data: participant } = await supabase
      .from('referral_participants')
      .select('id, nome, cognome, email, status')
      .eq('id', participant_id)
      .single();

    if (!participant) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Partecipante non trovato' }),
      };
    }

    if (participant.status !== 'active') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Account sospeso o bannato' }),
      };
    }

    const amountCents = Math.round(amount * 100);
    const orderId = `WALLET-${participant_id.slice(0, 8)}-${Date.now()}`;

    // Create topup record
    const { data: topup, error: topupError } = await supabase
      .from('wallet_topups')
      .insert({
        participant_id,
        amount_cents: amountCents,
        nexi_order_id: orderId,
        status: 'pending',
      })
      .select('id')
      .single();

    if (topupError || !topup) {
      console.error('Error creating topup:', topupError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Errore nella creazione della ricarica' }),
      };
    }

    // Create Nexi payment link
    const payload = {
      order: {
        orderId,
        amount: amountCents.toString(),
        currency: 'EUR',
        description: `Ricarica Wallet DR7 - €${amount.toFixed(2)}`,
        customerInfo: {
          cardHolderEmail: participant.email || '',
          cardHolderName: `${participant.nome} ${participant.cognome}`,
        },
      },
      paymentSession: {
        actionType: 'PAY',
        amount: amountCents.toString(),
        language: 'ita',
        resultUrl: `${process.env.URL || 'https://dr7admin.netlify.app'}/referral?topup=success&order=${orderId}`,
        cancelUrl: `${process.env.URL || 'https://dr7admin.netlify.app'}/referral?topup=cancelled&order=${orderId}`,
        notificationUrl: `${process.env.URL || 'https://dr7admin.netlify.app'}/.netlify/functions/referral-topup-callback`,
      },
    };

    const response = await fetch(`${NEXI_BASE_URL}/orders/build`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': NEXI_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    let responseData: any;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: `Errore Nexi: ${responseText.substring(0, 200)}` }),
      };
    }

    if (!response.ok) {
      console.error('Nexi error:', responseData);
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: responseData.errors?.[0]?.description || 'Errore creazione link di pagamento' }),
      };
    }

    const paymentUrl = responseData.hostedPage;

    // Update topup with payment link
    await supabase
      .from('wallet_topups')
      .update({
        payment_link: paymentUrl,
        metadata: { nexi_response: responseData },
      })
      .eq('id', topup.id);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        paymentUrl,
        orderId,
        topup_id: topup.id,
      }),
    };
  } catch (error: any) {
    console.error('Error in referral-create-topup:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

export { handler };
