import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const getHeaders = (origin?: string) => ({
  'Access-Control-Allow-Origin': getCorsOrigin(origin),
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
});

async function handleGet(event: any) {
  const params = event.queryStringParameters || {};
  const serviceType = params.service_type || 'ALL';
  const eligibilityStatus = params.eligibility_status || 'ELIGIBLE';
  const sendStatus = params.send_status || 'ALL';
  const reviewRisk = params.review_risk || 'ALL';
  const search = params.search || '';
  const limit = Math.min(parseInt(params.limit || '50', 10), 200);
  const offset = parseInt(params.offset || '0', 10);

  // Build main query
  let query = supabase
    .from('review_candidates')
    .select('*', { count: 'exact' });

  if (serviceType !== 'ALL') {
    query = query.eq('service_type', serviceType);
  }
  if (eligibilityStatus !== 'ALL') {
    query = query.eq('eligibility_status', eligibilityStatus);
  }
  if (sendStatus !== 'ALL') {
    query = query.eq('send_status', sendStatus);
  }
  if (reviewRisk !== 'ALL') {
    query = query.eq('review_risk', reviewRisk);
  }

  if (search && search.trim() !== '') {
    const searchTerm = `%${search.trim()}%`;
    query = query.or(
      `customer_name.ilike.${searchTerm},customer_email.ilike.${searchTerm},customer_phone.ilike.${searchTerm}`
    );
  }

  query = query.order('created_at', { ascending: false });
  query = query.range(offset, offset + limit - 1);

  const { data: candidates, error, count } = await query;

  if (error) throw new Error(`Query failed: ${error.message}`);

  // Build stats query (unfiltered except service_type for consistency)
  let statsBaseQuery = supabase.from('review_candidates').select('eligibility_status, send_status');
  if (serviceType !== 'ALL') {
    statsBaseQuery = statsBaseQuery.eq('service_type', serviceType);
  }

  const { data: statsData, error: statsError } = await statsBaseQuery;

  let stats = {
    eligible: 0,
    to_review: 0,
    excluded: 0,
    to_send: 0,
    sent: 0,
    failed: 0,
  };

  if (!statsError && statsData) {
    statsData.forEach((row: any) => {
      // Eligibility stats
      if (row.eligibility_status === 'ELIGIBLE') stats.eligible++;
      else if (row.eligibility_status === 'TO_REVIEW') stats.to_review++;
      else if (row.eligibility_status === 'EXCLUDED') stats.excluded++;

      // Send status stats
      if (row.send_status === 'TO_SEND') stats.to_send++;
      else if (row.send_status === 'SENT') stats.sent++;
      else if (row.send_status === 'FAILED') stats.failed++;
    });
  }

  return {
    statusCode: 200,
    headers: getHeaders(event.headers?.origin),
    body: JSON.stringify({
      candidates: candidates || [],
      total: count || 0,
      stats,
    }),
  };
}

async function handleBulkEvaluate(body: any, origin?: string) {
  const { sourceRecordIds, serviceType } = body;

  if (!Array.isArray(sourceRecordIds) || sourceRecordIds.length === 0) {
    return {
      statusCode: 400,
      headers: getHeaders(origin),
      body: JSON.stringify({ error: 'sourceRecordIds must be a non-empty array' }),
    };
  }

  if (!serviceType || !['RENTAL', 'WASH'].includes(serviceType)) {
    return {
      statusCode: 400,
      headers: getHeaders(origin),
      body: JSON.stringify({ error: 'serviceType must be RENTAL or WASH' }),
    };
  }

  // Cap at 100 to avoid timeouts
  const ids = sourceRecordIds.slice(0, 100);
  const evaluateUrl = `${process.env.URL || 'https://dr7ai.com'}/.netlify/functions/review-evaluate-candidate`;

  const results: Array<{ sourceRecordId: string; success: boolean; candidate?: any; error?: string }> = [];

  // Process sequentially to avoid overwhelming the DB
  for (const id of ids) {
    try {
      const response = await fetch(evaluateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceRecordId: id, serviceType }),
      });

      const data = await response.json();

      if (response.ok) {
        results.push({ sourceRecordId: id, success: true, candidate: data.candidate });
      } else {
        results.push({ sourceRecordId: id, success: false, error: data.error || 'Unknown error' });
      }
    } catch (err: any) {
      results.push({ sourceRecordId: id, success: false, error: err.message });
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return {
    statusCode: 200,
    headers: getHeaders(origin),
    body: JSON.stringify({
      total: ids.length,
      succeeded,
      failed,
      results,
    }),
  };
}

const handler: Handler = async (event) => {
  const headers = getHeaders(event.headers.origin);
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // GET: list candidates with filters
    if (event.httpMethod === 'GET') {
      return await handleGet(event);
    }

    // POST: bulk evaluation
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');

      if (body.action === 'bulk_evaluate') {
        return await handleBulkEvaluate(body, event.headers.origin);
      }

      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Unknown action. Supported: bulk_evaluate' }),
      };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (error: any) {
    console.error('review-candidates error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Internal server error' }),
    };
  }
};

export { handler };
