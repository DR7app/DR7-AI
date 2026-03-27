import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    // Fetch all candidates in a single query to compute stats in-memory
    // This is more efficient than multiple count queries
    const { data: candidates, error } = await supabase
      .from('review_candidates')
      .select('eligibility_status, send_status, service_type');

    if (error) {
      console.error('[review-dashboard-stats] Error fetching candidates:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Errore nel caricamento delle statistiche' }),
      };
    }

    const all = candidates || [];

    const stats = {
      // Eligibility status counts
      eligible_count: all.filter(c => c.eligibility_status === 'ELIGIBLE').length,
      to_review_count: all.filter(c => c.eligibility_status === 'TO_REVIEW').length,
      excluded_count: all.filter(c => c.eligibility_status === 'EXCLUDED').length,

      // Send status counts
      to_send_count: all.filter(c => c.send_status === 'TO_SEND').length,
      sent_count: all.filter(c => c.send_status === 'SENT').length,
      failed_count: all.filter(c => c.send_status === 'FAILED').length,

      // Totals
      total_candidates: all.length,

      // Service type counts
      rental_count: all.filter(c => c.service_type === 'rental' || c.service_type === null).length,
      wash_count: all.filter(c => c.service_type === 'car_wash').length,
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, stats }),
    };
  } catch (error: any) {
    console.error('[review-dashboard-stats] Fatal error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

export { handler };
