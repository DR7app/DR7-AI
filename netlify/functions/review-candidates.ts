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
  // 2026-08-22: il tetto era 200 con default 50, quindi la tab Recensioni
  // mostrava al massimo 50 candidati per bucket e "mancavano molti avis".
  // Ora il client pagina esplicitamente con limit=1000 (limite PostgREST).
  const limit = Math.min(parseInt(params.limit || '50', 10), 1000);
  const offset = parseInt(params.offset || '0', 10);

  // 02/09/2026 — la tab Recensioni chiede solo le righe.
  //
  // Prima ogni chiamata faceva TRE lavori: le righe della pagina, un
  // `count: 'exact'` sull'intera tabella e — la parte cara — una seconda
  // lettura di `review_candidates` senza filtri per contare gli stati a mano.
  // Quella lettura era pure sbagliata: PostgREST ne restituisce al massimo
  // 1000, quindi i conteggi si fermavano li'. Il client scartava entrambi i
  // valori (usa `review-dashboard-stats`), ma li pagava sei volte per
  // apertura: la tab ci metteva 17 secondi.
  //
  // Ora `total` e `stats` arrivano solo con `?stats=1`, e i conteggi sono
  // fatti dal database (`head: true`), non scaricando le righe.
  const conStats = params.stats === '1';

  // Le colonne che la tab legge davvero. Con `*` viaggiavano anche i campi
  // interni (customer_id, is_duplicate_source, auto_created) su migliaia di
  // righe.
  const COLONNE = 'id, source_record_id, customer_name, customer_email, customer_phone, ' +
    'service_type, eligibility_status, review_risk, send_status, exclusion_reason_code, ' +
    'exclusion_reason_text, contact_available_email, contact_available_whatsapp, ' +
    'is_internal_record, recipient_role, created_at, updated_at';

  // I filtri valgono sia per le righe sia per i conteggi: una funzione sola.
  const applicaFiltri = <T extends { eq: any; or: any }>(q: T): T => {
    let out: any = q;
    if (serviceType !== 'ALL') out = out.eq('service_type', serviceType);
    if (eligibilityStatus !== 'ALL') out = out.eq('eligibility_status', eligibilityStatus);
    if (sendStatus !== 'ALL') out = out.eq('send_status', sendStatus);
    if (reviewRisk !== 'ALL') out = out.eq('review_risk', reviewRisk);
    if (search && search.trim() !== '') {
      const searchTerm = `%${search.trim()}%`;
      out = out.or(
        `customer_name.ilike.${searchTerm},customer_email.ilike.${searchTerm},customer_phone.ilike.${searchTerm}`
      );
    }
    return out as T;
  };

  let query: any = supabase
    .from('review_candidates')
    .select(COLONNE, conStats ? { count: 'exact' } : undefined);
  query = applicaFiltri(query);
  query = query.order('created_at', { ascending: false });
  query = query.range(offset, offset + limit - 1);

  const { data: candidates, error, count } = await query;

  if (error) throw new Error(`Query failed: ${error.message}`);

  let stats: Record<string, number> | undefined;

  if (conStats) {
    // Un conteggio per stato, calcolato dal database. Il filtro service_type
    // resta (come prima); gli altri no, perche' queste cifre descrivono
    // l'insieme, non la pagina.
    const conta = async (colonna: string, valore: string) => {
      let q: any = supabase
        .from('review_candidates')
        .select('id', { count: 'exact', head: true })
        .eq(colonna, valore);
      if (serviceType !== 'ALL') q = q.eq('service_type', serviceType);
      const { count: n } = await q;
      return n || 0;
    };
    const [eligible, to_review, excluded, to_send, sent, failed] = await Promise.all([
      conta('eligibility_status', 'ELIGIBLE'),
      conta('eligibility_status', 'TO_REVIEW'),
      conta('eligibility_status', 'EXCLUDED'),
      conta('send_status', 'TO_SEND'),
      conta('send_status', 'SENT'),
      conta('send_status', 'FAILED'),
    ]);
    stats = { eligible, to_review, excluded, to_send, sent, failed };
  }

  return {
    statusCode: 200,
    headers: getHeaders(event.headers?.origin),
    body: JSON.stringify({
      candidates: candidates || [],
      ...(conStats ? { total: count || 0, stats } : {}),
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
  const evaluateUrl = `${process.env.URL || 'https://platform.dr7ai.com'}/.netlify/functions/review-evaluate-candidate`;

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
