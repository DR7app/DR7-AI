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
    const authHeader = event.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Non autorizzato' }) };
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token non valido' }) };
    }

    const { action, customer_id, user_id, amount, description, query } = JSON.parse(event.body || '{}');

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
      case 'credit_transactions': {
        // Return transactions from BOTH systems (credit_transactions + wallet_transactions)
        const svc = createClient(
          process.env.VITE_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        // Find user_id and phone
        let userId = user_id;
        let custPhone = '';
        if (customer_id) {
          const { data: cust } = await svc
            .from('customers_extended')
            .select('user_id, telefono')
            .eq('id', customer_id)
            .maybeSingle();
          if (cust) {
            userId = userId || cust.user_id;
            custPhone = cust.telefono || '';
          }
        }

        const allTxns: any[] = [];

        // 1. Website credit_transactions (by user_id)
        if (userId) {
          const { data: txns } = await svc
            .from('credit_transactions')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(50);
          if (txns) {
            txns.forEach(t => allTxns.push({
              ...t,
              source: 'credit_transactions'
            }));
          }
        }

        // 2. Referral wallet_transactions (by phone → participant → wallet)
        if (custPhone) {
          // Try multiple phone formats
          let cleanPhone = custPhone.replace(/[\s\-\+\(\)]/g, '')
          const phoneVariants = [cleanPhone]
          if (cleanPhone.startsWith('39') && cleanPhone.length === 12) phoneVariants.push(cleanPhone.substring(2))
          if (!cleanPhone.startsWith('39') && cleanPhone.length === 10) phoneVariants.push('39' + cleanPhone)
          phoneVariants.push('+39' + cleanPhone.replace(/^39/, ''))

          let participant: any = null
          for (const pv of phoneVariants) {
            const { data: p } = await svc
              .from('referral_participants')
              .select('id')
              .eq('telefono', pv)
              .maybeSingle()
            if (p) { participant = p; break }
          }

          if (participant) {
            const { data: wallet } = await svc
              .from('wallets')
              .select('id')
              .eq('participant_id', participant.id)
              .maybeSingle();

            if (wallet) {
              const { data: wTxns } = await svc
                .from('wallet_transactions')
                .select('*')
                .eq('wallet_id', wallet.id)
                .order('created_at', { ascending: false })
                .limit(50);

              if (wTxns) {
                wTxns.forEach(t => allTxns.push({
                  id: t.id,
                  user_id: userId,
                  transaction_type: t.amount_cents >= 0 ? 'credit' : 'debit',
                  amount: Math.abs(t.amount_cents) / 100,
                  balance_after: t.balance_after_cents / 100,
                  description: t.description || t.type || '-',
                  created_at: t.created_at,
                  source: 'wallet_transactions'
                }));
              }
            }
          }
        }

        // Sort by date descending and deduplicate
        allTxns.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, transactions: allTxns.slice(0, 50) })
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

        const amountEur = amount;
        const isCredit = action === 'credit';

        // Use service role for user_credit_balance (bypasses RLS)
        const serviceSupabase = createClient(
          process.env.VITE_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        // Find customer's user_id
        const { data: customer } = await serviceSupabase
          .from('customers_extended')
          .select('user_id, email, telefono')
          .eq('id', customer_id)
          .single();

        const userId = customer?.user_id;
        if (!userId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Cliente non ha un account website (user_id mancante). Credito non applicabile.' }),
          };
        }

        // Get or create credit balance
        let { data: creditBalance } = await serviceSupabase
          .from('user_credit_balance')
          .select('user_id, balance')
          .eq('user_id', userId)
          .maybeSingle();

        const currentBalance = creditBalance?.balance ? parseFloat(creditBalance.balance) : 0;
        const newBalance = isCredit
          ? Math.round((currentBalance + amountEur) * 100) / 100
          : Math.round((currentBalance - amountEur) * 100) / 100;

        if (newBalance < 0) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Saldo insufficiente per questo addebito' }),
          };
        }

        if (!creditBalance) {
          await serviceSupabase.from('user_credit_balance').insert({
            user_id: userId,
            balance: newBalance,
            last_updated: new Date().toISOString()
          });
        } else {
          await serviceSupabase.from('user_credit_balance').update({
            balance: newBalance,
            last_updated: new Date().toISOString()
          }).eq('user_id', userId);
        }

        // Record transaction
        await serviceSupabase.from('credit_transactions').insert({
          user_id: userId,
          transaction_type: isCredit ? 'credit' : 'debit',
          amount: amountEur,
          balance_after: newBalance,
          description: description || (isCredit ? 'Credito manuale admin' : 'Addebito manuale admin'),
          reference_type: 'admin_manual'
        });

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, new_balance_cents: Math.round(newBalance * 100) }),
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
