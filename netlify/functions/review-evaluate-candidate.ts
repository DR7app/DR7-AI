import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { buildReviewRecipients, type ReviewRecipient } from './utils/reviewRecipients';

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
const CONCLUDED_STATUSES = ['completed', 'completata', 'confirmed', 'confermata', 'active', 'in_corso'];

interface EvaluationResult {
  eligibility_status: EligibilityStatus;
  review_risk: ReviewRisk;
  send_status: SendStatus;
  exclusion_reasons: Array<{ code: ExclusionReasonCode; text: string }>;
  is_internal_record: boolean;
}

async function loadSourceRecord(sourceRecordId: string, serviceType: ServiceType) {
  // All bookings (rental + car_wash) are in the 'bookings' table
  const { data, error } = await supabase
    .from('bookings')
    .select('id, customer_name, customer_email, customer_phone, status, payment_status, booking_details, service_type, service_name, vehicle_name')
    .eq('id', sourceRecordId)
    .single();
  if (error) throw new Error(`Booking not found: ${error.message}`);
  return data;
}

// Righe gia' presenti per questa prenotazione: dal 2026-08-31 ce n'e' una per
// PERSONA (cliente, 2° guidatore, garante, fideiussori), non piu' una sola.
// La lettura NON filtra su recipient_role: se la migrazione
// 20260831_review_destinatari_multipli non e' ancora stata applicata la colonna
// non esiste e un .eq() su colonna mancante farebbe fallire OGNI valutazione.
async function loadExistingCandidates(sourceRecordId: string, serviceType: ServiceType) {
  const { data, error } = await supabase
    .from('review_candidates')
    .select('*')
    .eq('source_record_id', sourceRecordId)
    .eq('service_type', serviceType);
  if (error) throw new Error(`Duplicate check failed: ${error.message}`);
  return data || [];
}

// Le righe scritte prima della migrazione non hanno il ruolo: sono l'intestatario.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const roleOf = (row: any): string => (row?.recipient_role || 'CLIENTE');

/** true se l'errore e' "la colonna recipient_role non esiste" (migrazione non applicata). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isMissingRoleColumn(error: any): boolean {
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  return msg.includes('recipient_role');
}

// 2026-06-20: rimossa checkCustomerAlreadyExists (deduplica per cliente a vita).
// La regola e' "una richiesta per OGNI servizio" (per visita): la deduplica
// resta solo PER PRENOTAZIONE via checkDuplicate(sourceRecordId).

function checkInternalOrBasicExclusions(
  record: any,
  serviceType: ServiceType,
  recipient: ReviewRecipient
): { excluded: boolean; reasons: Array<{ code: ExclusionReasonCode; text: string }>; is_internal: boolean } {
  const reasons: Array<{ code: ExclusionReasonCode; text: string }> = [];
  let is_internal = false;

  const name = (record.customer_name || '').toLowerCase();

  // WASH-specific internal check — exclude internal washes, rientro washes, test records
  if (serviceType === 'WASH') {
    const internalKeywords = ['interno', 'internal', 'rientro', 'test'];
    const serviceName = (record.service_name || record.vehicle_name || '').toLowerCase();
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

  // Missing name — del DESTINATARIO, non della prenotazione
  if (!recipient.name || recipient.name.trim() === '') {
    reasons.push({ code: 'MISSING_NAME', text: EXCLUSION_REASONS.MISSING_NAME });
    return { excluded: true, reasons, is_internal };
  }

  // No contact info
  const hasEmail = !!(recipient.email && recipient.email.trim() !== '');
  const hasPhone = !!(recipient.phone && recipient.phone.trim() !== '');
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
    .eq('tipo_fattura', 'penale')
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
    .eq('tipo_fattura', 'danno')
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
  // Hard exclusions: unpaid or not concluded → EXCLUDED
  const hasHardExclusion = !isPaymentRegular || !isServiceConcluded;

  if (hasHardExclusion) {
    return {
      eligibility_status: 'EXCLUDED',
      review_risk: 'RED',
      send_status: 'EXCLUDED',
      exclusion_reasons: reasons,
      is_internal_record: false,
    };
  }

  // Penalty, damage, or open deposit → TO_REVIEW (da verificare), not EXCLUDED
  const needsReview = hasPenalty || hasDamage || hasOpenDeposit;

  if (needsReview) {
    return {
      eligibility_status: 'TO_REVIEW',
      review_risk: 'RED',
      send_status: 'BLOCKED',
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
  recipient: ReviewRecipient,
  evaluation: EvaluationResult
) {
  const firstReason = evaluation.exclusion_reasons?.[0];
  const hasEmail = !!(recipient.email && recipient.email.trim());
  const hasPhone = !!(recipient.phone && recipient.phone.trim());

  const candidateData: Record<string, unknown> = {
    source_record_id: sourceRecordId,
    service_type: serviceType,
    customer_name: recipient.name || 'N/A',
    customer_email: recipient.email || null,
    customer_phone: recipient.phone || null,
    eligibility_status: evaluation.eligibility_status,
    review_risk: evaluation.review_risk,
    send_status: evaluation.send_status,
    exclusion_reason_code: firstReason?.code || null,
    exclusion_reason_text: firstReason?.text || null,
    contact_available_email: hasEmail,
    contact_available_whatsapp: hasPhone,
    is_internal_record: evaluation.is_internal_record,
    auto_created: true,
    recipient_role: recipient.role,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('review_candidates')
    .insert(candidateData)
    .select()
    .single();

  if (!error) return data;

  // Migrazione 20260831 non ancora applicata: la colonna recipient_role non
  // esiste. Il CLIENTE viene comunque salvato (comportamento storico), le
  // persone aggiuntive sono saltate dal chiamante — senza la colonna finirebbero
  // sullo stesso vincolo UNIQUE (source_record_id, service_type).
  if (isMissingRoleColumn(error)) {
    if (recipient.role !== 'CLIENTE') {
      throw new MissingRoleColumnError();
    }
    delete candidateData.recipient_role;
    const retry = await supabase
      .from('review_candidates')
      .insert(candidateData)
      .select()
      .single();
    if (retry.error) throw new Error(`Failed to insert candidate: ${retry.error.message}`);
    return retry.data;
  }

  throw new Error(`Failed to insert candidate: ${error.message}`);
}

class MissingRoleColumnError extends Error {
  constructor() {
    super('Colonna recipient_role assente: eseguire la migrazione 20260831_review_destinatari_multipli');
    this.name = 'MissingRoleColumnError';
  }
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

  const { error } = await supabase.from('review_audit_logs').insert({
    candidate_id: candidateId,
    action,
    details: {
      source_record_id: sourceRecordId,
      service_type: serviceType,
      eligibility_status: evaluation.eligibility_status,
      review_risk: evaluation.review_risk,
      send_status: evaluation.send_status,
      exclusion_reasons: evaluation.exclusion_reasons,
    },
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
    const { sourceRecordId, serviceType, forceReEvaluate } = JSON.parse(event.body || '{}');

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

    // 1. Righe gia' esistenti per questa prenotazione (una per persona)
    const existingRows = await loadExistingCandidates(sourceRecordId, serviceType);

    // 2. Load source record
    const record = await loadSourceRecord(sourceRecordId, serviceType);

    // 2b. RIMOSSO il blocco "una candidatura per cliente a vita". Regola scelta
    // dalla direzione (2026-06-20): UNA richiesta recensione PER OGNI lavaggio/
    // noleggio (per visita). La deduplica resta PER PRENOTAZIONE + PERSONA:
    // stessa prenotazione e stesso ruolo = stessa candidatura, ma un cliente che
    // torna per un nuovo servizio genera una NUOVA candidatura ed e' di nuovo
    // idoneo a ricevere la richiesta.

    // 2c. Destinatari: intestatario + 2° guidatore + garante + fideiussori.
    // Sono le stesse persone che firmano il contratto: chi ha vissuto il
    // servizio deve poter ricevere la richiesta di recensione.
    const recipients = buildReviewRecipients(record);

    // 3. Valutazione a livello di PRENOTAZIONE (penali, danni, cauzione,
    //    pagamento, contratto): identica per tutte le persone, si calcola una
    //    volta sola. Le esclusioni per nome/contatto mancante restano per persona.
    let bookingEvaluationCache: EvaluationResult | null = null;
    const bookingEvaluation = async (): Promise<EvaluationResult> => {
      if (!bookingEvaluationCache) {
        bookingEvaluationCache = await evaluateEligibility(record, sourceRecordId, serviceType);
      }
      return bookingEvaluationCache;
    };

    const created: any[] = [];
    const skipped: Array<{ role: string; reason: string }> = [];
    let migrationMissing = false;

    for (const recipient of recipients) {
      const existing = existingRows.find((r) => roleOf(r) === recipient.role);
      if (existing && !forceReEvaluate) {
        created.push(existing);
        skipped.push({ role: recipient.role, reason: 'duplicate' });
        continue;
      }
      if (existing && forceReEvaluate) {
        await supabase.from('review_candidates').delete().eq('id', existing.id);
      }

      const basicCheck = checkInternalOrBasicExclusions(record, serviceType, recipient);
      const evaluation: EvaluationResult = basicCheck.excluded
        ? {
            eligibility_status: 'EXCLUDED',
            review_risk: 'RED',
            send_status: 'EXCLUDED',
            exclusion_reasons: basicCheck.reasons,
            is_internal_record: basicCheck.is_internal,
          }
        : await bookingEvaluation();

      try {
        const candidate = await insertCandidate(sourceRecordId, serviceType, recipient, evaluation);
        await insertAuditLog(candidate.id, sourceRecordId, serviceType, evaluation);
        created.push(candidate);
      } catch (err: any) {
        if (err instanceof MissingRoleColumnError) {
          // Senza la colonna si salva solo l'intestatario, come prima.
          migrationMissing = true;
          skipped.push({ role: recipient.role, reason: 'migration_missing' });
          continue;
        }
        throw err;
      }
    }

    if (migrationMissing) {
      console.warn(
        '[review-evaluate-candidate] recipient_role assente: eseguire la migrazione ' +
          '20260831_review_destinatari_multipli. Salvato solo l\'intestatario.'
      );
    }

    // `candidate` (singolare) resta l'intestatario per compatibilita' con i
    // chiamanti esistenti; `candidates` contiene tutte le persone.
    const principale = created.find((c) => roleOf(c) === 'CLIENTE') || created[0] || null;

    return {
      statusCode: 200,
      headers: getHeaders(event.headers.origin),
      body: JSON.stringify({
        candidate: principale,
        candidates: created,
        duplicate: created.length > 0 && skipped.filter((s) => s.reason === 'duplicate').length === created.length,
        migration_missing: migrationMissing || undefined,
      }),
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
