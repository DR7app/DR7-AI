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

        // For each customer, check if they have a wallet
        const customerIds = (customers || []).map(c => c.id);
        const { data: wallets } = await supabase
          .from('customer_wallets')
          .select('customer_id, balance_cents')
          .in('customer_id', customerIds.length > 0 ? customerIds : ['none']);

        const walletMap = new Map<string, number>();
        (wallets || []).forEach((w: any) => {
          walletMap.set(w.customer_id, w.balance_cents);
        });

        const results = (customers || []).map((c: any) => {
          const fullName = c.tipo_cliente === 'persona_fisica'
            ? `${c.nome || ''} ${c.cognome || ''}`.trim()
            : (c.ragione_sociale || c.denominazione || 'Cliente');
          return {
            id: c.id,
            full_name: fullName || 'Cliente',
            email: c.email,
            phone: c.telefono,
            balance_cents: walletMap.get(c.id) ?? null,
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

        // Get or create wallet
        let { data: wallet } = await supabase
          .from('customer_wallets')
          .select('*')
          .eq('customer_id', customer_id)
          .single();

        if (!wallet && isCredit) {
          // Auto-create wallet on first credit
          const { data: newWallet, error: createError } = await supabase
            .from('customer_wallets')
            .insert({
              customer_id,
              balance_cents: 0,
              total_earned_cents: 0,
              total_spent_cents: 0,
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
        const { error: txnError } = await supabase.from('customer_wallet_transactions').insert({
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
          .from('customer_wallets')
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

        const { data: wallet } = await supabase
          .from('customer_wallets')
          .select('*')
          .eq('customer_id', customer_id)
          .single();

        if (!wallet) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, wallet: null, transactions: [] }),
          };
        }

        const { data: transactions } = await supabase
          .from('customer_wallet_transactions')
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
