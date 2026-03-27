-- ============================================================
-- Review Management Module
-- Migration: 20260327_create_review_management
-- ============================================================

-- 1. review_candidates
CREATE TABLE IF NOT EXISTS review_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type TEXT NOT NULL CHECK (service_type IN ('RENTAL', 'WASH')),
  source_record_id UUID NOT NULL,
  customer_id UUID NULL REFERENCES customers_extended(id),
  customer_name TEXT NOT NULL,
  customer_email TEXT NULL,
  customer_phone TEXT NULL,
  eligibility_status TEXT NOT NULL CHECK (eligibility_status IN ('ELIGIBLE', 'TO_REVIEW', 'EXCLUDED')),
  review_risk TEXT NOT NULL CHECK (review_risk IN ('GREEN', 'YELLOW', 'RED')),
  send_status TEXT NOT NULL DEFAULT 'TO_SEND' CHECK (send_status IN ('TO_SEND', 'SENT', 'EXCLUDED', 'FAILED', 'BLOCKED')),
  exclusion_reason_code TEXT NULL,
  exclusion_reason_text TEXT NULL,
  contact_available_email BOOLEAN NOT NULL DEFAULT false,
  contact_available_whatsapp BOOLEAN NOT NULL DEFAULT false,
  is_internal_record BOOLEAN NOT NULL DEFAULT false,
  is_duplicate_source BOOLEAN NOT NULL DEFAULT false,
  auto_created BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_record_id, service_type)
);

-- 2. review_requests
CREATE TABLE IF NOT EXISTS review_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES review_candidates(id),
  send_mode TEXT NOT NULL CHECK (send_mode IN ('AUTOMATIC', 'MANUAL')),
  send_channel TEXT NOT NULL CHECK (send_channel IN ('EMAIL_ONLY', 'WHATSAPP_ONLY', 'EMAIL_AND_WHATSAPP')),
  email_sent BOOLEAN NOT NULL DEFAULT false,
  whatsapp_sent BOOLEAN NOT NULL DEFAULT false,
  email_sent_at TIMESTAMPTZ NULL,
  whatsapp_sent_at TIMESTAMPTZ NULL,
  send_status TEXT NOT NULL DEFAULT 'TO_SEND' CHECK (send_status IN ('TO_SEND', 'SENT', 'FAILED', 'BLOCKED', 'CANCELLED')),
  review_link TEXT NOT NULL,
  error_message TEXT NULL,
  created_by_operator TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. review_templates
CREATE TABLE IF NOT EXISTS review_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key TEXT NOT NULL UNIQUE CHECK (template_key IN ('RENTAL_EMAIL', 'RENTAL_WHATSAPP', 'WASH_EMAIL', 'WASH_WHATSAPP')),
  subject TEXT NULL,
  body TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. review_settings (single-row configuration)
CREATE TABLE IF NOT EXISTS review_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auto_enabled_rental BOOLEAN NOT NULL DEFAULT true,
  auto_enabled_wash BOOLEAN NOT NULL DEFAULT true,
  rental_auto_channel TEXT NOT NULL DEFAULT 'EMAIL_ONLY' CHECK (rental_auto_channel IN ('EMAIL_ONLY', 'WHATSAPP_ONLY', 'EMAIL_AND_WHATSAPP', 'NO_SEND')),
  wash_auto_channel TEXT NOT NULL DEFAULT 'EMAIL_ONLY' CHECK (wash_auto_channel IN ('EMAIL_ONLY', 'WHATSAPP_ONLY', 'EMAIL_AND_WHATSAPP', 'NO_SEND')),
  wash_delay_minutes INTEGER NOT NULL DEFAULT 60,
  require_manual_for_yellow BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. review_audit_logs
CREATE TABLE IF NOT EXISTS review_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NULL,
  review_request_id UUID NULL,
  operator TEXT NULL,
  action TEXT NOT NULL CHECK (action IN (
    'CANDIDATE_CREATED',
    'CANDIDATE_EXCLUDED',
    'CANDIDATE_MARKED_TO_REVIEW',
    'AUTO_QUEUE_CREATED',
    'AUTO_SEND_TRIGGERED',
    'MANUAL_SEND_TRIGGERED',
    'EMAIL_SENT',
    'WHATSAPP_SENT',
    'SEND_FAILED',
    'DUPLICATE_BLOCKED',
    'INVALID_CONTACT_BLOCKED',
    'INTERNAL_RECORD_SKIPPED'
  )),
  details JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Indexes
-- ============================================================

-- review_candidates
CREATE INDEX idx_review_candidates_service_type ON review_candidates (service_type);
CREATE INDEX idx_review_candidates_eligibility_status ON review_candidates (eligibility_status);
CREATE INDEX idx_review_candidates_send_status ON review_candidates (send_status);
CREATE INDEX idx_review_candidates_review_risk ON review_candidates (review_risk);
CREATE INDEX idx_review_candidates_customer_id ON review_candidates (customer_id);
CREATE INDEX idx_review_candidates_source_record_id ON review_candidates (source_record_id);
CREATE INDEX idx_review_candidates_created_at ON review_candidates (created_at);

-- review_requests
CREATE INDEX idx_review_requests_candidate_id ON review_requests (candidate_id);
CREATE INDEX idx_review_requests_send_status ON review_requests (send_status);
CREATE INDEX idx_review_requests_created_at ON review_requests (created_at);

-- review_audit_logs
CREATE INDEX idx_review_audit_logs_candidate_id ON review_audit_logs (candidate_id);
CREATE INDEX idx_review_audit_logs_review_request_id ON review_audit_logs (review_request_id);
CREATE INDEX idx_review_audit_logs_action ON review_audit_logs (action);
CREATE INDEX idx_review_audit_logs_created_at ON review_audit_logs (created_at);

-- ============================================================
-- Seed: review_settings (single default row)
-- ============================================================

INSERT INTO review_settings (
  auto_enabled_rental,
  auto_enabled_wash,
  rental_auto_channel,
  wash_auto_channel,
  wash_delay_minutes,
  require_manual_for_yellow
) VALUES (
  true,
  true,
  'EMAIL_ONLY',
  'EMAIL_ONLY',
  60,
  true
);

-- ============================================================
-- Seed: review_templates (4 default Italian templates)
-- ============================================================

INSERT INTO review_templates (template_key, subject, body) VALUES
(
  'RENTAL_EMAIL',
  'Come è stato il tuo noleggio con DR7 Empire?',
  E'Ciao {{customer_name}},\n\nGrazie per aver scelto DR7 Empire per il tuo noleggio del {{service_date}}!\n\nLa tua opinione è molto importante per noi. Ti chiediamo gentilmente di dedicare un minuto per lasciarci una recensione su Google:\n\n{{review_link}}\n\nGrazie mille per il tuo tempo!\n\nIl team DR7 Empire'
),
(
  'RENTAL_WHATSAPP',
  NULL,
  E'Ciao {{customer_name}}! \xF0\x9F\x91\x8B\n\nGrazie per aver noleggiato con DR7 Empire il {{service_date}}.\n\nCi farebbe molto piacere se potessi lasciarci una recensione su Google:\n{{review_link}}\n\nGrazie mille! \xE2\xAD\x90\nIl team DR7 Empire'
),
(
  'WASH_EMAIL',
  'Come è stato il lavaggio con DR7 Empire?',
  E'Ciao {{customer_name}},\n\nGrazie per aver scelto DR7 Empire per il tuo lavaggio del {{service_date}}!\n\nLa tua opinione è molto importante per noi. Ti chiediamo gentilmente di dedicare un minuto per lasciarci una recensione su Google:\n\n{{review_link}}\n\nGrazie mille per il tuo tempo!\n\nIl team DR7 Empire'
),
(
  'WASH_WHATSAPP',
  NULL,
  E'Ciao {{customer_name}}! \xF0\x9F\x91\x8B\n\nGrazie per aver scelto il nostro servizio lavaggio il {{service_date}}.\n\nCi farebbe molto piacere se potessi lasciarci una recensione su Google:\n{{review_link}}\n\nGrazie mille! \xE2\xAD\x90\nIl team DR7 Empire'
);
