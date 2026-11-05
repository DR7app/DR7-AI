-- ============================================================================
-- PREVENDITE: STORICO DELLE MODIFICHE AL CATALOGO (05/11/2026)
--
-- Da eseguire a mano nel SQL editor. Rilanciabile. Il gestionale funziona
-- anche prima: la lista "Storico modifiche" resta semplicemente nascosta.
--
-- Perche': il 27/10 la prevendita "Macan gts Runchina" e' passata da 1 a 2
-- utilizzi inclusi tra due acquisti a 3 minuti di distanza (22:21 -> 1,
-- 22:24 -> 2). L'acquisto fotografa le condizioni in prevendite_clienti (by
-- design, resta cosi'), ma del catalogo non c'era nessuno storico: impossibile
-- sapere chi l'aveva cambiato e quando.
--
-- 1. Tabella `prevendite_catalogo_storico`: una riga per ogni INSERT, UPDATE e
--    DELETE sul catalogo `prevendite`, con chi (auth.uid(), email, nome
--    operatore), quando, e cosa: `modifiche` = { campo: {da, a} }, piu' la riga
--    intera prima/dopo in `vecchio` / `nuovo`.
-- 2. Trigger AFTER su `prevendite`. Gli UPDATE che toccano SOLO posti_venduti
--    e updated_at NON vengono registrati: sono gli acquisti (Nexi, wallet,
--    sportello), non modifiche del catalogo.
--    Il trigger e' protetto: un suo errore NON deve mai far fallire un
--    acquisto o un salvataggio (RAISE WARNING e si va avanti).
-- 3. RLS: la legge solo lo staff (stesso predicato delle policy del catalogo:
--    dr7_admin_id() / dr7_is_direzione()). Nessuno scrive da client: scrive
--    solo il trigger (SECURITY DEFINER).
-- ============================================================================

DO $$
BEGIN
  IF to_regprocedure('public.dr7_is_direzione()') IS NULL
     OR to_regprocedure('public.dr7_admin_id()') IS NULL THEN
    RAISE EXCEPTION 'Mancano dr7_is_direzione() / dr7_admin_id(): applica prima la migrazione 20260809020000_rls_acconti_report_overrides.sql';
  END IF;
  IF to_regclass('public.prevendite') IS NULL THEN
    RAISE EXCEPTION 'Manca la tabella prevendite: applica prima 20260914000000_prevendite.sql';
  END IF;
END $$;

-- ── 1. Tabella ─────────────────────────────────────────────────────────────
-- prevendita_id senza FK: lo storico deve sopravvivere all'eliminazione della
-- prevendita dal catalogo (e' proprio li' che serve di piu').
CREATE TABLE IF NOT EXISTS public.prevendite_catalogo_storico (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prevendita_id     UUID NOT NULL,
  prevendita_nome   TEXT,
  azione            TEXT NOT NULL CHECK (azione IN ('insert', 'update', 'delete')),
  modifiche         JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { campo: { "da": ..., "a": ... } }
  vecchio           JSONB,
  nuovo             JSONB,
  changed_by        UUID,
  changed_by_email  TEXT,
  changed_by_nome   TEXT,
  ruolo_db          TEXT,                                 -- authenticated / service_role / postgres (SQL editor)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prevendite_catalogo_storico_prevendita
  ON public.prevendite_catalogo_storico (prevendita_id, created_at DESC);

-- ── 2. Trigger ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prevendite_catalogo_registra()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Campi che cambiano ad ogni acquisto: non sono modifiche del catalogo.
  v_ignorati  TEXT[] := ARRAY['posti_venduti', 'updated_at'];
  v_vecchio   JSONB;
  v_nuovo     JSONB;
  v_modifiche JSONB := '{}'::jsonb;
  v_chiave    TEXT;
  v_uid       UUID;
  v_email     TEXT;
  v_nome      TEXT;
  v_ruolo     TEXT;
  v_id        UUID;
  v_nome_prev TEXT;
BEGIN
  BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN v_vecchio := to_jsonb(OLD); END IF;
    IF TG_OP IN ('UPDATE', 'INSERT') THEN v_nuovo := to_jsonb(NEW); END IF;

    IF TG_OP = 'UPDATE' THEN
      FOR v_chiave IN
        SELECT k FROM (
          SELECT jsonb_object_keys(v_nuovo) AS k
          UNION
          SELECT jsonb_object_keys(v_vecchio)
        ) chiavi
      LOOP
        CONTINUE WHEN v_chiave = ANY (v_ignorati);
        IF (v_vecchio -> v_chiave) IS DISTINCT FROM (v_nuovo -> v_chiave) THEN
          v_modifiche := v_modifiche || jsonb_build_object(
            v_chiave, jsonb_build_object('da', v_vecchio -> v_chiave, 'a', v_nuovo -> v_chiave));
        END IF;
      END LOOP;
      -- Solo posti_venduti / updated_at: e' un acquisto, non si registra.
      IF v_modifiche = '{}'::jsonb THEN
        RETURN NULL;
      END IF;
    END IF;

    v_id        := COALESCE((v_nuovo ->> 'id'), (v_vecchio ->> 'id'))::uuid;
    v_nome_prev := COALESCE(v_nuovo ->> 'nome', v_vecchio ->> 'nome');

    -- Chi: ognuna di queste letture e' facoltativa, nessuna puo' bloccare.
    BEGIN v_uid := auth.uid(); EXCEPTION WHEN OTHERS THEN v_uid := NULL; END;
    BEGIN v_email := NULLIF(auth.jwt() ->> 'email', ''); EXCEPTION WHEN OTHERS THEN v_email := NULL; END;
    IF v_email IS NULL AND v_uid IS NOT NULL THEN
      BEGIN
        EXECUTE 'SELECT email::text FROM auth.users WHERE id = $1' INTO v_email USING v_uid;
      EXCEPTION WHEN OTHERS THEN v_email := NULL; END;
    END IF;
    IF v_uid IS NOT NULL THEN
      BEGIN
        EXECUTE 'SELECT nome::text FROM public.admins WHERE user_id = $1 LIMIT 1' INTO v_nome USING v_uid;
      EXCEPTION WHEN OTHERS THEN v_nome := NULL; END;
    END IF;
    BEGIN
      v_ruolo := COALESCE(
        NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
        NULLIF(current_setting('request.jwt.claim.role', true), ''),
        session_user::text);
    EXCEPTION WHEN OTHERS THEN v_ruolo := session_user::text; END;

    INSERT INTO public.prevendite_catalogo_storico
      (prevendita_id, prevendita_nome, azione, modifiche, vecchio, nuovo,
       changed_by, changed_by_email, changed_by_nome, ruolo_db)
    VALUES
      (v_id, v_nome_prev, lower(TG_OP), v_modifiche, v_vecchio, v_nuovo,
       v_uid, v_email, v_nome, v_ruolo);
  EXCEPTION WHEN OTHERS THEN
    -- Lo storico non deve MAI far fallire un salvataggio o un acquisto.
    RAISE WARNING '[prevendite] storico catalogo non registrato (% su %): %', TG_OP, COALESCE(v_id::text, '?'), SQLERRM;
  END;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.prevendite_catalogo_registra() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_prevendite_catalogo_storico ON public.prevendite;
CREATE TRIGGER trg_prevendite_catalogo_storico
  AFTER INSERT OR UPDATE OR DELETE ON public.prevendite
  FOR EACH ROW EXECUTE FUNCTION public.prevendite_catalogo_registra();

-- ── 3. RLS e permessi ──────────────────────────────────────────────────────
ALTER TABLE public.prevendite_catalogo_storico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prevendite_catalogo_storico_select_staff ON public.prevendite_catalogo_storico;
CREATE POLICY prevendite_catalogo_storico_select_staff ON public.prevendite_catalogo_storico
  FOR SELECT TO authenticated
  USING (public.dr7_admin_id() IS NOT NULL OR public.dr7_is_direzione());

-- Nessuna policy di scrittura: con RLS attiva nessun client puo' inserire,
-- modificare o cancellare. In piu' si tolgono i permessi di tabella.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.prevendite_catalogo_storico FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.prevendite_catalogo_storico FROM anon;
GRANT SELECT ON public.prevendite_catalogo_storico TO authenticated;
GRANT SELECT, INSERT ON public.prevendite_catalogo_storico TO service_role;

-- ── 4. Verifica ────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_prevendite_catalogo_storico' AND NOT tgisinternal) AS trigger_installato,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.prevendite_catalogo_storico'::regclass) AS rls_attiva,
  (SELECT count(*) FROM public.prevendite_catalogo_storico) AS righe_storico;
