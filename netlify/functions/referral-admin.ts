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

      case 'site_referrals': {
        // Source 1: customers_extended attributions (signup with ?ref=)
        const { data: extendedRefs, error: refErr } = await supabase
          .from('customers_extended')
          .select('user_id, nome, cognome, email, created_at, referred_by_user_id')
          .not('referred_by_user_id', 'is', null);

        if (refErr) {
          return { statusCode: 500, headers, body: JSON.stringify({ error: refErr.message }) };
        }

        // Source 2: referral_bonuses (payouts — authoritative for "actually rewarded")
        const { data: bonuses, error: bonusErr } = await supabase
          .from('referral_bonuses')
          .select('referrer_user_id, referee_user_id, amount, created_at');

        if (bonusErr) {
          return { statusCode: 500, headers, body: JSON.stringify({ error: bonusErr.message }) };
        }

        // Build authoritative attribution per referee. customers_extended wins
        // over bonuses when both exist; bonuses fill in missing pairs.
        type Pair = { referee_user_id: string; referrer_user_id: string };
        const pairsByReferee = new Map<string, Pair>();
        for (const r of extendedRefs || []) {
          if (r.user_id && r.referred_by_user_id) {
            pairsByReferee.set(r.user_id, { referee_user_id: r.user_id, referrer_user_id: r.referred_by_user_id });
          }
        }
        for (const b of bonuses || []) {
          if (b.referee_user_id && b.referrer_user_id && !pairsByReferee.has(b.referee_user_id)) {
            pairsByReferee.set(b.referee_user_id, { referee_user_id: b.referee_user_id, referrer_user_id: b.referrer_user_id });
          }
        }

        const allUserIds = Array.from(new Set([
          ...Array.from(pairsByReferee.values()).flatMap(p => [p.referee_user_id, p.referrer_user_id]),
        ]));

        // Profile lookup for both referees and referrers
        const profileMap: Record<string, { name: string; email: string | null; code: string | null; created_at: string | null }> = {};
        if (allUserIds.length > 0) {
          const { data: profiles } = await supabase
            .from('customers_extended')
            .select('user_id, nome, cognome, email, referral_code, created_at')
            .in('user_id', allUserIds);
          for (const p of profiles || []) {
            profileMap[p.user_id] = {
              name: `${p.nome || ''} ${p.cognome || ''}`.trim() || '(senza nome)',
              email: p.email,
              code: p.referral_code,
              created_at: p.created_at,
            };
          }

          // Fallback 1: enrich missing profiles from auth.users metadata
          const missing = allUserIds.filter((id) => !profileMap[id] || profileMap[id].name === '(senza nome)');
          if (missing.length > 0) {
            try {
              // Page through auth users (admin API caps at 1000/page)
              let page = 1;
              const perPage = 1000;
              const authMatches: Record<string, { name: string; email: string | null; created_at: string | null }> = {};
              const missingSet = new Set(missing);
              while (missingSet.size > 0) {
                const { data: usersPage, error: listErr } = await supabase.auth.admin.listUsers({ page, perPage });
                if (listErr || !usersPage?.users?.length) break;
                for (const u of usersPage.users) {
                  if (!missingSet.has(u.id)) continue;
                  const meta = (u.user_metadata || {}) as Record<string, unknown>;
                  const fullName = (meta.full_name as string) || (meta.name as string) || `${(meta.first_name as string) || ''} ${(meta.last_name as string) || ''}`.trim();
                  authMatches[u.id] = {
                    name: fullName || u.email || '(senza nome)',
                    email: u.email || null,
                    created_at: u.created_at || null,
                  };
                  missingSet.delete(u.id);
                }
                if (usersPage.users.length < perPage) break;
                page += 1;
              }
              for (const [uid, m] of Object.entries(authMatches)) {
                const existing = profileMap[uid];
                profileMap[uid] = {
                  name: existing && existing.name !== '(senza nome)' ? existing.name : m.name,
                  email: existing?.email || m.email,
                  code: existing?.code || null,
                  created_at: existing?.created_at || m.created_at,
                };
              }
            } catch (e) {
              console.warn('[site_referrals] auth.admin.listUsers fallback failed:', e);
            }
          }

          // Fallback 2: bookings.customer_name (for users with no profile + no auth metadata name)
          const stillMissing = allUserIds.filter((id) => !profileMap[id] || profileMap[id].name === '(senza nome)');
          if (stillMissing.length > 0) {
            const { data: bookingNames } = await supabase
              .from('bookings')
              .select('user_id, customer_name, customer_email, created_at')
              .in('user_id', stillMissing)
              .not('customer_name', 'is', null);
            const byUser: Record<string, { name: string; email: string | null; created_at: string | null }> = {};
            for (const b of bookingNames || []) {
              if (!b.user_id) continue;
              if (!byUser[b.user_id] && b.customer_name && String(b.customer_name).trim()) {
                byUser[b.user_id] = {
                  name: String(b.customer_name).trim(),
                  email: b.customer_email || null,
                  created_at: b.created_at || null,
                };
              }
            }
            for (const [uid, m] of Object.entries(byUser)) {
              const existing = profileMap[uid];
              profileMap[uid] = {
                name: existing && existing.name !== '(senza nome)' ? existing.name : m.name,
                email: existing?.email || m.email,
                code: existing?.code || null,
                created_at: existing?.created_at || m.created_at,
              };
            }
          }
        }

        const bonusMap: Record<string, { amount: number; date: string }> = {};
        for (const b of bonuses || []) {
          if (b.referee_user_id) {
            bonusMap[b.referee_user_id] = { amount: Number(b.amount || 0), date: b.created_at };
          }
        }

        const merged = Array.from(pairsByReferee.values()).map((p) => {
          const referee = profileMap[p.referee_user_id];
          const referrer = profileMap[p.referrer_user_id];
          const bonus = bonusMap[p.referee_user_id];
          return {
            referee_user_id: p.referee_user_id,
            referee_name: referee?.name || '(cliente sconosciuto)',
            referee_email: referee?.email || null,
            referee_signup_date: referee?.created_at || bonus?.date || null,
            referrer_user_id: p.referrer_user_id,
            referrer_name: referrer?.name || '(referente sconosciuto)',
            referrer_code: referrer?.code || null,
            referrer_email: referrer?.email || null,
            bonus_amount: bonus?.amount ?? null,
            bonus_date: bonus?.date ?? null,
          };
        }).sort((a, b) => {
          const da = a.bonus_date || a.referee_signup_date || '';
          const db = b.bonus_date || b.referee_signup_date || '';
          return db.localeCompare(da);
        });

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, referrals: merged }) };
      }

      case 'site_referrers': {
        // List of distinct customers who have invited at least one other user
        // (i.e. they appear as referred_by_user_id in customers_extended).
        const { data: invitedRows, error: invErr } = await supabase
          .from('customers_extended')
          .select('referred_by_user_id')
          .not('referred_by_user_id', 'is', null);

        if (invErr) {
          return { statusCode: 500, headers, body: JSON.stringify({ error: invErr.message }) };
        }

        const referrerIds = Array.from(new Set((invitedRows || []).map(r => r.referred_by_user_id).filter(Boolean) as string[]));
        if (referrerIds.length === 0) {
          return { statusCode: 200, headers, body: JSON.stringify({ success: true, referrers: [] }) };
        }

        const { data: profiles, error: profErr } = await supabase
          .from('customers_extended')
          .select('user_id, nome, cognome, email, referral_code, created_at')
          .in('user_id', referrerIds);

        if (profErr) {
          return { statusCode: 500, headers, body: JSON.stringify({ error: profErr.message }) };
        }

        const referrers = (profiles || []).map(p => ({
          user_id: p.user_id,
          name: `${p.nome || ''} ${p.cognome || ''}`.trim() || '(senza nome)',
          email: p.email || null,
          referral_code: p.referral_code || null,
          created_at: p.created_at || null,
        })).sort((a, b) => a.name.localeCompare(b.name));

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, referrers }) };
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
