import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
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
    const authHeader = event.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Non autorizzato' }) };
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token non valido' }) };
    }

    const { action, customer_id, amount, description, query } = JSON.parse(event.body || '{}');

    switch (action) {
      case 'list_all_balances': {
        // Return all user_credit_balance records (service role bypasses RLS)
        const serviceSupabase = createClient(
          process.env.VITE_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
        const { data: balances, error: balErr } = await serviceSupabase
          .from('user_credit_balance')
          .select('user_id, balance');
        if (balErr) throw balErr;
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, balances: balances || [] })
        };
      }
      case 'search': {
        if (!query || query.trim().length < 2) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Inserisci almeno 2 caratteri per la ricerca' }),
          };
        }

        const searchTerm = query.trim().toLowerCase();

        const { data: customers, error: searchError } = await supabase
          .from('customers_extended')
          .select('id, nome, cognome, email, telefono, ragione_sociale, denominazione, tipo_cliente')
          .or(`email.ilike.%${searchTerm}%,nome.ilike.%${searchTerm}%,cognome.ilike.%${searchTerm}%,ragione_sociale.ilike.%${searchTerm}%,denominazione.ilike.%${searchTerm}%,telefono.ilike.%${searchTerm}%`)
          .limit(20);

        if (searchError) throw searchError;

        // Get wallet balances by matching customer phone → referral_participants.telefono → wallets
        const phones = (customers || []).map(c => c.telefono).filter(Boolean);
        let walletMap = new Map<string, number>();

        if (phones.length > 0) {
          const { data: participants } = await supabase
            .from('referral_participants')
            .select('id, telefono')
            .in('telefono', phones);

          if (participants && participants.length > 0) {
            const participantIds = participants.map(p => p.id);
            const { data: wallets } = await supabase
              .from('wallets')
              .select('participant_id, balance_cents')
              .in('participant_id', participantIds);

            // Build phone → balance map
            const participantPhoneMap = new Map<string, string>();
            participants.forEach((p: any) => participantPhoneMap.set(p.id, p.telefono));

            (wallets || []).forEach((w: any) => {
              const phone = participantPhoneMap.get(w.participant_id);
              if (phone) walletMap.set(phone, w.balance_cents);
            });
          }
        }

        const results = (customers || []).map((c: any) => {
          const fullName = c.tipo_cliente === 'persona_fisica'
            ? `${c.nome || ''} ${c.cognome || ''}`.trim()
            : (c.ragione_sociale || c.denominazione || 'Cliente');
          return {
            id: c.id,
            full_name: fullName || 'Cliente',
            email: c.email,
            phone: c.telefono,
            balance_cents: walletMap.get(c.telefono) ?? null,
          };
        });

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, customers: results }),
        };
      }

      case 'credit':
      case 'debit': {
        if (!customer_id || !amount || amount <= 0) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'customer_id e importo obbligatori' }),
          };
        }

        const amountCents = Math.round(amount * 100);
        const isCredit = action === 'credit';

        // Find customer phone
        const { data: customer } = await supabase
          .from('customers_extended')
          .select('telefono')
          .eq('id', customer_id)
          .single();

        if (!customer?.telefono) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Cliente non ha un numero di telefono' }),
          };
        }

        // Find referral participant by phone
        let { data: participant } = await supabase
          .from('referral_participants')
          .select('id')
          .eq('telefono', customer.telefono)
          .single();

        // Auto-create participant if crediting and doesn't exist
        if (!participant && isCredit) {
          const { data: custInfo } = await supabase
            .from('customers_extended')
            .select('nome, cognome, email, telefono')
            .eq('id', customer_id)
            .single();

          if (custInfo) {
            const { data: newParticipant, error: createParticipantError } = await supabase
              .from('referral_participants')
              .insert({
                nome: custInfo.nome || 'Cliente',
                cognome: custInfo.cognome || '',
                telefono: custInfo.telefono,
                email: custInfo.email,
                phone_verified: true,
              })
              .select()
              .single();

            if (createParticipantError) throw createParticipantError;
            participant = newParticipant;
          }
        }

        if (!participant) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Partecipante referral non trovato. Effettua prima un credito.' }),
          };
        }

        // Get or create wallet
        let { data: wallet } = await supabase
          .from('wallets')
          .select('*')
          .eq('participant_id', participant.id)
          .single();

        if (!wallet && isCredit) {
          const { data: newWallet, error: createError } = await supabase
            .from('wallets')
            .insert({
              participant_id: participant.id,
              balance_cents: 0,
              total_earned_cents: 0,
              total_spent_cents: 0,
              total_topped_up_cents: 0,
            })
            .select()
            .single();

          if (createError) throw createError;
          wallet = newWallet;
        }

        if (!wallet) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Wallet non trovato. Effettua prima un credito.' }),
          };
        }

        const signedAmount = isCredit ? amountCents : -amountCents;
        const newBalance = wallet.balance_cents + signedAmount;

        if (newBalance < 0) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Saldo insufficiente per questo addebito' }),
          };
        }

        // Insert transaction
        const { error: txnError } = await supabase.from('wallet_transactions').insert({
          wallet_id: wallet.id,
          type: isCredit ? 'manual_credit' : 'manual_debit',
          amount_cents: signedAmount,
          balance_after_cents: newBalance,
          description: description || (isCredit ? 'Credito manuale admin' : 'Addebito manuale admin'),
          admin_user_id: user.id,
        });

        if (txnError) throw txnError;

        // Update wallet balance
        const updateData: any = {
          balance_cents: newBalance,
          updated_at: new Date().toISOString(),
        };
        if (isCredit) {
          updateData.total_earned_cents = wallet.total_earned_cents + amountCents;
        } else {
          updateData.total_spent_cents = wallet.total_spent_cents + amountCents;
        }

        const { error: updateError } = await supabase
          .from('wallets')
          .update(updateData)
          .eq('id', wallet.id);

        if (updateError) throw updateError;

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, new_balance_cents: newBalance }),
        };
      }

      case 'transactions': {
        if (!customer_id) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'customer_id obbligatorio' }),
          };
        }

        // Find customer phone → participant → wallet
        const { data: customer } = await supabase
          .from('customers_extended')
          .select('telefono')
          .eq('id', customer_id)
          .single();

        if (!customer?.telefono) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, wallet: null, transactions: [] }),
          };
        }

        const { data: participant } = await supabase
          .from('referral_participants')
          .select('id')
          .eq('telefono', customer.telefono)
          .single();

        if (!participant) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, wallet: null, transactions: [] }),
          };
        }

        const { data: wallet } = await supabase
          .from('wallets')
          .select('*')
          .eq('participant_id', participant.id)
          .single();

        if (!wallet) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, wallet: null, transactions: [] }),
          };
        }

        const { data: transactions } = await supabase
          .from('wallet_transactions')
          .select('*')
          .eq('wallet_id', wallet.id)
          .order('created_at', { ascending: false })
          .limit(50);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, wallet, transactions: transactions || [] }),
        };
      }

      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: `Azione non valida: ${action}` }),
        };
    }
  } catch (error: any) {
    console.error('Error in customer-wallet-admin:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

export { handler };
