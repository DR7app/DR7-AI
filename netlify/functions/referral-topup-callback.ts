import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const REFERRER_WALLET_BONUS_CENTS = 5000; // €50 wallet credit
const REFERRER_BUONO_CENTS = 10000; // €100 buono sconto
const MILESTONE_WALLET_BONUS_CENTS = 5000; // €50 wallet credit
const MILESTONE_BUONO_CENTS = 50000; // €500 buono sconto
const MILESTONE_INTERVAL = 10;
const QUALIFYING_TOPUP_CENTS = 10000; // €100 minimum
const BUONO_VALIDITY_DAYS = 365;

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
    const body = JSON.parse(event.body || '{}');
    const orderId = body.orderId || body.order?.orderId;
    const operationResult = body.operationResult || body.operation?.operationResult;

    if (!orderId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing orderId' }) };
    }

    // Find the topup record
    const { data: topup, error: topupError } = await supabase
      .from('wallet_topups')
      .select('*, referral_participants!inner(id, referred_by, status)')
      .eq('nexi_order_id', orderId)
      .single();

    if (topupError || !topup) {
      console.error('Topup not found for order:', orderId);
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Topup not found' }) };
    }

    // Already processed
    if (topup.status === 'completed') {
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'Already processed' }) };
    }

    const isSuccess = operationResult === 'AUTHORIZED' || operationResult === 'EXECUTED';

    if (!isSuccess) {
      await supabase
        .from('wallet_topups')
        .update({ status: 'failed', metadata: { ...topup.metadata, callback: body } })
        .eq('id', topup.id);

      return { statusCode: 200, headers, body: JSON.stringify({ message: 'Payment failed' }) };
    }

    // Mark topup as completed
    await supabase
      .from('wallet_topups')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        metadata: { ...topup.metadata, callback: body },
      })
      .eq('id', topup.id);

    // Credit wallet
    const { data: wallet } = await supabase
      .from('wallets')
      .select('*')
      .eq('participant_id', topup.participant_id)
      .single();

    if (wallet) {
      const newBalance = wallet.balance_cents + topup.amount_cents;

      await supabase.from('wallet_transactions').insert({
        wallet_id: wallet.id,
        type: 'topup',
        amount_cents: topup.amount_cents,
        balance_after_cents: newBalance,
        description: `Ricarica wallet €${(topup.amount_cents / 100).toFixed(2)}`,
      });

      await supabase
        .from('wallets')
        .update({
          balance_cents: newBalance,
          total_topped_up_cents: wallet.total_topped_up_cents + topup.amount_cents,
          updated_at: new Date().toISOString(),
        })
        .eq('id', wallet.id);

      // If this friend was referred AND topup is ≥€100 AND referrer bonus not yet granted
      const participant = topup.referral_participants;
      if (
        participant.referred_by &&
        topup.amount_cents >= QUALIFYING_TOPUP_CENTS &&
        !topup.referrer_bonus_granted
      ) {
        await grantReferrerBonus(participant.referred_by, topup.id, topup.participant_id);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: 'Topup processed' }),
    };
  } catch (error: any) {
    console.error('Error in referral-topup-callback:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

async function grantReferrerBonus(referrerId: string, topupId: string, friendId: string) {
  try {
    // Check if bonus already granted for this friend's topup
    const { data: existingBonus } = await supabase
      .from('wallet_transactions')
      .select('id')
      .eq('type', 'referral_friend_topup')
      .contains('metadata', { friend_id: friendId })
      .limit(1);

    if (existingBonus && existingBonus.length > 0) {
      return; // Already granted
    }

    const { data: referrerWallet } = await supabase
      .from('wallets')
      .select('*')
      .eq('participant_id', referrerId)
      .single();

    if (!referrerWallet) return;

    // Credit €50 wallet to referrer
    const newBalance = referrerWallet.balance_cents + REFERRER_WALLET_BONUS_CENTS;

    await supabase.from('wallet_transactions').insert({
      wallet_id: referrerWallet.id,
      type: 'referral_friend_topup',
      amount_cents: REFERRER_WALLET_BONUS_CENTS,
      balance_after_cents: newBalance,
      description: 'Bonus amico ricarica: €50 credito wallet',
      metadata: { friend_id: friendId, topup_id: topupId },
    });

    await supabase
      .from('wallets')
      .update({
        balance_cents: newBalance,
        total_earned_cents: referrerWallet.total_earned_cents + REFERRER_WALLET_BONUS_CENTS,
        updated_at: new Date().toISOString(),
      })
      .eq('id', referrerWallet.id);

    // Generate €100 buono sconto for referrer
    try {
      await createBuonoSconto(referrerId, REFERRER_BUONO_CENTS, 'friend_topup');
    } catch (err) {
      console.error('Error creating referrer buono:', err);
    }

    // Mark topup as bonus granted
    await supabase
      .from('wallet_topups')
      .update({ referrer_bonus_granted: true })
      .eq('id', topupId);

    // Check 10-friend milestone
    await checkMilestone(referrerId, referrerWallet.id);
  } catch (err) {
    console.error('Error granting referrer bonus:', err);
  }
}

async function checkMilestone(referrerId: string, walletId: string) {
  try {
    // Count qualifying friends (those who topped up ≥€100)
    const { data: referredFriends } = await supabase
      .from('referral_participants')
      .select('id')
      .eq('referred_by', referrerId);

    if (!referredFriends || referredFriends.length === 0) return;

    const referredIds = referredFriends.map((f: any) => f.id);

    const { data: qualifyingTopups } = await supabase
      .from('wallet_topups')
      .select('participant_id')
      .eq('status', 'completed')
      .eq('referrer_bonus_granted', true)
      .in('participant_id', referredIds);

    const qualifyingCount = new Set((qualifyingTopups || []).map((t: any) => t.participant_id)).size;

    // Check how many milestones should exist
    const expectedMilestones = Math.floor(qualifyingCount / MILESTONE_INTERVAL);

    // How many already granted?
    const { count: existingMilestones } = await supabase
      .from('referral_milestones')
      .select('*', { count: 'exact', head: true })
      .eq('participant_id', referrerId);

    const milestonesToGrant = expectedMilestones - (existingMilestones || 0);

    if (milestonesToGrant <= 0) return;

    // Get current wallet balance
    const { data: wallet } = await supabase
      .from('wallets')
      .select('*')
      .eq('id', walletId)
      .single();

    if (!wallet) return;

    let currentBalance = wallet.balance_cents;
    let totalEarned = wallet.total_earned_cents;

    for (let i = 0; i < milestonesToGrant; i++) {
      const milestoneNumber = (existingMilestones || 0) + i + 1;
      currentBalance += MILESTONE_WALLET_BONUS_CENTS;
      totalEarned += MILESTONE_WALLET_BONUS_CENTS;

      const { data: txn } = await supabase
        .from('wallet_transactions')
        .insert({
          wallet_id: walletId,
          type: 'milestone_10_friends',
          amount_cents: MILESTONE_WALLET_BONUS_CENTS,
          balance_after_cents: currentBalance,
          description: `Traguardo ${milestoneNumber * 10} amici: €50 credito wallet`,
          metadata: { milestone_number: milestoneNumber, qualifying_count: qualifyingCount },
        })
        .select('id')
        .single();

      await supabase.from('referral_milestones').insert({
        participant_id: referrerId,
        milestone_number: milestoneNumber,
        qualifying_referrals: qualifyingCount,
        bonus_cents: MILESTONE_WALLET_BONUS_CENTS + MILESTONE_BUONO_CENTS,
        transaction_id: txn?.id,
      });

      // Generate €500 buono sconto for milestone
      try {
        await createBuonoSconto(referrerId, MILESTONE_BUONO_CENTS, 'milestone');
      } catch (err) {
        console.error('Error creating milestone buono:', err);
      }
    }

    // Update wallet
    await supabase
      .from('wallets')
      .update({
        balance_cents: currentBalance,
        total_earned_cents: totalEarned,
        updated_at: new Date().toISOString(),
      })
      .eq('id', walletId);
  } catch (err) {
    console.error('Error checking milestone:', err);
  }
}

export { handler };
