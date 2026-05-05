-- ============================================================
-- EMTN — European Mobility Trust Network
--
-- Production schema embedded inside DR7 Supabase. Six tables that
-- mirror the original spec (clients / events / event_documents /
-- access_logs / otp_requests / stats_cache).
--
-- Hard rules enforced via DB-level constraints + RLS:
--   * Every table is RLS-protected; only authenticated admins can
--     read/write through service-role functions.
--   * Reports cannot be viewed without an OTP-verified row in
--     emtn_otp_requests (enforced application-side; RLS denies
--     direct anonymous reads of emtn_events for full payload).
--   * Documents are not publicly readable; storage path is private.
--   * No data-export view exists in this migration.
-- ============================================================

-- ── ENUM types ──────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE emtn_event_type AS ENUM (
        'UNPAID_DAMAGE',
        'INSOLVENCY',
        'NON_RETURN',
        'THEFT_REPORTED',
        'LEGAL_EVENT'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE emtn_event_status AS ENUM (
        'UNDER_REVIEW',
        'APPROVED',
        'REJECTED'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE emtn_access_action AS ENUM (
        'SEARCH',
        'REQUEST_OTP',
        'VERIFY_OTP',
        'VIEW_REPORT',
        'REPORT_EVENT',
        'UPLOAD_DOCUMENT'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── TABLE: emtn_clients ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.emtn_clients (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    codice_fiscale  varchar(16) NOT NULL UNIQUE,
    nome            text,
    cognome         text,
    data_nascita    date,
    created_at      timestamptz NOT NULL DEFAULT now(),
    -- CF format check (Italian): 16 chars uppercase, alphanumeric
    -- pattern AAAAAA00A00A000A. Tollerante alle lettere I/O/Q che
    -- normalmente non compaiono ma alcune persone hanno CF storici.
    CONSTRAINT emtn_clients_cf_format
        CHECK (codice_fiscale ~ '^[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]$')
);
CREATE INDEX IF NOT EXISTS idx_emtn_clients_cf ON public.emtn_clients(codice_fiscale);
CREATE INDEX IF NOT EXISTS idx_emtn_clients_created_at ON public.emtn_clients(created_at DESC);

-- ── TABLE: emtn_events ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.emtn_events (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id               uuid NOT NULL REFERENCES public.emtn_clients(id) ON DELETE RESTRICT,
    type                    emtn_event_type NOT NULL,
    status                  emtn_event_status NOT NULL DEFAULT 'UNDER_REVIEW',
    headline                text NOT NULL,
    description             text NOT NULL,
    occurred_at             date,
    -- Operatore = auth.users.id dell'admin DR7 che apre la segnalazione.
    -- Non FK su auth.users (potrebbe sparire); tracciato come uuid+email.
    created_by_operator_id  uuid NOT NULL,
    created_by_email        text,
    -- Booking di riferimento (vincolo "no EMTN access without active
    -- booking_id"). Nullable solo per eventi storici importati. Per i
    -- nuovi eventi e' richiesto application-side.
    booking_id              uuid,
    reviewed_by             uuid,
    reviewed_at             timestamptz,
    review_note             text,
    created_at              timestamptz NOT NULL DEFAULT now(),
    -- Almeno 20 caratteri di descrizione: barriera anti-spam segnalazione.
    CONSTRAINT emtn_events_description_min
        CHECK (char_length(description) >= 20)
);
CREATE INDEX IF NOT EXISTS idx_emtn_events_client ON public.emtn_events(client_id, status);
CREATE INDEX IF NOT EXISTS idx_emtn_events_status ON public.emtn_events(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emtn_events_booking ON public.emtn_events(booking_id) WHERE booking_id IS NOT NULL;

-- ── TABLE: emtn_event_documents ────────────────────────────
CREATE TABLE IF NOT EXISTS public.emtn_event_documents (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id     uuid NOT NULL REFERENCES public.emtn_events(id) ON DELETE CASCADE,
    file_url     text NOT NULL,
    file_name    text,
    file_type    text,
    file_size    bigint,
    uploaded_by  uuid NOT NULL,
    uploaded_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT emtn_doc_size_max CHECK (file_size IS NULL OR file_size <= 10485760) -- 10 MB
);
CREATE INDEX IF NOT EXISTS idx_emtn_event_documents_event ON public.emtn_event_documents(event_id);

-- ── TABLE: emtn_access_logs ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.emtn_access_logs (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    operator_id  uuid NOT NULL,
    operator_email text,
    client_id    uuid REFERENCES public.emtn_clients(id) ON DELETE SET NULL,
    booking_id   uuid,
    action       emtn_access_action NOT NULL,
    success      boolean NOT NULL DEFAULT true,
    ip_address   inet,
    user_agent   text,
    metadata     jsonb,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emtn_access_logs_operator ON public.emtn_access_logs(operator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emtn_access_logs_client ON public.emtn_access_logs(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emtn_access_logs_action ON public.emtn_access_logs(action, created_at DESC);

-- ── TABLE: emtn_otp_requests ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.emtn_otp_requests (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       uuid NOT NULL REFERENCES public.emtn_clients(id) ON DELETE CASCADE,
    operator_id     uuid NOT NULL, -- chi ha richiesto il consenso (DR7 admin)
    booking_id      uuid,          -- contesto: per quale booking l'admin sta consultando
    email           text,
    phone           text,
    -- Hash SHA-256 esadecimale del codice OTP. NON memorizziamo mai
    -- l'OTP in chiaro: la verifica confronta hash(input) col campo.
    otp_code_hash   text NOT NULL,
    expires_at      timestamptz NOT NULL,
    verified        boolean NOT NULL DEFAULT false,
    verified_at     timestamptz,
    attempts        smallint NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT emtn_otp_channel CHECK (email IS NOT NULL OR phone IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_emtn_otp_client ON public.emtn_otp_requests(client_id, created_at DESC);
-- Lookup veloce per la verifica: stesso (operator_id, client_id) verified=true
-- non scaduto = sblocco visibilita' report.
CREATE INDEX IF NOT EXISTS idx_emtn_otp_unlock
    ON public.emtn_otp_requests(operator_id, client_id, verified, expires_at)
    WHERE verified = true;

-- ── TABLE: emtn_stats_cache ────────────────────────────────
-- Snapshot denormalizzato per evitare JOIN pesanti sul lookup principale.
-- Aggiornato application-side dopo ogni evento approvato.
CREATE TABLE IF NOT EXISTS public.emtn_stats_cache (
    client_id              uuid PRIMARY KEY REFERENCES public.emtn_clients(id) ON DELETE CASCADE,
    total_rentals          integer NOT NULL DEFAULT 0,
    regular_rentals        integer NOT NULL DEFAULT 0,
    negative_events        integer NOT NULL DEFAULT 0,
    events_under_review    integer NOT NULL DEFAULT 0,
    last_activity_date     timestamptz,
    updated_at             timestamptz NOT NULL DEFAULT now()
);

-- ── RLS — tutte le tabelle bloccate per default ────────────
ALTER TABLE public.emtn_clients          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emtn_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emtn_event_documents  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emtn_access_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emtn_otp_requests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emtn_stats_cache      ENABLE ROW LEVEL SECURITY;

-- Service role: pieno accesso (le Netlify Functions girano col service key).
-- Niente policy per ruoli `authenticated` o `anon` -> niente client diretto.
CREATE POLICY emtn_clients_service ON public.emtn_clients FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY emtn_events_service ON public.emtn_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY emtn_docs_service ON public.emtn_event_documents FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY emtn_logs_service ON public.emtn_access_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY emtn_otp_service ON public.emtn_otp_requests FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY emtn_stats_service ON public.emtn_stats_cache FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── Storage bucket per documenti evento ────────────────────
-- Bucket privato; firma URL on-demand quando un revisore deve aprire un PDF.
INSERT INTO storage.buckets (id, name, public)
VALUES ('emtn-documents', 'emtn-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Solo service role puo' leggere/scrivere; nessuna policy per anon/authenticated.
CREATE POLICY IF NOT EXISTS "EMTN docs service-only insert"
    ON storage.objects FOR INSERT TO service_role
    WITH CHECK (bucket_id = 'emtn-documents');
CREATE POLICY IF NOT EXISTS "EMTN docs service-only select"
    ON storage.objects FOR SELECT TO service_role
    USING (bucket_id = 'emtn-documents');

-- ── Trigger: bumpa stats_cache.events_under_review ─────────
CREATE OR REPLACE FUNCTION public.emtn_bump_stats_cache()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- Garantiamo l'esistenza della riga di cache.
    INSERT INTO public.emtn_stats_cache (client_id) VALUES (NEW.client_id)
    ON CONFLICT (client_id) DO NOTHING;

    IF TG_OP = 'INSERT' THEN
        IF NEW.status = 'UNDER_REVIEW' THEN
            UPDATE public.emtn_stats_cache
            SET events_under_review = events_under_review + 1,
                last_activity_date = now(),
                updated_at = now()
            WHERE client_id = NEW.client_id;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        -- Transizione status: aggiorna i contatori derivati.
        IF OLD.status = 'UNDER_REVIEW' AND NEW.status <> 'UNDER_REVIEW' THEN
            UPDATE public.emtn_stats_cache
            SET events_under_review = GREATEST(0, events_under_review - 1),
                negative_events = CASE WHEN NEW.status = 'APPROVED'
                                       THEN negative_events + 1
                                       ELSE negative_events END,
                last_activity_date = now(),
                updated_at = now()
            WHERE client_id = NEW.client_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_emtn_events_stats ON public.emtn_events;
CREATE TRIGGER trg_emtn_events_stats
    AFTER INSERT OR UPDATE OF status ON public.emtn_events
    FOR EACH ROW EXECUTE FUNCTION public.emtn_bump_stats_cache();
