-- 25/11/2026 (direzione, vocale di Valerio): il credito vincolato del wallet
-- deve avere gli stessi vincoli del codice sconto. Oltre ai business
-- (rental, boat_rental, heli_rental, stay_rental, car_wash) un lotto puo'
-- indicare le CATEGORIE vere di Centralina Pro, scritte 'cat:<id>' come nei
-- codici sconto (es. 'cat:urban' = Hypercar, 'cat:aziendali' = Supercar).
--
-- Regola: un lotto senza servizi vale su tutto (come prima). Altrimenti vale
-- se il business della prenotazione e' tra i suoi business, OPPURE se e' un
-- noleggio Terra e la categoria del veicolo e' tra le sue categorie.
-- Categoria sconosciuta = i lotti per categoria non si spendono (si chiude).
-- I lotti gia' esistenti non hanno voci 'cat:' e si comportano come prima.
--
-- Le firme cambiano (parametro p_categoria in fondo, con default): le vecchie
-- si tolgono nella stessa transazione, cosi' non restano due versioni con lo
-- stesso nome (PGRST203, vedi add_credits).

BEGIN;

-- ── Categoria di un veicolo: per id, altrimenti per targa ────────────────
CREATE OR REPLACE FUNCTION public.dr7_wallet_categoria_veicolo(p_vehicle_id UUID, p_plate TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(
    (SELECT lower(btrim(category)) FROM public.vehicles WHERE id = p_vehicle_id),
    (SELECT lower(btrim(category)) FROM public.vehicles
      WHERE p_plate IS NOT NULL AND btrim(p_plate) <> ''
        AND upper(regexp_replace(plate, '\s', '', 'g')) = upper(regexp_replace(p_plate, '\s', '', 'g'))
      ORDER BY (status = 'retired') LIMIT 1)
  );
$$;

-- ── Un lotto e' spendibile qui, oggi? ─────────────────────────────────────
DROP FUNCTION IF EXISTS public.dr7_wallet_lotto_vale(DATE, TEXT[], TEXT);
CREATE FUNCTION public.dr7_wallet_lotto_vale(
  p_scadenza  DATE,
  p_servizi   TEXT[],
  p_servizio  TEXT,
  p_categoria TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT (p_scadenza IS NULL OR p_scadenza >= current_date)
     AND (p_servizi IS NULL OR cardinality(p_servizi) = 0
          -- un business del lotto (le voci 'cat:' qui non contano)
          OR public.dr7_wallet_business(p_servizio) = ANY (
               SELECT public.dr7_wallet_business(s) FROM unnest(p_servizi) AS s
                WHERE lower(btrim(s)) NOT LIKE 'cat:%'
             )
          -- una categoria del lotto, solo per il noleggio Terra
          OR (public.dr7_wallet_business(p_servizio) = 'rental'
              AND p_categoria IS NOT NULL AND btrim(p_categoria) <> ''
              AND EXISTS (
                SELECT 1 FROM unnest(p_servizi) AS s
                 WHERE lower(btrim(s)) LIKE 'cat:%'
                   AND (CASE substr(lower(btrim(s)), 5) WHEN 'exotic' THEN 'supercars' ELSE substr(lower(btrim(s)), 5) END)
                     = (CASE lower(btrim(p_categoria)) WHEN 'exotic' THEN 'supercars' ELSE lower(btrim(p_categoria)) END)
              )));
$$;

-- ── Quanto vincolato e' spendibile ────────────────────────────────────────
DROP FUNCTION IF EXISTS public.dr7_wallet_vincolato_disponibile(UUID, TEXT);
CREATE FUNCTION public.dr7_wallet_vincolato_disponibile(
  p_user_id   UUID,
  p_servizio  TEXT DEFAULT NULL,
  p_categoria TEXT DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(sum(residuo), 0)::NUMERIC(12,2)
    FROM public.wallet_crediti_vincolati
   WHERE user_id = p_user_id
     AND residuo > 0
     AND public.dr7_wallet_lotto_vale(scadenza, servizi, p_servizio, p_categoria);
$$;

-- ── Consumo dei lotti (corpo invariato, piu' la categoria) ───────────────
DROP FUNCTION IF EXISTS public.dr7_wallet_consuma_vincolato(UUID, NUMERIC, TEXT, UUID);
CREATE FUNCTION public.dr7_wallet_consuma_vincolato(
  p_user_id    UUID,
  p_importo    NUMERIC,
  p_servizio   TEXT,
  p_booking_id UUID DEFAULT NULL,
  p_categoria  TEXT DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  v_resta  NUMERIC := round(coalesce(p_importo, 0), 2);
  v_preso  NUMERIC := 0;
  v_quota  NUMERIC;
  v_cat    TEXT := p_categoria;
  r        RECORD;
BEGIN
  IF v_resta <= 0 THEN RETURN 0; END IF;

  -- Senza categoria esplicita, quella del veicolo della prenotazione.
  IF (v_cat IS NULL OR btrim(v_cat) = '') AND p_booking_id IS NOT NULL THEN
    SELECT public.dr7_wallet_categoria_veicolo(b.vehicle_id, b.vehicle_plate)
      INTO v_cat
      FROM public.bookings b WHERE b.id = p_booking_id;
  END IF;

  FOR r IN
    SELECT id, residuo
      FROM public.wallet_crediti_vincolati
     WHERE user_id = p_user_id
       AND residuo > 0
       AND public.dr7_wallet_lotto_vale(scadenza, servizi, p_servizio, v_cat)
     -- Prima quello che SCADE prima: e' l'unico che, non speso, sparisce.
     -- A parita' di scadenza, prima il piu' stretto (vincolato a un
     -- servizio), che serve a meno cose. Poi il piu' vecchio.
     ORDER BY scadenza NULLS LAST,
              (servizi IS NOT NULL AND cardinality(servizi) > 0) DESC,
              created_at
     FOR UPDATE
  LOOP
    EXIT WHEN v_resta <= 0;
    v_quota := least(r.residuo, v_resta);

    UPDATE public.wallet_crediti_vincolati
       SET residuo = round(residuo - v_quota, 2), updated_at = now()
     WHERE id = r.id;

    INSERT INTO public.wallet_crediti_vincolati_movimenti (lotto_id, user_id, booking_id, importo)
         VALUES (r.id, p_user_id, p_booking_id, v_quota);

    v_resta := round(v_resta - v_quota, 2);
    v_preso := round(v_preso + v_quota, 2);
  END LOOP;

  RETURN v_preso;
END;
$$;

REVOKE ALL ON FUNCTION public.dr7_wallet_consuma_vincolato(UUID, NUMERIC, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dr7_wallet_consuma_vincolato(UUID, NUMERIC, TEXT, UUID, TEXT) TO service_role;

-- I chiamanti (book_with_credits, dr7_wallet_sync_prenotazione) si
-- aggiornano nello script di applicazione con la categoria del veicolo:
-- vedi 20261125_wallet_vincoli_categoria_chiamanti.sql

COMMIT;
