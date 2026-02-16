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
    // Verify admin JWT
    const authHeader = event.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Non autorizzato' }) };
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token non valido' }) };
    }

    const { action, participant_id, amount, notes } = JSON.parse(event.body || '{}');

    switch (action) {
      case 'stats': {
        const { data: stats } = await supabase
          .from('referral_program_stats')
          .select('*')
          .single();

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, stats }),
        };
      }

      case 'credit':
      case 'debit': {
        if (!participant_id || !amount || amount <= 0) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'participant_id, importo e note obbligatori' }),
          };
        }

        const { data: wallet } = await supabase
          .from('wallets')
          .select('*')
          .eq('participant_id', participant_id)
          .single();

        if (!wallet) {
          return { statusCode: 404, headers, body: JSON.stringify({ error: 'Wallet non trovato' }) };
        }

        const amountCents = Math.round(amount * 100);
        const isCredit = action === 'credit';
        const signedAmount = isCredit ? amountCents : -amountCents;
        const newBalance = wallet.balance_cents + signedAmount;

        if (newBalance < 0) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Saldo insufficiente per questo addebito' }),
          };
        }

        await supabase.from('wallet_transactions').insert({
          wallet_id: wallet.id,
          type: isCredit ? 'manual_credit' : 'manual_debit',
          amount_cents: signedAmount,
          balance_after_cents: newBalance,
          description: notes || (isCredit ? 'Credito manuale admin' : 'Addebito manuale admin'),
          admin_user_id: user.id,
          metadata: { admin_email: user.email, notes },
        });

        const updateData: any = {
          balance_cents: newBalance,
          updated_at: new Date().toISOString(),
        };
        if (isCredit) {
          updateData.total_earned_cents = wallet.total_earned_cents + amountCents;
        } else {
          updateData.total_spent_cents = wallet.total_spent_cents + amountCents;
        }

        await supabase.from('wallets').update(updateData).eq('id', wallet.id);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, new_balance_cents: newBalance }),
        };
      }

      case 'suspend':
      case 'ban':
      case 'activate': {
        if (!participant_id) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'participant_id obbligatorio' }) };
        }

        const statusMap: Record<string, string> = {
          suspend: 'suspended',
          ban: 'banned',
          activate: 'active',
        };

        await supabase
          .from('referral_participants')
          .update({
            status: statusMap[action],
            updated_at: new Date().toISOString(),
          })
          .eq('id', participant_id);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, new_status: statusMap[action] }),
        };
      }

      case 'list': {
        const { data: participants } = await supabase
          .from('referral_participants')
          .select(`
            *,
            wallets(balance_cents, total_earned_cents, total_topped_up_cents),
            referred_count:referral_participants!referral_participants_referred_by_fkey(count)
          `)
          .order('created_at', { ascending: false });

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, participants }),
        };
      }

      case 'participant_detail': {
        if (!participant_id) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'participant_id obbligatorio' }) };
        }

        const { data: participant } = await supabase
          .from('referral_participants')
          .select('*')
          .eq('id', participant_id)
          .single();

        const { data: wallet } = await supabase
          .from('wallets')
          .select('*')
          .eq('participant_id', participant_id)
          .single();

        const { data: transactions } = await supabase
          .from('wallet_transactions')
          .select('*')
          .eq('wallet_id', wallet?.id)
          .order('created_at', { ascending: false })
          .limit(50);

        const { data: referrals } = await supabase
          .from('referral_participants')
          .select('id, nome, cognome, telefono, created_at')
          .eq('referred_by', participant_id)
          .order('created_at', { ascending: false });

        const { data: discountCodes } = await supabase
          .from('referral_discount_codes')
          .select('*')
          .eq('participant_id', participant_id)
          .order('created_at', { ascending: false });

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            participant,
            wallet,
            transactions,
            referrals,
            discount_codes: discountCodes || [],
          }),
        };
      }

      case 'discount_codes': {
        const { data: codes } = await supabase
          .from('referral_discount_codes')
          .select('*, referral_participants!inner(nome, cognome, telefono, referral_code)')
          .order('created_at', { ascending: false })
          .limit(200);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, discount_codes: codes || [] }),
        };
      }

      case 'fraud_check': {
        // Find IP clusters (same IP with multiple registrations)
        const { data: ipClusters } = await supabase.rpc('get_ip_clusters');

        // If RPC not available, fall back to manual query
        const { data: recentRegistrations } = await supabase
          .from('referral_participants')
          .select('registration_ip, device_fingerprint, created_at, nome, cognome, telefono')
          .not('registration_ip', 'is', null)
          .order('created_at', { ascending: false })
          .limit(200);

        // Group by IP
        const ipGroups: Record<string, any[]> = {};
        (recentRegistrations || []).forEach((r: any) => {
          if (r.registration_ip) {
            if (!ipGroups[r.registration_ip]) ipGroups[r.registration_ip] = [];
            ipGroups[r.registration_ip].push(r);
          }
        });

        const suspiciousIps = Object.entries(ipGroups)
          .filter(([, entries]) => entries.length >= 3)
          .map(([ip, entries]) => ({ ip, count: entries.length, entries }));

        // Group by fingerprint
        const fpGroups: Record<string, any[]> = {};
        (recentRegistrations || []).forEach((r: any) => {
          if (r.device_fingerprint) {
            if (!fpGroups[r.device_fingerprint]) fpGroups[r.device_fingerprint] = [];
            fpGroups[r.device_fingerprint].push(r);
          }
        });

        const suspiciousFingerprints = Object.entries(fpGroups)
          .filter(([, entries]) => entries.length >= 3)
          .map(([fp, entries]) => ({ fingerprint: fp, count: entries.length, entries }));

        // Unverified phones
        const { data: unverified } = await supabase
          .from('referral_participants')
          .select('*')
          .eq('phone_verified', false);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            suspicious_ips: suspiciousIps,
            suspicious_fingerprints: suspiciousFingerprints,
            unverified_phones: unverified || [],
          }),
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
    console.error('Error in referral-admin:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

export { handler };
