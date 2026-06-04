import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  }

  try {
    const { participant_id, telefono } = JSON.parse(event.body || '{}');

    if (!participant_id && !telefono) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'participant_id o telefono obbligatorio' }),
      };
    }

    // Find participant
    let query = supabase.from('referral_participants').select('*');
    if (participant_id) {
      query = query.eq('id', participant_id);
    } else {
      query = query.eq('telefono', normalizePhone(telefono));
    }
    const { data: participant, error: pError } = await query.single();

    if (pError || !participant) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Partecipante non trovato' }),
      };
    }

    // Get wallet
    const { data: wallet } = await supabase
      .from('wallets')
      .select('*')
      .eq('participant_id', participant.id)
      .single();

    // Count total referrals
    const { count: totalReferrals } = await supabase
      .from('referral_participants')
      .select('*', { count: 'exact', head: true })
      .eq('referred_by', participant.id);

    // Count qualifying referrals (friends who topped up ≥€100 = 10000 cents)
    const { data: qualifyingData } = await supabase
      .from('wallet_topups')
      .select('participant_id')
      .eq('status', 'completed')
      .gte('amount_cents', 10000);

    // Filter to only those referred by this participant
    const { data: referredFriends } = await supabase
      .from('referral_participants')
      .select('id')
      .eq('referred_by', participant.id);

    const referredIds = new Set((referredFriends || []).map((f: any) => f.id));
    const qualifyingCount = (qualifyingData || []).filter((t: any) => referredIds.has(t.participant_id)).length;

    // Get milestones
    const { data: milestones } = await supabase
      .from('referral_milestones')
      .select('*')
      .eq('participant_id', participant.id)
      .order('milestone_number', { ascending: true });

    // Recent transactions (last 20)
    const { data: transactions } = await supabase
      .from('wallet_transactions')
      .select('*')
      .eq('wallet_id', wallet?.id)
      .order('created_at', { ascending: false })
      .limit(20);

    // Get referred friends list (partially masked names)
    const { data: friends } = await supabase
      .from('referral_participants')
      .select('id, nome, cognome, created_at')
      .eq('referred_by', participant.id)
      .order('created_at', { ascending: false });

    const maskedFriends = (friends || []).map((f: any) => ({
      id: f.id,
      nome: f.nome.charAt(0) + '***',
      cognome: f.cognome.charAt(0) + '***',
      created_at: f.created_at,
      has_topped_up: referredIds.has(f.id) && (qualifyingData || []).some((t: any) => t.participant_id === f.id),
    }));

    // Get discount codes (buoni sconto)
    const { data: discountCodes } = await supabase
      .from('referral_discount_codes')
      .select('id, code, amount_cents, reason, scope, used, used_at, expires_at, created_at')
      .eq('participant_id', participant.id)
      .order('created_at', { ascending: false });

    const nextMilestoneAt = ((milestones || []).length + 1) * 10;
    const progressToMilestone = qualifyingCount % 10;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        participant: {
          id: participant.id,
          nome: participant.nome,
          cognome: participant.cognome,
          referral_code: participant.referral_code,
          status: participant.status,
          created_at: participant.created_at,
        },
        wallet: {
          balance_cents: wallet?.balance_cents || 0,
          total_earned_cents: wallet?.total_earned_cents || 0,
          total_spent_cents: wallet?.total_spent_cents || 0,
          total_topped_up_cents: wallet?.total_topped_up_cents || 0,
        },
        referrals: {
          total: totalReferrals || 0,
          qualifying: qualifyingCount,
          progress_to_milestone: progressToMilestone,
          next_milestone_at: nextMilestoneAt,
          milestones_reached: (milestones || []).length,
        },
        friends: maskedFriends,
        transactions: transactions || [],
        discount_codes: discountCodes || [],
      }),
    };
  } catch (error: any) {
    console.error('Error in referral-dashboard:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

export { handler };
