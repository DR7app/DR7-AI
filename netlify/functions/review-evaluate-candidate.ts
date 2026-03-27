import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const getHeaders = (origin?: string) => ({
  'Access-Control-Allow-Origin': getCorsOrigin(origin),
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
});

type ServiceType = 'RENTAL' | 'WASH';
type EligibilityStatus = 'ELIGIBLE' | 'TO_REVIEW' | 'EXCLUDED';
type ReviewRisk = 'GREEN' | 'YELLOW' | 'RED';
type SendStatus = 'TO_SEND' | 'BLOCKED' | 'EXCLUDED';

type ExclusionReasonCode =
  | 'HAS_PENALTY'
  | 'HAS_DAMAGE'
  | 'OPEN_DEPOSIT'
  | 'UNPAID'
  | 'NOT_CONCLUDED'
  | 'CONTRACT_NOT_CLOSED'
  | 'MISSING_NAME'
  | 'NO_CONTACT'
  | 'INTERNAL_RECORD'
  | 'OPEN_DISPUTE';

const EXCLUSION_REASONS: Record<ExclusionReasonCode, string> = {
  HAS_PENALTY: 'Presenza di penale registrata',
  HAS_DAMAGE: 'Danno registrato sul veicolo',
  OPEN_DEPOSIT: 'Cauzione ancora aperta o in attesa',
  UNPAID: 'Pagamento non regolare',
  NOT_CONCLUDED: 'Servizio non ancora concluso',
  CONTRACT_NOT_CLOSED: 'Contratto non completamente chiuso',
  MISSING_NAME: 'Nome cliente mancante',
  NO_CONTACT: 'Nessun contatto disponibile (email o telefono)',
  INTERNAL_RECORD: 'Registrazione interna/tecnica',
  OPEN_DISPUTE: 'Contestazione aperta',
};

const PAID_STATUSES = ['paid', 'completed', 'succeeded'];
const CONCLUDED_STATUSES = ['completed', 'completata'];

interface EvaluationResult {
  eligibility_status: EligibilityStatus;
  review_risk: ReviewRisk;
  send_status: SendStatus;
  exclusion_reasons: Array<{ code: ExclusionReasonCode; text: string }>;
  is_internal_record: boolean;
}

async function loadSourceRecord(sourceRecordId: string, serviceType: ServiceType) {
  if (serviceType === 'RENTAL') {
    const { data, error } = await supabase
      .from('bookings')
      .select('id, customer_name, customer_email, customer_phone, status, payment_status, booking_details')
      .eq('id', sourceRecordId)
      .single();
    if (error) throw new Error(`Booking not found: ${error.message}`);
    return data;
  } else {
    const { data, error } = await supabase
      .from('car_wash_bookings')
      .select('id, customer_name, customer_email, customer_phone, status, payment_status, service_name, notes')
      .eq('id', sourceRecordId)
      .single();
    if (error) throw new Error(`Car wash booking not found: ${error.message}`);
    return data;
  }
}

async function checkDuplicate(sourceRecordId: string, serviceType: ServiceType) {
  const { data, error } = await supabase
    .from('review_candidates')
    .select('*')
    .eq('source_record_id', sourceRecordId)
    .eq('service_type', serviceType)
    .maybeSingle();
  if (error) throw new Error(`Duplicate check failed: ${error.message}`);
  return data;
}

function checkInternalOrBasicExclusions(
  record: any,
  serviceType: ServiceType
): { excluded: boolean; reasons: Array<{ code: ExclusionReasonCode; text: string }>; is_internal: boolean } {
  const reasons: Array<{ code: ExclusionReasonCode; text: string }> = [];
  let is_internal = false;

  const name = (record.customer_name || '').toLowerCase();

  // WASH-specific internal check — exclude internal washes, rientro washes, test records
  if (serviceType === 'WASH') {
    const internalKeywords = ['interno', 'internal', 'rientro', 'test'];
    const serviceName = (record.service_name || record.description || record.notes || '').toLowerCase();
    if (internalKeywords.some((kw) => name.includes(kw) || serviceName.includes(kw))) {
      is_internal = true;
      reasons.push({ code: 'INTERNAL_RECORD', text: EXCLUSION_REASONS.INTERNAL_RECORD });
      return { excluded: true, reasons, is_internal };
    }
  }

  // RENTAL: also exclude test bookings
  if (serviceType === 'RENTAL') {
    if (name.includes('test') || name.includes('interno')) {
      is_internal = true;
      reasons.push({ code: 'INTERNAL_RECORD', text: EXCLUSION_REASONS.INTERNAL_RECORD });
      return { excluded: true, reasons, is_internal };
    }
  }

  // Missing name
  if (!record.customer_name || record.customer_name.trim() === '') {
    reasons.push({ code: 'MISSING_NAME', text: EXCLUSION_REASONS.MISSING_NAME });
    return { excluded: true, reasons, is_internal };
  }

  // No contact info
  const hasEmail = record.customer_email && record.customer_email.trim() !== '';
  const hasPhone = record.customer_phone && record.customer_phone.trim() !== '';
  if (!hasEmail && !hasPhone) {
    reasons.push({ code: 'NO_CONTACT', text: EXCLUSION_REASONS.NO_CONTACT });
    return { excluded: true, reasons, is_internal };
  }

  return { excluded: false, reasons: [], is_internal: false };
}

async function evaluateEligibility(
  record: any,
  sourceRecordId: string,
  serviceType: ServiceType
): Promise<EvaluationResult> {
  const reasons: Array<{ code: ExclusionReasonCode; text: string }> = [];
  const bookingDetails = record.booking_details || {};

  // Check penalties
  const hasPenaltyInDetails = Array.isArray(bookingDetails.penalties) && bookingDetails.penalties.length > 0;
  const { data: penaltyFatture } = await supabase
    .from('fatture')
    .select('id')
    .eq('booking_id', sourceRecordId)
    .eq('tipo', 'penale')
    .limit(1);
  const hasPenalty = hasPenaltyInDetails || (penaltyFatture && penaltyFatture.length > 0);
  if (hasPenalty) {
    reasons.push({ code: 'HAS_PENALTY', text: EXCLUSION_REASONS.HAS_PENALTY });
  }

  // Check damages
  const hasDamageInDetails = Array.isArray(bookingDetails.danni) && bookingDetails.danni.length > 0;
  const { data: dannoFatture } = await supabase
    .from('fatture')
    .select('id')
    .eq('booking_id', sourceRecordId)
    .eq('tipo', 'danno')
    .limit(1);
  const hasDamage = hasDamageInDetails || (dannoFatture && dannoFatture.length > 0);
  if (hasDamage) {
    reasons.push({ code: 'HAS_DAMAGE', text: EXCLUSION_REASONS.HAS_DAMAGE });
  }

  // Check open deposit (RENTAL only)
  let hasOpenDeposit = false;
  if (serviceType === 'RENTAL') {
    const { data: openCauzioni } = await supabase
      .from('cauzioni')
      .select('id')
      .eq('riferimento_contratto_id', sourceRecordId)
      .not('stato', 'in', '("Restituita","Sbloccata")')
      .limit(1);
    hasOpenDeposit = (openCauzioni && openCauzioni.length > 0) || false;
    if (hasOpenDeposit) {
      reasons.push({ code: 'OPEN_DEPOSIT', text: EXCLUSION_REASONS.OPEN_DEPOSIT });
    }
  }

  // Check payment status
  const isPaymentRegular = PAID_STATUSES.includes(record.payment_status);
  if (!isPaymentRegular) {
    reasons.push({ code: 'UNPAID', text: EXCLUSION_REASONS.UNPAID });
  }

  // Check service concluded
  const isServiceConcluded = CONCLUDED_STATUSES.includes(record.status);
  if (!isServiceConcluded) {
    reasons.push({ code: 'NOT_CONCLUDED', text: EXCLUSION_REASONS.NOT_CONCLUDED });
  }

  // Check contract closed (RENTAL only)
  let isContractClosed = true;
  if (serviceType === 'RENTAL') {
    const { data: contracts } = await supabase
      .from('contracts')
      .select('id')
      .eq('booking_id', sourceRecordId)
      .limit(1);
    isContractClosed = (contracts && contracts.length > 0) || false;
  }

  // Determine eligibility
  const hasHardExclusion = hasPenalty || hasDamage || hasOpenDeposit || !isPaymentRegular || !isServiceConcluded;

  if (hasHardExclusion) {
    return {
      eligibility_status: 'EXCLUDED',
      review_risk: 'RED',
      send_status: 'EXCLUDED',
      exclusion_reasons: reasons,
      is_internal_record: false,
    };
  }

  // Minor issues -> TO_REVIEW
  if (serviceType === 'RENTAL' && !isContractClosed) {
    reasons.push({ code: 'CONTRACT_NOT_CLOSED', text: EXCLUSION_REASONS.CONTRACT_NOT_CLOSED });
    return {
      eligibility_status: 'TO_REVIEW',
      review_risk: 'YELLOW',
      send_status: 'BLOCKED',
      exclusion_reasons: reasons,
      is_internal_record: false,
    };
  }

  // All clear -> ELIGIBLE
  return {
    eligibility_status: 'ELIGIBLE',
    review_risk: 'GREEN',
    send_status: 'TO_SEND',
    exclusion_reasons: [],
    is_internal_record: false,
  };
}

async function insertCandidate(
  sourceRecordId: string,
  serviceType: ServiceType,
  record: any,
  evaluation: EvaluationResult
) {
  const candidateData = {
    source_record_id: sourceRecordId,
    service_type: serviceType,
    customer_name: record.customer_name || null,
    customer_email: record.customer_email || null,
    customer_phone: record.customer_phone || null,
    eligibility_status: evaluation.eligibility_status,
    review_risk: evaluation.review_risk,
    send_status: evaluation.send_status,
    exclusion_reasons: evaluation.exclusion_reasons,
    is_internal_record: evaluation.is_internal_record,
    evaluated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('review_candidates')
    .insert(candidateData)
    .select()
    .single();

  if (error) throw new Error(`Failed to insert candidate: ${error.message}`);
  return data;
}

async function insertAuditLog(
  candidateId: string,
  sourceRecordId: string,
  serviceType: ServiceType,
  evaluation: EvaluationResult
) {
  let action: string;
  if (evaluation.eligibility_status === 'ELIGIBLE') {
    action = 'CANDIDATE_CREATED';
  } else if (evaluation.eligibility_status === 'TO_REVIEW') {
    action = 'CANDIDATE_MARKED_TO_REVIEW';
  } else {
    action = 'CANDIDATE_EXCLUDED';
  }

  const { error } = await supabase.from('review_audit_log').insert({
    candidate_id: candidateId,
    source_record_id: sourceRecordId,
    service_type: serviceType,
    action,
    details: {
      eligibility_status: evaluation.eligibility_status,
      review_risk: evaluation.review_risk,
      send_status: evaluation.send_status,
      exclusion_reasons: evaluation.exclusion_reasons,
    },
    created_at: new Date().toISOString(),
  });

  if (error) {
    console.error('Failed to insert audit log:', error);
    // Non-fatal: don't throw
  }
}

const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: getHeaders(event.headers.origin), body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: getHeaders(event.headers.origin), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { sourceRecordId, serviceType } = JSON.parse(event.body || '{}');

    if (!sourceRecordId || !serviceType) {
      return {
        statusCode: 400,
        headers: getHeaders(event.headers.origin),
        body: JSON.stringify({ error: 'Missing required fields: sourceRecordId, serviceType' }),
      };
    }

    if (!['RENTAL', 'WASH'].includes(serviceType)) {
      return {
        statusCode: 400,
        headers: getHeaders(event.headers.origin),
        body: JSON.stringify({ error: 'serviceType must be RENTAL or WASH' }),
      };
    }

    // 1. Check for duplicate
    const existing = await checkDuplicate(sourceRecordId, serviceType);
    if (existing) {
      return {
        statusCode: 200,
        headers: getHeaders(event.headers.origin),
        body: JSON.stringify({ candidate: existing, duplicate: true }),
      };
    }

    // 2. Load source record
    const record = await loadSourceRecord(sourceRecordId, serviceType);

    // 3. Check internal / basic exclusions
    const basicCheck = checkInternalOrBasicExclusions(record, serviceType);
    if (basicCheck.excluded) {
      const excludedEvaluation: EvaluationResult = {
        eligibility_status: 'EXCLUDED',
        review_risk: 'RED',
        send_status: 'EXCLUDED',
        exclusion_reasons: basicCheck.reasons,
        is_internal_record: basicCheck.is_internal,
      };

      const candidate = await insertCandidate(sourceRecordId, serviceType, record, excludedEvaluation);
      await insertAuditLog(candidate.id, sourceRecordId, serviceType, excludedEvaluation);

      return {
        statusCode: 200,
        headers: getHeaders(event.headers.origin),
        body: JSON.stringify({ candidate, duplicate: false }),
      };
    }

    // 4. Full eligibility evaluation
    const evaluation = await evaluateEligibility(record, sourceRecordId, serviceType);

    // 5. Insert candidate
    const candidate = await insertCandidate(sourceRecordId, serviceType, record, evaluation);

    // 6. Insert audit log
    await insertAuditLog(candidate.id, sourceRecordId, serviceType, evaluation);

    return {
      statusCode: 200,
      headers: getHeaders(event.headers.origin),
      body: JSON.stringify({ candidate, duplicate: false }),
    };
  } catch (error: any) {
    console.error('review-evaluate-candidate error:', error);
    return {
      statusCode: 500,
      headers: getHeaders(event.headers.origin),
      body: JSON.stringify({ error: error.message || 'Internal server error' }),
    };
  }
};

export { handler };
