-- ============================================================================
-- PROMOZIONI PRENOTABILI (26/09/2026)
--
-- Una promozione e' un PREZZO AL GIORNO speciale su uno o piu' veicoli, in una
-- finestra di date e con posti limitati. Il cliente la prenota subito dal sito
-- (a differenza della prevendita, che si compra oggi e si usa dopo).
--
-- La promozione cambia SOLO il prezzo dei giorni di noleggio. Cauzione,
-- assicurazione, km, extra: tutto come una prenotazione normale, perche'
-- dipendono dal cliente (Fascia A/B, residenza), non dall'offerta.
--
-- I vincoli (attiva, veicolo, date, giorni, posti, prezzo) si controllano QUI,
-- con un trigger su bookings: il sito ha sei percorsi che scrivono una
-- prenotazione (carta, wallet, carrello, totale zero, ...) e un controllo nel
-- database li copre tutti, anche chiamando l'API a mano.
-- ============================================================================

DO $$
BEGIN
  IF to_regprocedure('public.dr7_is_direzione()') IS NULL
     OR to_regprocedure('public.dr7_admin_id()') IS NULL THEN
    RAISE EXCEPTION 'Mancano dr7_is_direzione() / dr7_admin_id(): applica prima la migrazione 20260809020000_rls_acconti_report_overrides.sql';
  END IF;
END
$$;

-- ── 1. CATALOGO ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.promozioni (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titolo                TEXT NOT NULL,
  titolo_en             TEXT,
  descrizione           TEXT,
  descrizione_en        TEXT,
  -- Foto caricate dal gestionale (mai URL scritti a mano), in ordine.
  foto_urls             JSONB NOT NULL DEFAULT '[]'::jsonb,
  business              TEXT NOT NULL DEFAULT 'terra',
  -- [{ id, nome, targa }] — id = vehicles.id del gestionale.
  veicoli               JSONB NOT NULL DEFAULT '[]'::jsonb,
  prezzo_giorno         NUMERIC(10,2) NOT NULL,
  -- Prezzo normale al giorno: serve solo a mostrare "invece di".
  prezzo_listino_giorno NUMERIC(10,2),
  -- Il noleggio deve stare DENTRO queste date (ritiro e riconsegna).
  noleggio_dal          DATE NOT NULL,
  noleggio_al           DATE NOT NULL,
  min_giorni            INTEGER,
  max_giorni            INTEGER,
  -- Quando la card compare sul sito. NULL = subito / senza fine.
  visibile_dal          TIMESTAMPTZ,
  visibile_al           TIMESTAMPTZ,
  -- NULL = posti illimitati.
  posti_totali          INTEGER,
  attiva                BOOLEAN NOT NULL DEFAULT TRUE,
  visibile_sito         BOOLEAN NOT NULL DEFAULT TRUE,
  ordine                INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT promozioni_prezzo_chk CHECK (prezzo_giorno >= 0),
  CONSTRAINT promozioni_date_chk CHECK (noleggio_al >= noleggio_dal),
  CONSTRAINT promozioni_giorni_chk CHECK (
    (min_giorni IS NULL OR min_giorni >= 1)
    AND (max_giorni IS NULL OR max_giorni >= 1)
    AND (min_giorni IS NULL OR max_giorni IS NULL OR max_giorni >= min_giorni)
  ),
  CONSTRAINT promozioni_posti_chk CHECK (posti_totali IS NULL OR posti_totali >= 0),
  CONSTRAINT promozioni_veicoli_chk CHECK (jsonb_typeof(veicoli) = 'array'),
  CONSTRAINT promozioni_foto_chk CHECK (jsonb_typeof(foto_urls) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_promozioni_sito ON public.promozioni(attiva, visibile_sito, ordine);

-- Prenotazioni che usano una promozione: per contare i posti senza leggere il
-- JSON di tutta la tabella.
CREATE INDEX IF NOT EXISTS idx_bookings_promo_id
  ON public.bookings ((booking_details ->> 'promo_id'))
  WHERE booking_details ? 'promo_id';

DROP TRIGGER IF EXISTS trg_promozioni_touch ON public.promozioni;
CREATE TRIGGER trg_promozioni_touch BEFORE UPDATE ON public.promozioni
  FOR EACH ROW EXECUTE FUNCTION public.prevendite_touch_updated_at();

-- ── 2. POSTI ────────────────────────────────────────────────────────────────
-- Posti occupati = prenotazioni con questa promo non annullate. Una
-- prenotazione Nexi in attesa occupa il posto: se non viene pagata, il cron
-- cancel-unpaid-nexi-bookings la annulla e il posto torna libero.
CREATE OR REPLACE FUNCTION public.promozione_posti_usati(p_promo_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int
    FROM public.bookings b
   WHERE b.booking_details ->> 'promo_id' = p_promo_id::text
     AND lower(coalesce(b.status, '')) NOT IN ('cancelled', 'annullata', 'rejected');
$$;

-- ── 3. VERIFICA (sito, prima di mostrare il prezzo) ────────────────────────
-- Stessi controlli del trigger, senza bloccare niente: il sito la chiama per
-- dire al cliente PERCHE' una data o un veicolo non vanno bene.
CREATE OR REPLACE FUNCTION public.promozione_verifica(
  p_promo_id    UUID,
  p_vehicle_id  TEXT,
  p_ritiro      TIMESTAMPTZ,
  p_riconsegna  TIMESTAMPTZ,
  p_giorni      INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p          public.promozioni;
  v_dal      DATE := (p_ritiro AT TIME ZONE 'Europe/Rome')::date;
  v_al       DATE := (p_riconsegna AT TIME ZONE 'Europe/Rome')::date;
  v_minimo   INTEGER;
  v_usati    INTEGER;
BEGIN
  SELECT * INTO p FROM public.promozioni WHERE id = p_promo_id;
  IF NOT FOUND OR NOT p.attiva THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Questa promozione non e piu disponibile.');
  END IF;
  IF (p.visibile_dal IS NOT NULL AND p.visibile_dal > now())
     OR (p.visibile_al IS NOT NULL AND p.visibile_al < now()) THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Questa promozione non e attiva in questo momento.');
  END IF;
  IF p_vehicle_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p.veicoli) v WHERE v ->> 'id' = p_vehicle_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'La promozione non vale per questo veicolo.');
  END IF;
  IF p_ritiro IS NULL OR p_riconsegna IS NULL OR v_dal < p.noleggio_dal OR v_al > p.noleggio_al THEN
    RETURN jsonb_build_object('ok', false, 'errore',
      format('La promozione vale per noleggi dal %s al %s.',
        to_char(p.noleggio_dal, 'DD/MM/YYYY'), to_char(p.noleggio_al, 'DD/MM/YYYY')));
  END IF;
  -- I giorni li calcola il sito con la regola di tolleranza della Centralina:
  -- qui si controlla solo che non siano MENO dei giorni di calendario.
  v_minimo := greatest(1, v_al - v_dal);
  IF p_giorni IS NULL OR p_giorni < v_minimo THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Numero di giorni non valido per queste date.');
  END IF;
  IF p.min_giorni IS NOT NULL AND p_giorni < p.min_giorni THEN
    RETURN jsonb_build_object('ok', false, 'errore', format('La promozione richiede almeno %s giorni.', p.min_giorni));
  END IF;
  IF p.max_giorni IS NOT NULL AND p_giorni > p.max_giorni THEN
    RETURN jsonb_build_object('ok', false, 'errore', format('La promozione vale al massimo per %s giorni.', p.max_giorni));
  END IF;
  v_usati := public.promozione_posti_usati(p.id);
  IF p.posti_totali IS NOT NULL AND v_usati >= p.posti_totali THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Promozione esaurita: i posti sono finiti.');
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'prezzo_giorno', p.prezzo_giorno,
    'noleggio_cents', round(p.prezzo_giorno * 100)::bigint * p_giorni,
    'posti_residui', CASE WHEN p.posti_totali IS NULL THEN NULL ELSE p.posti_totali - v_usati END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.promozione_verifica(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promozione_posti_usati(UUID) TO anon, authenticated;

-- ── 4. TRIGGER: nessuna prenotazione promo fuori dalle regole ──────────────
-- Controlla le prenotazioni scritte dai CLIENTI (anon / authenticated non
-- staff). Passano sempre:
--   - lo staff, che puo' fare eccezioni dal gestionale;
--   - il service role: e' il server, es. la prenotazione scritta DOPO un
--     pagamento Nexi gia' riuscito. Il cliente ha pagato: non si rifiuta mai,
--     anche se nel frattempo i posti sono finiti.
CREATE OR REPLACE FUNCTION public.promozione_controlla_prenotazione()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ruolo    TEXT := coalesce(auth.jwt() ->> 'role', '');
  v_promo_id UUID;
  v_vehicle  TEXT;
  v_giorni   INTEGER;
  v_cents    BIGINT;
  v_esito    JSONB;
BEGIN
  -- booking_details puo' essere NULL: senza coalesce il test darebbe NULL e
  -- il trigger rifiuterebbe ogni prenotazione senza dettagli.
  IF NOT coalesce(NEW.booking_details ? 'promo_id', false) THEN
    RETURN NEW;
  END IF;
  IF v_ruolo NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF v_ruolo = 'authenticated' AND public.dr7_is_staff() THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_promo_id := (NEW.booking_details ->> 'promo_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'PROMO_NON_VALIDA: Promozione non riconosciuta.' USING ERRCODE = 'P0001';
  END;

  -- Blocco sulla riga della promozione: due clienti che prendono l'ultimo
  -- posto nello stesso istante passano uno alla volta.
  PERFORM 1 FROM public.promozioni WHERE id = v_promo_id FOR UPDATE;

  v_vehicle := coalesce(NEW.vehicle_id::text, NEW.booking_details ->> 'vehicle_id');
  v_giorni  := nullif(NEW.booking_details ->> 'promo_giorni', '')::int;

  v_esito := public.promozione_verifica(v_promo_id, v_vehicle, NEW.pickup_date, NEW.dropoff_date, v_giorni);
  IF NOT coalesce((v_esito ->> 'ok')::boolean, false) THEN
    RAISE EXCEPTION 'PROMO_NON_VALIDA: %', v_esito ->> 'errore' USING ERRCODE = 'P0001';
  END IF;

  -- Il prezzo dei giorni e' quello della promozione, al centesimo; il totale
  -- (con assicurazione, km, extra) non puo' essere piu' basso di cosi'.
  v_cents := (v_esito ->> 'noleggio_cents')::bigint;
  IF nullif(NEW.booking_details ->> 'promo_noleggio_cents', '')::bigint IS DISTINCT FROM v_cents THEN
    RAISE EXCEPTION 'PROMO_NON_VALIDA: Il prezzo non corrisponde alla promozione. Ricarica la pagina e riprova.' USING ERRCODE = 'P0001';
  END IF;
  IF coalesce(NEW.price_total, 0) < v_cents THEN
    RAISE EXCEPTION 'PROMO_NON_VALIDA: Il totale e inferiore al prezzo della promozione.' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.promozione_controlla_prenotazione() FROM PUBLIC, anon, authenticated;

-- "01": dopo trg_00_sc_prenotazioni_sospese, prima dei controlli di
-- sovrapposizione e del wallet.
DROP TRIGGER IF EXISTS trg_01_promozione_valida ON public.bookings;
CREATE TRIGGER trg_01_promozione_valida
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.promozione_controlla_prenotazione();

-- ── 5. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.promozioni ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS promozioni_lettura_pubblica ON public.promozioni;
CREATE POLICY promozioni_lettura_pubblica ON public.promozioni
  FOR SELECT USING (
    (attiva AND visibile_sito)
    OR public.dr7_admin_id() IS NOT NULL
    OR public.dr7_is_direzione()
  );

DROP POLICY IF EXISTS promozioni_scrittura_gestionale ON public.promozioni;
CREATE POLICY promozioni_scrittura_gestionale ON public.promozioni
  FOR ALL
  USING (public.dr7_admin_id() IS NOT NULL OR public.dr7_is_direzione())
  WITH CHECK (public.dr7_admin_id() IS NOT NULL OR public.dr7_is_direzione());

GRANT SELECT ON public.promozioni TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.promozioni TO authenticated;
