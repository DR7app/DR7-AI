-- 07/11/2026 (direzione): EMTN nella lista prenotazioni, soglie in Centralina Pro.
--
--  1. emtn_score_clienti: l'ultimo EMTN Score calcolato per ogni persona, una
--     riga per id (customers_extended.id e user_id del sito). Lo scrivono
--     SOLO le Netlify Functions con la service role (emtn-search,
--     emtn-score-clienti, emtn-score-ricalcolo ogni 10 minuti), con lo stesso
--     calcolo di EMTN (src/utils/emtnScore/motore.ts). Il punteggio NON si
--     calcola in SQL: le fonti sono troppe e una seconda formula
--     divergerebbe dalla prima. Lo staff lo legge (badge, allarme).
--
--  2. dr7_emtn_score_da_ricalcolare: le schede con codice fiscale mai
--     calcolate o calcolate da piu' di p_ore, per il ricalcolo programmato.
--
--  3. dr7_emtn_soglie(): le soglie di Centralina Pro > EMTN, riga 'main',
--     chiave `emtn` ({"soglia_allarme": 50, "soglia_blocco": 20,
--     "messaggio_blocco": "..."}). Mancanti, vuote, fuori da 1-100 o non
--     numeriche = spente. Di default sono spente: nulla cambia finche' la
--     direzione non le imposta.
--
--  4. Trigger trg_01_emtn_blocco su bookings e pending_nexi_bookings: un
--     cliente del sito con EMTN salvato SOTTO la soglia di blocco non puo'
--     prenotare un noleggio auto (Terra). Stessa forma di
--     sc_blocca_prenotazioni_sito (20260926): solo il ruolo authenticated
--     non staff; lo staff, la service role (nexi-callback DOPO un pagamento
--     riuscito) e una prenotazione con Nexi gia' pagato passano sempre.
--     Registrazione, scheda e documenti non sono toccati. Il sito prova
--     l'INSERT prima del pagamento (verifica_prenotazione_sito), quindi il
--     cliente viene fermato prima di pagare. Il messaggio inizia con
--     'EMTN_BLOCCO:' e il testo dopo e' scritto per il cliente.
--     Nel dubbio si prenota (fail open): nessuna soglia, nessun punteggio
--     salvato (cliente nuovo, straniero senza codice fiscale, mai calcolato),
--     tabella assente o qualunque errore = la prenotazione passa.
--     Il cliente si riconosce solo per id (auth.uid(), user_id della riga e
--     schede customers_extended di quell'account), mai per nome o telefono.
--
--  5. Allarme del catalogo cli_emtn_sotto_soglia (detector emtn_sotto_soglia,
--     src/utils/allarmi/emtnSoglia.ts): noleggio vivo di un cliente sotto la
--     soglia di allarme. Acceso, ma tace finche' la soglia non e' impostata.
--
-- Idempotente. Nessun overload: nomi di funzione nuovi.

-- ── 1. Punteggi salvati ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.emtn_score_clienti (
    persona_id      uuid PRIMARY KEY,
    codice_fiscale  text NOT NULL,
    client_id       uuid,
    score           integer NOT NULL CHECK (score BETWEEN 0 AND 100),
    livello         text NOT NULL,
    band            text NOT NULL,
    blocco          boolean NOT NULL DEFAULT false,
    versione        text NOT NULL,
    calcolato_il    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS emtn_score_clienti_cf_idx ON public.emtn_score_clienti (codice_fiscale);
CREATE INDEX IF NOT EXISTS emtn_score_clienti_score_idx ON public.emtn_score_clienti (score);

ALTER TABLE public.emtn_score_clienti ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS emtn_score_clienti_staff_legge ON public.emtn_score_clienti;
CREATE POLICY emtn_score_clienti_staff_legge ON public.emtn_score_clienti
    FOR SELECT TO authenticated USING (public.dr7_is_staff());
-- Nessuna policy di scrittura: scrive solo la service role.

-- ── 2. Schede da ricalcolare ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dr7_emtn_score_da_ricalcolare(p_limite integer, p_ore integer)
RETURNS TABLE (customer_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ce.id
    FROM public.customers_extended ce
    LEFT JOIN public.emtn_score_clienti s ON s.persona_id = ce.id
   -- Stessa regola di isValidCF (netlify/functions/utils/emtn.ts): un codice
   -- malformato non entra, altrimenti resterebbe in testa per sempre.
   WHERE upper(regexp_replace(coalesce(ce.codice_fiscale, ''), '\s', '', 'g'))
         ~ '^[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]$'
     AND (s.persona_id IS NULL OR s.calcolato_il < now() - make_interval(hours => greatest(coalesce(p_ore, 168), 1)))
   ORDER BY s.calcolato_il NULLS FIRST, ce.id
   LIMIT greatest(least(coalesce(p_limite, 50), 500), 1);
$$;
REVOKE ALL ON FUNCTION public.dr7_emtn_score_da_ricalcolare(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dr7_emtn_score_da_ricalcolare(integer, integer) TO service_role;

-- ── 3. Soglie di Centralina Pro ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dr7_emtn_soglia_valida(p jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p IS NULL OR jsonb_typeof(p) NOT IN ('number', 'string') THEN NULL
    WHEN btrim(p #>> '{}') !~ '^[0-9]{1,3}$' THEN NULL
    WHEN (btrim(p #>> '{}'))::integer BETWEEN 1 AND 100 THEN (btrim(p #>> '{}'))::integer
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.dr7_emtn_soglie()
RETURNS TABLE (soglia_allarme integer, soglia_blocco integer, messaggio_blocco text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.dr7_emtn_soglia_valida(c.config -> 'emtn' -> 'soglia_allarme'),
         public.dr7_emtn_soglia_valida(c.config -> 'emtn' -> 'soglia_blocco'),
         nullif(btrim(coalesce(c.config -> 'emtn' ->> 'messaggio_blocco', '')), '')
    FROM public.centralina_pro_config c
   WHERE c.id = 'main'
     AND jsonb_typeof(c.config -> 'emtn') = 'object';
$$;
REVOKE ALL ON FUNCTION public.dr7_emtn_soglie() FROM PUBLIC, anon, authenticated;

-- ── 4. Blocco delle prenotazioni dal sito ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.dr7_emtn_blocca_prenotazione_sito()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ruolo        text := coalesce(auth.jwt() ->> 'role', '');
  v_service_type text;
  v_user_riga    text;
  v_ids          uuid[];
  v_soglia       integer;
  v_messaggio    text;
  v_score        integer;
BEGIN
  -- Solo clienti con un account: senza id non si sa chi e' (si prenota).
  -- Service role (nexi-callback dopo il pagamento) e SQL diretto passano.
  IF v_ruolo <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  BEGIN
    IF public.dr7_is_staff() THEN
      RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'pending_nexi_bookings' THEN
      v_service_type := NEW.booking_data ->> 'service_type';
      v_user_riga := NEW.booking_data ->> 'user_id';
    ELSE
      v_service_type := NEW.service_type;
      v_user_riga := NEW.user_id::text;
      -- Pagamento Nexi gia' concluso: il cliente ha pagato, si registra.
      IF NEW.nexi_order_id IS NOT NULL
         AND lower(coalesce(NEW.payment_status, '')) IN ('paid', 'succeeded', 'completed') THEN
        RETURN NEW;
      END IF;
    END IF;

    -- Solo il noleggio auto (Terra): mare, aria, soggiorni, lavaggio e
    -- meccanica non sono toccati.
    IF lower(coalesce(v_service_type, '')) IN ('boat_rental', 'heli_rental', 'stay_rental', 'car_wash', 'uscita_straordinaria', 'varie')
       OR lower(coalesce(v_service_type, '')) LIKE 'mechanical%' THEN
      RETURN NEW;
    END IF;

    SELECT s.soglia_blocco, s.messaggio_blocco INTO v_soglia, v_messaggio FROM public.dr7_emtn_soglie() s;
    IF v_soglia IS NULL THEN
      RETURN NEW;
    END IF;

    v_ids := array_remove(ARRAY[
      auth.uid(),
      CASE WHEN v_user_riga ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN v_user_riga::uuid END
    ], NULL);
    IF coalesce(array_length(v_ids, 1), 0) = 0 THEN
      RETURN NEW;
    END IF;
    -- Le schede del gestionale di quell'account (stessa persona, per id).
    v_ids := v_ids || coalesce((SELECT array_agg(ce.id) FROM public.customers_extended ce WHERE ce.user_id = ANY (v_ids)), '{}'::uuid[]);

    SELECT min(e.score) INTO v_score FROM public.emtn_score_clienti e WHERE e.persona_id = ANY (v_ids);
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;   -- nel dubbio si prenota
  END;

  IF v_score IS NOT NULL AND v_score < v_soglia THEN
    RAISE EXCEPTION 'EMTN_BLOCCO: %',
      coalesce(v_messaggio, 'Non e'' possibile completare la prenotazione online. Contatta DR7 e ti aiuteremo a completare il noleggio.')
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.dr7_emtn_blocca_prenotazione_sito() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_01_emtn_blocco ON public.bookings;
CREATE TRIGGER trg_01_emtn_blocco
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.dr7_emtn_blocca_prenotazione_sito();

DROP TRIGGER IF EXISTS trg_01_emtn_blocco ON public.pending_nexi_bookings;
CREATE TRIGGER trg_01_emtn_blocco
  BEFORE INSERT ON public.pending_nexi_bookings
  FOR EACH ROW EXECUTE FUNCTION public.dr7_emtn_blocca_prenotazione_sito();

-- ── 5. Allarme del catalogo ─────────────────────────────────────────────────
-- Soglia della riga = non usata (la soglia e' quella di Centralina Pro > EMTN).
INSERT INTO public.system_alarms
    (id, label, schedule, reason, category, threshold_value, threshold_unit, is_enabled, sort_order,
     group_key, priority, reparto, detector, stato_rilevamento, ripeti_finche_non_risolto, ripeti_ogni_minuti,
     notifica_gestionale, notifica_push, notifica_whatsapp_interna, notifica_email_interna, destinatari,
     sound_key, suono_continuo, messaggio_cliente_auto)
VALUES
    ('cli_emtn_sotto_soglia', 'Cliente sotto la soglia EMTN', 'Alla prenotazione',
     'Il cliente di un noleggio in corso o futuro ha un EMTN Score sotto la soglia di allarme impostata in Centralina Pro > EMTN.',
     'booking', 0, 'minutes_before', true, 2486, 'prenotazioni', 'urgente', 'Front Office',
     'emtn_sotto_soglia', 'attivo', false, 30, true, false, false, false, '[]'::jsonb, 'classic', true, false)
ON CONFLICT (id) DO NOTHING;
