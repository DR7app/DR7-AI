-- ============================================================
-- Spese del report (ricorrenti e non ricorrenti)
--
-- Fino a oggi le uniche spese sottratte dal Margine Netto erano le
-- "Spese Fisse Mensili" per VEICOLO (vehicles.metadata.fixed_expenses):
-- una rata auto, un leasing. Mancavano le spese dell'ATTIVITA' — affitto,
-- stipendi, commercialista, una riparazione una tantum.
--
-- Due tipi:
--   ricorrente  → importo mensile, attivo da `dal` fino a `al` (NULL = in
--                 corso). Un affitto partito a marzo NON pesa sul report di
--                 gennaio, e uno chiuso a settembre smette di pesare a ottobre:
--                 i report gia' chiusi non cambiano piu' sotto i piedi.
--   una_tantum  → importo singolo, pesa solo sul periodo che contiene `data`.
--
-- Le spese sono PER BUSINESS (rental / boat_rental / heli_rental /
-- stay_rental / lavaggio / ...): l'affitto del capannone di Terra non deve
-- entrare nel Margine di Mare. Stesso principio del fix 2026-08-24 sulle
-- spese fisse per veicolo.
--
-- Scrittura riservata alla DIREZIONE (richiesta 25/08/2026): queste righe
-- cambiano il Margine Netto dell'intero business.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.report_spese (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business    text NOT NULL,
    tipo        text NOT NULL CHECK (tipo IN ('ricorrente', 'una_tantum')),
    label       text NOT NULL,
    -- EURO lordi (IVA inclusa), come ogni importo digitato dall'admin.
    -- Il report lavora in euro, non in centesimi: vedi formatCurrency.
    amount      numeric(12,2) NOT NULL DEFAULT 0,
    -- ricorrente: primo giorno del mese di partenza / ultimo mese incluso
    dal         date,
    al          date,
    -- una_tantum: quando e' stata sostenuta
    data        date,
    nota        text,
    created_by  text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),

    -- Ogni tipo porta le sue date, altrimenti il calcolo del periodo non sa
    -- dove collocare la spesa.
    CONSTRAINT report_spese_date_coerenti CHECK (
        (tipo = 'ricorrente' AND dal IS NOT NULL AND (al IS NULL OR al >= dal))
        OR
        (tipo = 'una_tantum' AND data IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS report_spese_business_tipo_idx
    ON public.report_spese (business, tipo);
CREATE INDEX IF NOT EXISTS report_spese_data_idx
    ON public.report_spese (data) WHERE tipo = 'una_tantum';

-- ── Chi puo' SCRIVERE ────────────────────────────────────────────────────────
-- Volutamente piu' stretto di dr7_is_direzione(), che include developer e
-- superadmin: qui vale solo la direzione vera. Stesso taglio di
-- dr7_can_see_all_acconti() (migrazione 20260814000000).
CREATE OR REPLACE FUNCTION public.dr7_can_edit_report_spese()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- Failsafe: la direzione non puo' restare chiusa fuori se
    -- admins.permissions viene svuotato. Stesso elenco di ROLE_FAILSAFE in
    -- useAdminRole.ts limitato a chi ha 'direzione' (no ophe: e' developer).
    lower(coalesce(auth.jwt() ->> 'email', '')) IN
      ('valerio@dr7.app', 'ilenia@dr7.app', 'salvatore@dr7.app')
    OR EXISTS (
      SELECT 1
        FROM public.admins a
       WHERE a.user_id = auth.uid()
         AND a.permissions @> '["role:direzione"]'::jsonb
    );
$$;

COMMENT ON FUNCTION public.dr7_can_edit_report_spese() IS
  'Solo direzione (Valerio/Ilenia/Salvatore o tag role:direzione) puo'' creare/modificare/eliminare le spese di report. Volutamente piu stretto di dr7_is_direzione(): esclude developer e superadmin.';

ALTER TABLE public.report_spese ENABLE ROW LEVEL SECURITY;

-- Lettura: ogni admin loggato vede le spese (servono a calcolare il Margine
-- mostrato nel report). Sono dati aziendali, non personali.
DROP POLICY IF EXISTS "report_spese select" ON public.report_spese;
CREATE POLICY "report_spese select"
    ON public.report_spese FOR SELECT TO authenticated USING (true);

-- Scrittura: solo direzione. Il gate UI da solo sarebbe cosmetico — admin e
-- sito condividono lo stesso progetto Supabase, quindi ogni utente loggato
-- ha un token valido e potrebbe scrivere via API.
DROP POLICY IF EXISTS "report_spese insert direzione" ON public.report_spese;
CREATE POLICY "report_spese insert direzione"
    ON public.report_spese FOR INSERT TO authenticated
    WITH CHECK (public.dr7_can_edit_report_spese());

DROP POLICY IF EXISTS "report_spese update direzione" ON public.report_spese;
CREATE POLICY "report_spese update direzione"
    ON public.report_spese FOR UPDATE TO authenticated
    USING (public.dr7_can_edit_report_spese())
    WITH CHECK (public.dr7_can_edit_report_spese());

DROP POLICY IF EXISTS "report_spese delete direzione" ON public.report_spese;
CREATE POLICY "report_spese delete direzione"
    ON public.report_spese FOR DELETE TO authenticated
    USING (public.dr7_can_edit_report_spese());

DROP POLICY IF EXISTS "report_spese service_role" ON public.report_spese;
CREATE POLICY "report_spese service_role"
    ON public.report_spese FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- Verifica
SELECT tablename, policyname, cmd
  FROM pg_policies
 WHERE tablename = 'report_spese'
 ORDER BY cmd, policyname;
