-- ─────────────────────────────────────────────────────────────────────────
-- CUSTOMER INVITES — link condivisibili per auto-registrazione cliente.
-- L'admin genera un token, lo invia via WhatsApp/email; il cliente clicca,
-- compila il form pubblico, i suoi dati finiscono in customers_extended e
-- gli eventuali documenti caricati passano dalla pipeline Verifica Documenti.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.customer_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token TEXT NOT NULL UNIQUE,
    created_by UUID,                         -- admin user_id che ha generato
    created_by_name TEXT,                    -- snapshot del nome admin
    note TEXT,                               -- promemoria libero (es. "Cliente Mario Rossi WhatsApp 333…")
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    customer_id UUID REFERENCES public.customers_extended(id) ON DELETE SET NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_invites_token ON public.customer_invites(token);
CREATE INDEX IF NOT EXISTS idx_customer_invites_created_by ON public.customer_invites(created_by);
CREATE INDEX IF NOT EXISTS idx_customer_invites_open
    ON public.customer_invites(expires_at)
    WHERE used_at IS NULL AND revoked_at IS NULL;

ALTER TABLE public.customer_invites ENABLE ROW LEVEL SECURITY;

-- Authenticated admin can do everything (create, list, revoke)
DROP POLICY IF EXISTS "customer_invites auth full" ON public.customer_invites;
CREATE POLICY "customer_invites auth full" ON public.customer_invites
    TO authenticated USING (TRUE) WITH CHECK (TRUE);

-- Public/anon CANNOT read or write — the public functions will use the
-- service role to validate/consume tokens. This keeps tokens unguessable.

-- (No public policy on the table; the registration flow goes through Netlify
-- functions that use SUPABASE_SERVICE_ROLE_KEY.)
