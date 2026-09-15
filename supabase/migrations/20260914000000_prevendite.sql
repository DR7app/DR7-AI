-- ============================================================================
-- PREVENDITE DR7 (14/09/2026)
--
-- Una prevendita e' un pacchetto di utilizzi gia' pagati: il cliente compra
-- oggi (es. "Ferrari 296 GTB - 10 Experience", 2.900 EUR, 10 utilizzi, 100 km
-- per utilizzo, 12 mesi) e guida quando vuole nei mesi successivi.
--
-- Tre tabelle:
--   prevendite            -> il CATALOGO, creato dal gestionale
--   prevendite_clienti    -> il pacchetto ACQUISTATO da un cliente. Fotografa
--                            le regole al momento dell'acquisto: se domani la
--                            direzione cambia il catalogo, chi ha gia' comprato
--                            tiene le condizioni che ha pagato.
--   prevendite_movimenti  -> ogni scalo / ripristino / rettifica, con la
--                            prenotazione collegata. E' il registro: i residui
--                            si spiegano sempre riga per riga.
--
-- I vincoli (utilizzi al mese, giorni consecutivi, scadenza, veicoli ammessi)
-- si impostano nel gestionale e si controllano QUI, in database: il sito non
-- puo' farli saltare, nemmeno chiamando l'API a mano.
-- ============================================================================

-- ── 0. CONTROLLO PRELIMINARE ────────────────────────────────────────────────
-- Le policy qui sotto poggiano su dr7_is_direzione() e dr7_admin_id(), create
-- dalla migrazione 20260809020000. Se mancano, meglio un messaggio chiaro
-- adesso che una policy a meta' e un errore incomprensibile dopo.
DO $$
BEGIN
  IF to_regprocedure('public.dr7_is_direzione()') IS NULL
     OR to_regprocedure('public.dr7_admin_id()') IS NULL THEN
    RAISE EXCEPTION 'Mancano dr7_is_direzione() / dr7_admin_id(): applica prima la migrazione 20260809020000_rls_acconti_report_overrides.sql';
  END IF;
END
$$;

-- ── 1. CATALOGO ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prevendite (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                  TEXT NOT NULL,
  descrizione           TEXT,
  foto_url              TEXT,
  prezzo                NUMERIC(10,2) NOT NULL DEFAULT 0,
  -- Prezzo di listino equivalente: serve solo a mostrare il vantaggio in %.
  prezzo_listino        NUMERIC(10,2),
  utilizzi_inclusi      INTEGER NOT NULL DEFAULT 1,
  -- [{ id, nome, targa }] — id = vehicles.id del gestionale.
  veicoli               JSONB NOT NULL DEFAULT '[]'::jsonb,
  km_inclusi            INTEGER NOT NULL DEFAULT 0,   -- per OGNI utilizzo
  assicurazione_inclusa TEXT,                          -- etichetta/id opzione
  validita_mesi         INTEGER NOT NULL DEFAULT 12,
  max_utilizzi_mese     INTEGER,                       -- NULL = nessun limite
  max_giorni_consecutivi INTEGER,                      -- NULL = nessun limite
  regole_extra          TEXT,                          -- altri vincoli, testo libero
  -- Disponibilita' limitata: NULL = illimitata.
  posti_totali          INTEGER,
  posti_venduti         INTEGER NOT NULL DEFAULT 0,
  attiva                BOOLEAN NOT NULL DEFAULT TRUE,
  visibile_sito         BOOLEAN NOT NULL DEFAULT TRUE,
  ordine                INTEGER NOT NULL DEFAULT 0,
  business              TEXT NOT NULL DEFAULT 'terra',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN public.prevendite.km_inclusi IS
  'Km compresi in OGNI utilizzo, non nell''intero pacchetto.';
COMMENT ON COLUMN public.prevendite.veicoli IS
  'Veicoli su cui la prevendita e'' spendibile: [{id,nome,targa}], id = vehicles.id.';

-- ── 2. PACCHETTI ACQUISTATI ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prevendite_clienti (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prevendita_id         UUID REFERENCES public.prevendite(id) ON DELETE SET NULL,
  user_id               UUID,
  customer_email        TEXT,
  customer_nome         TEXT,
  customer_telefono     TEXT,

  -- Fotografia delle condizioni pagate.
  nome                  TEXT NOT NULL,
  foto_url              TEXT,
  prezzo_pagato         NUMERIC(10,2) NOT NULL DEFAULT 0,
  utilizzi_iniziali     INTEGER NOT NULL DEFAULT 0,
  utilizzi_usati        INTEGER NOT NULL DEFAULT 0,
  veicoli               JSONB NOT NULL DEFAULT '[]'::jsonb,
  km_inclusi            INTEGER NOT NULL DEFAULT 0,
  assicurazione_inclusa TEXT,
  max_utilizzi_mese     INTEGER,
  max_giorni_consecutivi INTEGER,
  regole_extra          TEXT,

  data_acquisto         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data_scadenza         TIMESTAMPTZ,
  -- attiva | terminata | scaduta | bloccata
  stato                 TEXT NOT NULL DEFAULT 'attiva',

  payment_status        TEXT NOT NULL DEFAULT 'pending',
  payment_method        TEXT,
  nexi_order_id         TEXT,
  payment_completed_at  TIMESTAMPTZ,

  -- Dati fattura: la prevendita si paga, quindi si fattura.
  customer_codice_fiscale TEXT,
  customer_indirizzo    TEXT,
  customer_numero_civico TEXT,
  customer_citta        TEXT,
  customer_cap          TEXT,
  customer_provincia    TEXT,

  origine               TEXT NOT NULL DEFAULT 'sito',  -- sito | gestionale
  note_admin            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT prevendite_clienti_stato_chk
    CHECK (stato IN ('attiva', 'terminata', 'scaduta', 'bloccata'))
);

CREATE INDEX IF NOT EXISTS idx_prevendite_clienti_user   ON public.prevendite_clienti(user_id);
CREATE INDEX IF NOT EXISTS idx_prevendite_clienti_email  ON public.prevendite_clienti(lower(customer_email));
CREATE INDEX IF NOT EXISTS idx_prevendite_clienti_nexi   ON public.prevendite_clienti(nexi_order_id);
CREATE INDEX IF NOT EXISTS idx_prevendite_clienti_stato  ON public.prevendite_clienti(stato);

-- ── 3. REGISTRO MOVIMENTI ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prevendite_movimenti (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prevendita_cliente_id UUID NOT NULL REFERENCES public.prevendite_clienti(id) ON DELETE CASCADE,
  booking_id            UUID,
  -- scalo = utilizzo consumato, ripristino = rimesso a disposizione,
  -- rettifica = correzione manuale della direzione.
  tipo                  TEXT NOT NULL DEFAULT 'scalo',
  quantita              INTEGER NOT NULL DEFAULT 1,
  data_inizio           DATE,
  data_fine             DATE,
  giorni                INTEGER,
  km_inclusi            INTEGER,
  veicolo_nome          TEXT,
  annullato             BOOLEAN NOT NULL DEFAULT FALSE,
  note                  TEXT,
  creato_da             TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT prevendite_movimenti_tipo_chk
    CHECK (tipo IN ('scalo', 'ripristino', 'rettifica'))
);

CREATE INDEX IF NOT EXISTS idx_prevendite_mov_pacchetto ON public.prevendite_movimenti(prevendita_cliente_id);
CREATE INDEX IF NOT EXISTS idx_prevendite_mov_booking   ON public.prevendite_movimenti(booking_id);

-- Uno scalo per prenotazione: se la stessa conferma arriva due volte (browser
-- + webhook Nexi) l'utilizzo si toglie una volta sola.
CREATE UNIQUE INDEX IF NOT EXISTS idx_prevendite_mov_scalo_unico
  ON public.prevendite_movimenti(booking_id)
  WHERE tipo = 'scalo' AND booking_id IS NOT NULL;

-- ── 4. IMPOSTAZIONI (popup del sito e testi) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.prevendite_settings (
  id          TEXT PRIMARY KEY DEFAULT 'main',
  config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.prevendite_settings (id, config)
VALUES ('main', jsonb_build_object(
  'popup_attivo', true,
  'popup_titolo', 'PREVENDITE DR7',
  'popup_sottotitolo', 'Acquista oggi. Guida quando vuoi nei prossimi 12 mesi.',
  'popup_testo', 'Offerte esclusive con vantaggi fino al 90% rispetto alle tariffe ordinarie.',
  'popup_nota', 'Disponibilita'' limitata.',
  'popup_cta', 'SCOPRI E ACQUISTA',
  'popup_giorni_ricomparsa', 7,
  'pagina_titolo', 'PREVENDITE DR7',
  'pagina_sottotitolo', 'Acquista oggi. Guida quando vuoi nei prossimi 12 mesi.'
))
ON CONFLICT (id) DO NOTHING;

-- ── 5. updated_at ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prevendite_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevendite_touch ON public.prevendite;
CREATE TRIGGER trg_prevendite_touch BEFORE UPDATE ON public.prevendite
  FOR EACH ROW EXECUTE FUNCTION public.prevendite_touch_updated_at();

DROP TRIGGER IF EXISTS trg_prevendite_clienti_touch ON public.prevendite_clienti;
CREATE TRIGGER trg_prevendite_clienti_touch BEFORE UPDATE ON public.prevendite_clienti
  FOR EACH ROW EXECUTE FUNCTION public.prevendite_touch_updated_at();

-- ── 6. STATO REALE ─────────────────────────────────────────────────────────
-- `stato` in tabella e' quello deciso dalla direzione (bloccata) o dal
-- consumo (terminata). La scadenza invece passa da sola: la si calcola
-- sempre, cosi' nessun cron dimenticato lascia in giro pacchetti scaduti
-- ancora spendibili.
CREATE OR REPLACE FUNCTION public.prevendita_stato_reale(pc public.prevendite_clienti)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN pc.stato = 'bloccata' THEN 'bloccata'
    WHEN pc.payment_status NOT IN ('paid','completed','succeeded') THEN 'bloccata'
    WHEN pc.data_scadenza IS NOT NULL AND pc.data_scadenza < NOW() THEN 'scaduta'
    WHEN pc.utilizzi_usati >= pc.utilizzi_iniziali THEN 'terminata'
    ELSE 'attiva'
  END;
$$;


-- Chi puo' toccare un pacchetto: il cliente a cui appartiene, un operatore del
-- gestionale, oppure il server (service_role, che non ha ne' auth.uid() ne'
-- email nel token). Senza questo controllo una funzione SECURITY DEFINER
-- aperta a `authenticated` lascerebbe scalare gli utilizzi altrui.
CREATE OR REPLACE FUNCTION public.prevendita_accesso_consentito(pc public.prevendite_clienti)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NULL
      OR pc.user_id = auth.uid()
      OR lower(coalesce(pc.customer_email,'')) = lower(coalesce(auth.jwt() ->> 'email',''))
      OR public.dr7_admin_id() IS NOT NULL
      OR public.dr7_is_direzione();
$$;

-- Solo gestionale: ripristini e rettifiche non sono mai del cliente.
CREATE OR REPLACE FUNCTION public.prevendita_e_gestionale()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NULL
      OR public.dr7_admin_id() IS NOT NULL
      OR public.dr7_is_direzione();
$$;

-- ── 7. VERIFICA VINCOLI ────────────────────────────────────────────────────
-- Ritorna { ok, errore, utilizzi_residui, giorni, ... }. La usano il sito
-- (prima di far scegliere le date) e prevendita_usa (prima di scalare).
CREATE OR REPLACE FUNCTION public.prevendita_verifica(
  p_prevendita_cliente_id UUID,
  p_data_inizio           DATE,
  p_data_fine             DATE,
  p_vehicle_id            TEXT DEFAULT NULL,
  p_veicolo_nome          TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pc        public.prevendite_clienti%ROWTYPE;
  v_stato   TEXT;
  v_residui INTEGER;
  v_giorni  INTEGER;
  v_mese    INTEGER;
  v_ok_veicolo BOOLEAN;
BEGIN
  SELECT * INTO pc FROM public.prevendite_clienti WHERE id = p_prevendita_cliente_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Prevendita non trovata');
  END IF;
  IF NOT public.prevendita_accesso_consentito(pc) THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Prevendita non trovata');
  END IF;

  v_stato   := public.prevendita_stato_reale(pc);
  v_residui := GREATEST(0, pc.utilizzi_iniziali - pc.utilizzi_usati);

  IF pc.payment_status NOT IN ('paid','completed','succeeded') THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Prevendita non ancora attiva: pagamento in corso', 'stato', 'in_attesa');
  END IF;
  IF v_stato = 'bloccata' THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Prevendita bloccata: contatta DR7', 'stato', v_stato);
  END IF;
  IF v_stato = 'scaduta' THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Prevendita scaduta il ' || to_char(pc.data_scadenza, 'DD/MM/YYYY'), 'stato', v_stato);
  END IF;
  IF v_residui <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Utilizzi esauriti', 'stato', 'terminata', 'utilizzi_residui', 0);
  END IF;

  -- Veicolo ammesso. Si accetta l'id (vehicles.id) OPPURE il nome: sul sito
  -- le auto identiche stanno in gruppo e chi ha creato il pacchetto puo' aver
  -- scelto solo uno degli esemplari.
  IF (p_vehicle_id IS NOT NULL OR p_veicolo_nome IS NOT NULL) AND jsonb_array_length(pc.veicoli) > 0 THEN
    SELECT EXISTS (
      SELECT 1 FROM jsonb_array_elements(pc.veicoli) v
       WHERE (p_vehicle_id IS NOT NULL AND v->>'id' = p_vehicle_id)
          OR (p_veicolo_nome IS NOT NULL
              AND lower(regexp_replace(coalesce(v->>'nome',''), '[^a-zA-Z0-9]+', ' ', 'g')) =
                  lower(regexp_replace(p_veicolo_nome,              '[^a-zA-Z0-9]+', ' ', 'g')))
    ) INTO v_ok_veicolo;
    IF NOT v_ok_veicolo THEN
      RETURN jsonb_build_object('ok', false, 'errore', 'Questa prevendita non vale per il veicolo scelto', 'stato', v_stato);
    END IF;
  END IF;

  IF p_data_inizio IS NULL OR p_data_fine IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'stato', v_stato, 'utilizzi_residui', v_residui);
  END IF;

  -- La prenotazione deve stare dentro la validita' del pacchetto.
  IF pc.data_scadenza IS NOT NULL AND p_data_fine > pc.data_scadenza::date THEN
    RETURN jsonb_build_object('ok', false,
      'errore', 'La prevendita scade il ' || to_char(pc.data_scadenza, 'DD/MM/YYYY') || ': scegli date precedenti',
      'stato', v_stato, 'utilizzi_residui', v_residui);
  END IF;

  -- Giorni consecutivi: 1 giorno = stesso giorno di ritiro e riconsegna.
  v_giorni := GREATEST(1, (p_data_fine - p_data_inizio));
  IF pc.max_giorni_consecutivi IS NOT NULL AND v_giorni > pc.max_giorni_consecutivi THEN
    RETURN jsonb_build_object('ok', false,
      'errore', 'Massimo ' || pc.max_giorni_consecutivi || ' giorni consecutivi per utilizzo (ne hai scelti ' || v_giorni || ')',
      'stato', v_stato, 'utilizzi_residui', v_residui, 'giorni', v_giorni);
  END IF;

  -- Utilizzi nel mese di ritiro (gli scali annullati non contano).
  IF pc.max_utilizzi_mese IS NOT NULL THEN
    SELECT COALESCE(SUM(m.quantita), 0) INTO v_mese
      FROM public.prevendite_movimenti m
     WHERE m.prevendita_cliente_id = pc.id
       AND m.tipo = 'scalo'
       AND m.annullato = FALSE
       AND m.data_inizio IS NOT NULL
       AND date_trunc('month', m.data_inizio) = date_trunc('month', p_data_inizio);
    IF v_mese >= pc.max_utilizzi_mese THEN
      RETURN jsonb_build_object('ok', false,
        'errore', 'Hai gia'' usato ' || v_mese || ' utilizzi in ' || to_char(p_data_inizio, 'MM/YYYY') ||
                  ': il massimo e'' ' || pc.max_utilizzi_mese || ' al mese',
        'stato', v_stato, 'utilizzi_residui', v_residui, 'utilizzi_mese', v_mese);
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'stato', v_stato,
    'utilizzi_residui', v_residui, 'giorni', v_giorni, 'km_inclusi', pc.km_inclusi);
END;
$$;

-- ── 8. SCALO ───────────────────────────────────────────────────────────────
-- Idempotente sulla prenotazione: il browser e il webhook Nexi possono
-- chiamarla tutti e due, l'utilizzo si toglie una volta sola.
CREATE OR REPLACE FUNCTION public.prevendita_usa(
  p_prevendita_cliente_id UUID,
  p_booking_id            UUID,
  p_data_inizio           DATE,
  p_data_fine             DATE,
  p_vehicle_id            TEXT DEFAULT NULL,
  p_veicolo_nome          TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pc        public.prevendite_clienti%ROWTYPE;
  v_check   JSONB;
  v_exists  UUID;
  v_residui INTEGER;
BEGIN
  IF p_booking_id IS NOT NULL THEN
    SELECT id INTO v_exists FROM public.prevendite_movimenti
     WHERE booking_id = p_booking_id AND tipo = 'scalo' LIMIT 1;
    IF v_exists IS NOT NULL THEN
      SELECT * INTO pc FROM public.prevendite_clienti WHERE id = p_prevendita_cliente_id;
      RETURN jsonb_build_object('ok', true, 'gia_scalato', true,
        'utilizzi_residui', GREATEST(0, pc.utilizzi_iniziali - pc.utilizzi_usati));
    END IF;
  END IF;

  -- Lock: due conferme in parallelo non possono sfondare il residuo.
  SELECT * INTO pc FROM public.prevendite_clienti
   WHERE id = p_prevendita_cliente_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Prevendita non trovata');
  END IF;
  IF NOT public.prevendita_accesso_consentito(pc) THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Prevendita non trovata');
  END IF;

  v_check := public.prevendita_verifica(p_prevendita_cliente_id, p_data_inizio, p_data_fine, p_vehicle_id, p_veicolo_nome);
  IF NOT (v_check->>'ok')::boolean THEN
    RETURN v_check;
  END IF;

  INSERT INTO public.prevendite_movimenti
    (prevendita_cliente_id, booking_id, tipo, quantita, data_inizio, data_fine, giorni, km_inclusi, veicolo_nome, creato_da)
  VALUES
    (pc.id, p_booking_id, 'scalo', 1, p_data_inizio, p_data_fine,
     GREATEST(1, (p_data_fine - p_data_inizio)), pc.km_inclusi, p_veicolo_nome, 'sistema');

  UPDATE public.prevendite_clienti
     SET utilizzi_usati = utilizzi_usati + 1,
         stato = CASE WHEN stato = 'bloccata' THEN 'bloccata'
                      WHEN utilizzi_usati + 1 >= utilizzi_iniziali THEN 'terminata'
                      ELSE 'attiva' END
   WHERE id = pc.id;

  SELECT GREATEST(0, utilizzi_iniziali - utilizzi_usati) INTO v_residui
    FROM public.prevendite_clienti WHERE id = pc.id;

  RETURN jsonb_build_object('ok', true, 'utilizzi_residui', v_residui);
END;
$$;

-- ── 9. RIPRISTINO ──────────────────────────────────────────────────────────
-- L'annullamento NON restituisce l'utilizzo da solo: lo decide la direzione
-- dal gestionale, prenotazione per prenotazione.
CREATE OR REPLACE FUNCTION public.prevendita_ripristina(
  p_movimento_id UUID,
  p_note         TEXT DEFAULT NULL,
  p_creato_da    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m  public.prevendite_movimenti%ROWTYPE;
  pc public.prevendite_clienti%ROWTYPE;
BEGIN
  IF NOT public.prevendita_e_gestionale() THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Operazione riservata al gestionale');
  END IF;
  SELECT * INTO m FROM public.prevendite_movimenti WHERE id = p_movimento_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Movimento non trovato');
  END IF;
  IF m.tipo <> 'scalo' THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Si ripristina solo uno scalo');
  END IF;
  IF m.annullato THEN
    RETURN jsonb_build_object('ok', true, 'gia_ripristinato', true);
  END IF;

  UPDATE public.prevendite_movimenti SET annullato = TRUE WHERE id = m.id;

  INSERT INTO public.prevendite_movimenti
    (prevendita_cliente_id, booking_id, tipo, quantita, data_inizio, data_fine, note, creato_da)
  VALUES
    (m.prevendita_cliente_id, m.booking_id, 'ripristino', m.quantita, m.data_inizio, m.data_fine,
     COALESCE(p_note, 'Utilizzo ripristinato'), COALESCE(p_creato_da, 'gestionale'));

  UPDATE public.prevendite_clienti
     SET utilizzi_usati = GREATEST(0, utilizzi_usati - m.quantita),
         stato = CASE WHEN stato = 'bloccata' THEN 'bloccata' ELSE 'attiva' END
   WHERE id = m.prevendita_cliente_id;

  SELECT * INTO pc FROM public.prevendite_clienti WHERE id = m.prevendita_cliente_id;
  RETURN jsonb_build_object('ok', true,
    'utilizzi_residui', GREATEST(0, pc.utilizzi_iniziali - pc.utilizzi_usati));
END;
$$;

-- ── 10. RETTIFICA MANUALE ──────────────────────────────────────────────────
-- La direzione imposta il residuo che vuole; la differenza resta scritta nel
-- registro, cosi' il numero e' sempre spiegabile.
CREATE OR REPLACE FUNCTION public.prevendita_rettifica(
  p_prevendita_cliente_id UUID,
  p_utilizzi_residui      INTEGER,
  p_note                  TEXT DEFAULT NULL,
  p_creato_da             TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pc         public.prevendite_clienti%ROWTYPE;
  v_nuovi_usati INTEGER;
  v_delta    INTEGER;
BEGIN
  IF NOT public.prevendita_e_gestionale() THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Operazione riservata al gestionale');
  END IF;
  SELECT * INTO pc FROM public.prevendite_clienti WHERE id = p_prevendita_cliente_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Prevendita non trovata');
  END IF;

  v_nuovi_usati := GREATEST(0, pc.utilizzi_iniziali - GREATEST(0, p_utilizzi_residui));
  v_delta := v_nuovi_usati - pc.utilizzi_usati;

  INSERT INTO public.prevendite_movimenti
    (prevendita_cliente_id, tipo, quantita, note, creato_da)
  VALUES
    (pc.id, 'rettifica', v_delta,
     COALESCE(p_note, 'Residui portati a ' || GREATEST(0, p_utilizzi_residui)),
     COALESCE(p_creato_da, 'gestionale'));

  UPDATE public.prevendite_clienti
     SET utilizzi_usati = v_nuovi_usati,
         stato = CASE WHEN stato = 'bloccata' THEN 'bloccata'
                      WHEN v_nuovi_usati >= utilizzi_iniziali THEN 'terminata'
                      ELSE 'attiva' END
   WHERE id = pc.id;

  RETURN jsonb_build_object('ok', true, 'utilizzi_residui', GREATEST(0, p_utilizzi_residui));
END;
$$;

-- ── 11. ATTIVAZIONE DOPO IL PAGAMENTO ──────────────────────────────────────
-- Chiamata dal callback Nexi (e dal gestionale per le vendite allo sportello).
-- Idempotente: se il pacchetto e' gia' pagato non tocca niente.
CREATE OR REPLACE FUNCTION public.prevendita_attiva_pagamento(
  p_prevendita_cliente_id UUID,
  p_payment_method        TEXT DEFAULT 'nexi'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pc public.prevendite_clienti%ROWTYPE;
  v_mesi INTEGER;
BEGIN
  SELECT * INTO pc FROM public.prevendite_clienti WHERE id = p_prevendita_cliente_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Prevendita non trovata');
  END IF;
  IF pc.payment_status IN ('paid','completed','succeeded') THEN
    RETURN jsonb_build_object('ok', true, 'gia_attiva', true);
  END IF;

  SELECT COALESCE(p.validita_mesi, 12) INTO v_mesi
    FROM public.prevendite p WHERE p.id = pc.prevendita_id;
  IF v_mesi IS NULL THEN v_mesi := 12; END IF;

  UPDATE public.prevendite_clienti
     SET payment_status = 'succeeded',
         payment_method = COALESCE(p_payment_method, payment_method),
         payment_completed_at = NOW(),
         data_acquisto = NOW(),
         data_scadenza = COALESCE(data_scadenza, NOW() + (v_mesi || ' months')::interval),
         stato = CASE WHEN stato = 'bloccata' THEN 'bloccata' ELSE 'attiva' END
   WHERE id = pc.id;

  UPDATE public.prevendite
     SET posti_venduti = posti_venduti + 1
   WHERE id = pc.prevendita_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── 12. RLS ────────────────────────────────────────────────────────────────
-- Gestionale e sito condividono lo stesso progetto Supabase: "authenticated"
-- comprende ogni cliente registrato su dr7.app. Le policy sotto lo tengono
-- presente (vedi 20260809020000 per dr7_is_direzione / dr7_admin_id).

ALTER TABLE public.prevendite            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prevendite_clienti    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prevendite_movimenti  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prevendite_settings   ENABLE ROW LEVEL SECURITY;

-- Catalogo: lo legge chiunque (e' una vetrina), lo scrive solo il gestionale.
DROP POLICY IF EXISTS prevendite_select_pubblico ON public.prevendite;
CREATE POLICY prevendite_select_pubblico ON public.prevendite
  FOR SELECT USING (true);

DROP POLICY IF EXISTS prevendite_write_admin ON public.prevendite;
CREATE POLICY prevendite_write_admin ON public.prevendite
  FOR ALL TO authenticated
  USING (public.dr7_admin_id() IS NOT NULL OR public.dr7_is_direzione())
  WITH CHECK (public.dr7_admin_id() IS NOT NULL OR public.dr7_is_direzione());

-- Pacchetti: il cliente vede SOLO i suoi, il gestionale li vede tutti.
DROP POLICY IF EXISTS prevendite_clienti_select ON public.prevendite_clienti;
CREATE POLICY prevendite_clienti_select ON public.prevendite_clienti
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR lower(coalesce(customer_email,'')) = lower(coalesce(auth.jwt() ->> 'email',''))
    OR public.dr7_admin_id() IS NOT NULL
    OR public.dr7_is_direzione()
  );

-- L'acquisto parte dal browser del cliente: puo' creare la SUA riga, sempre
-- in pending. Il passaggio a pagata lo fa solo il server (callback Nexi).
DROP POLICY IF EXISTS prevendite_clienti_insert_cliente ON public.prevendite_clienti;
CREATE POLICY prevendite_clienti_insert_cliente ON public.prevendite_clienti
  FOR INSERT TO authenticated
  WITH CHECK (
    (user_id = auth.uid() AND payment_status = 'pending')
    OR public.dr7_admin_id() IS NOT NULL
    OR public.dr7_is_direzione()
  );

DROP POLICY IF EXISTS prevendite_clienti_update_admin ON public.prevendite_clienti;
CREATE POLICY prevendite_clienti_update_admin ON public.prevendite_clienti
  FOR UPDATE TO authenticated
  USING (public.dr7_admin_id() IS NOT NULL OR public.dr7_is_direzione())
  WITH CHECK (public.dr7_admin_id() IS NOT NULL OR public.dr7_is_direzione());

DROP POLICY IF EXISTS prevendite_clienti_delete_admin ON public.prevendite_clienti;
CREATE POLICY prevendite_clienti_delete_admin ON public.prevendite_clienti
  FOR DELETE TO authenticated
  USING (public.dr7_is_direzione());

-- Movimenti: il cliente legge quelli dei suoi pacchetti (e' il suo estratto
-- conto), scriverli e' affare del server e del gestionale.
DROP POLICY IF EXISTS prevendite_movimenti_select ON public.prevendite_movimenti;
CREATE POLICY prevendite_movimenti_select ON public.prevendite_movimenti
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.prevendite_clienti pc
       WHERE pc.id = prevendite_movimenti.prevendita_cliente_id
         AND ( pc.user_id = auth.uid()
               OR lower(coalesce(pc.customer_email,'')) = lower(coalesce(auth.jwt() ->> 'email','')) )
    )
    OR public.dr7_admin_id() IS NOT NULL
    OR public.dr7_is_direzione()
  );

DROP POLICY IF EXISTS prevendite_movimenti_write_admin ON public.prevendite_movimenti;
CREATE POLICY prevendite_movimenti_write_admin ON public.prevendite_movimenti
  FOR ALL TO authenticated
  USING (public.dr7_admin_id() IS NOT NULL OR public.dr7_is_direzione())
  WITH CHECK (public.dr7_admin_id() IS NOT NULL OR public.dr7_is_direzione());

-- Impostazioni: le legge il sito, le scrive il gestionale.
DROP POLICY IF EXISTS prevendite_settings_select ON public.prevendite_settings;
CREATE POLICY prevendite_settings_select ON public.prevendite_settings
  FOR SELECT USING (true);

DROP POLICY IF EXISTS prevendite_settings_write_admin ON public.prevendite_settings;
CREATE POLICY prevendite_settings_write_admin ON public.prevendite_settings
  FOR ALL TO authenticated
  USING (public.dr7_admin_id() IS NOT NULL OR public.dr7_is_direzione())
  WITH CHECK (public.dr7_admin_id() IS NOT NULL OR public.dr7_is_direzione());

-- ── 13. GRANT sulle funzioni ───────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.prevendita_verifica(UUID, DATE, DATE, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prevendita_usa(UUID, UUID, DATE, DATE, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prevendita_ripristina(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prevendita_rettifica(UUID, INTEGER, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prevendita_attiva_pagamento(UUID, TEXT) TO service_role;

-- ── 14. SCALO AUTOMATICO DALLA PRENOTAZIONE ────────────────────────────────
-- Una prenotazione fatta con una prevendita porta scritto
-- `booking_details.prevendita_cliente_id`. Quando quella prenotazione diventa
-- buona (confermata / attiva / completata, oppure pagata) l'utilizzo si scala
-- da solo.
--
-- La regola sta QUI, non nei singoli percorsi: la prenotazione puo' nascere
-- dal sito a saldo zero, dal sito con carta (callback Nexi), dal gestionale o
-- dal carrello. Le cauzioni sono tornate quattro volte proprio perche' la
-- pulizia era scritta dentro ogni percorso invece che nel database.
--
-- Se i vincoli non tornano si registra un WARNING e la prenotazione prosegue:
-- regola DR7, si avvisa e non si blocca. Il controllo vero l'ha gia' fatto il
-- sito prima di far scegliere le date.
CREATE OR REPLACE FUNCTION public.prevendita_scala_da_prenotazione()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pc   UUID;
  v_res  JSONB;
BEGIN
  -- TUTTO dentro un solo blocco protetto. Questo trigger sta su `bookings`:
  -- qualunque errore non gestito qui dentro farebbe fallire la INSERT o la
  -- UPDATE della PRENOTAZIONE, cioe' romperebbe il noleggio per colpa di un
  -- problema di prevendita. Non deve poter succedere: al massimo l'utilizzo
  -- non viene scalato e resta scritto nei log. Si avvisa, non si blocca.
  BEGIN
    v_pc := NULLIF(NEW.booking_details->>'prevendita_cliente_id', '')::uuid;
    IF v_pc IS NULL THEN
      RETURN NEW;
    END IF;

    IF NOT (
          lower(coalesce(NEW.status, '')) IN ('confirmed','active','completed','completata')
       OR lower(coalesce(NEW.payment_status, '')) IN ('paid','completed','succeeded')
    ) THEN
      RETURN NEW;
    END IF;

    -- Senza date non si scala niente: un utilizzo e' sempre legato a un
    -- periodo, e i vincoli (giorni consecutivi, utilizzi al mese) si
    -- controllano sulle date. Meglio non scalare che scalare alla cieca.
    IF NEW.pickup_date IS NULL OR NEW.dropoff_date IS NULL THEN
      RAISE WARNING '[prevendite] prenotazione % senza date: utilizzo non scalato', NEW.id;
      RETURN NEW;
    END IF;

    v_res := public.prevendita_usa(
      v_pc,
      NEW.id,
      (NEW.pickup_date AT TIME ZONE 'Europe/Rome')::date,
      (NEW.dropoff_date AT TIME ZONE 'Europe/Rome')::date,
      NULLIF(NEW.vehicle_id::text, ''),
      NEW.vehicle_name
    );

    IF NOT COALESCE((v_res->>'ok')::boolean, FALSE) THEN
      RAISE WARNING '[prevendite] utilizzo NON scalato sulla prenotazione %: %',
        NEW.id, COALESCE(v_res->>'errore', 'motivo sconosciuto');
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING '[prevendite] errore sul trigger della prenotazione % (la prenotazione resta valida): %',
      NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevendita_scala_da_prenotazione ON public.bookings;
CREATE TRIGGER trg_prevendita_scala_da_prenotazione
  AFTER INSERT OR UPDATE OF status, payment_status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.prevendita_scala_da_prenotazione();

COMMENT ON FUNCTION public.prevendita_scala_da_prenotazione() IS
  'Scala un utilizzo della prevendita quando la prenotazione collegata diventa confermata o pagata. Idempotente per booking_id.';
