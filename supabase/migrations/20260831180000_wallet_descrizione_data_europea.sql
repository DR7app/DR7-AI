-- =====================================================================
-- Credit Wallet: la descrizione della prenotazione in ora di Roma
-- =====================================================================
-- 31/08/2026 — nel portafoglio del cliente (sito e gestionale) si leggeva:
--
--   Noleggio BMW MANHART M8 competition MH8 800 -
--   2026-09-03T15:30:00.000Z to 2026-09-04T14:00:00.000Z
--
-- Due errori in una riga sola:
--   1) formato: timestamp ISO grezzo invece di GG/MM/AAAA e orologio 24h;
--   2) FUSO: 15:30Z e' UTC. Il ritiro e' alle 17:30 di Roma. Il cliente
--      leggeva un orario sbagliato di due ore sul proprio movimento.
--
-- La descrizione e' TESTO SALVATO: si scrive una volta e resta cosi' per
-- sempre, quindi non basta correggere chi la scrive — vanno riscritte
-- anche le righe gia' in tabella (in fondo).
--
-- Da qui in avanti:
--   Noleggio <mezzo> - dal 03/09/2026 17:30 al 04/09/2026 16:00
--
-- Il resto della funzione e' identico alla versione del 20/05/2026
-- (20260520000000_book_with_credits_autofill_plate.sql): cambia SOLO il
-- testo della descrizione.
-- =====================================================================

CREATE OR REPLACE FUNCTION book_with_credits(
  p_user_id UUID,
  p_amount_cents INTEGER,
  p_vehicle_name TEXT,
  p_booking_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_balance NUMERIC;
  v_amount_eur NUMERIC;
  v_new_balance NUMERIC;
  v_booking_id UUID;
  v_vehicle_id UUID;
  v_vehicle_plate TEXT;
  v_ritiro TIMESTAMPTZ;
  v_riconsegna TIMESTAMPTZ;
  v_descrizione TEXT;
BEGIN
  v_amount_eur := p_amount_cents / 100.0;

  -- Wallet balance lock + check
  SELECT balance INTO v_current_balance
  FROM user_credit_balance
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_current_balance IS NULL THEN
    v_current_balance := 0;
  END IF;

  IF v_current_balance < v_amount_eur THEN
    RAISE EXCEPTION 'Credito insufficiente. Disponibile: €%, Richiesto: €%', v_current_balance, v_amount_eur;
  END IF;

  v_new_balance := v_current_balance - v_amount_eur;

  UPDATE user_credit_balance
  SET balance = v_new_balance, last_updated = NOW()
  WHERE user_id = p_user_id;

  -- Descrizione: date in ora di Roma, GG/MM/AAAA e orologio 24h.
  -- Ogni pezzo si aggiunge solo se c'e': una data mancante non deve
  -- cancellare il nome del mezzo dal movimento.
  v_ritiro := NULLIF(p_booking_payload->>'pickup_date', '')::timestamptz;
  v_riconsegna := NULLIF(p_booking_payload->>'dropoff_date', '')::timestamptz;

  v_descrizione := 'Noleggio ' || COALESCE(p_vehicle_name, '');
  IF v_ritiro IS NOT NULL THEN
    v_descrizione := v_descrizione || ' - dal '
      || to_char(v_ritiro AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY HH24:MI');
  END IF;
  IF v_riconsegna IS NOT NULL THEN
    v_descrizione := v_descrizione || CASE WHEN v_ritiro IS NULL THEN ' - fino al ' ELSE ' al ' END
      || to_char(v_riconsegna AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY HH24:MI');
  END IF;

  INSERT INTO credit_transactions (
    user_id, transaction_type, amount, balance_after, description, service_type, created_at
  ) VALUES (
    p_user_id, 'debit', v_amount_eur, v_new_balance,
    v_descrizione,
    'car_rental', NOW()
  );

  -- Resolve vehicle_id from payload (NULL-safe)
  v_vehicle_id := CASE
    WHEN p_booking_payload->>'vehicle_id' IS NOT NULL
     AND p_booking_payload->>'vehicle_id' != ''
    THEN (p_booking_payload->>'vehicle_id')::uuid
    ELSE NULL
  END;

  -- Resolve plate: prefer payload, fall back to vehicles lookup by id,
  -- final fallback to the nested booking_details. Anything is better
  -- than NULL because Report Noleggio + many other tabs filter on plate.
  v_vehicle_plate := NULLIF(TRIM(p_booking_payload->>'vehicle_plate'), '');

  IF v_vehicle_plate IS NULL AND v_vehicle_id IS NOT NULL THEN
    SELECT NULLIF(TRIM(plate), '') INTO v_vehicle_plate
    FROM vehicles
    WHERE id = v_vehicle_id;
  END IF;

  IF v_vehicle_plate IS NULL THEN
    v_vehicle_plate := NULLIF(TRIM(
      COALESCE(
        p_booking_payload->'booking_details'->>'vehicle_plate',
        p_booking_payload->'booking_details'->>'plate'
      )
    ), '');
  END IF;

  -- Insert booking with the resolved plate
  INSERT INTO public.bookings (
    user_id, vehicle_name, vehicle_type, vehicle_image_url,
    pickup_date, dropoff_date, pickup_location, dropoff_location,
    price_total, currency, status, payment_status, payment_method,
    booking_source, booked_at, booking_details,
    customer_name, customer_email, customer_phone,
    deposit_amount, vehicle_id, vehicle_plate, insurance_option,
    booking_usage_zone, service_type
  ) VALUES (
    (p_booking_payload->>'user_id')::uuid,
    p_booking_payload->>'vehicle_name',
    p_booking_payload->>'vehicle_type',
    p_booking_payload->>'vehicle_image_url',
    (p_booking_payload->>'pickup_date')::timestamptz,
    (p_booking_payload->>'dropoff_date')::timestamptz,
    p_booking_payload->>'pickup_location',
    p_booking_payload->>'dropoff_location',
    (p_booking_payload->>'price_total')::numeric,
    p_booking_payload->>'currency',
    'confirmed',
    'succeeded',
    'credit',
    COALESCE(p_booking_payload->>'booking_source', 'website'),
    NOW(),
    p_booking_payload->'booking_details',
    p_booking_payload->>'customer_name',
    p_booking_payload->>'customer_email',
    p_booking_payload->>'customer_phone',
    (p_booking_payload->>'deposit_amount')::numeric,
    v_vehicle_id,
    v_vehicle_plate,
    p_booking_payload->>'insurance_option',
    p_booking_payload->>'booking_usage_zone',
    COALESCE(p_booking_payload->>'service_type', 'car_rental')
  ) RETURNING id INTO v_booking_id;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', v_booking_id,
    'new_balance', v_new_balance
  );

EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Prenotazione fallita: %', SQLERRM;
END;
$$;

-- ---------------------------------------------------------------------
-- Righe gia' scritte: stessa correzione, sul testo salvato.
--
-- L'ancora e' la CODA della descrizione (`...$`): due timestamp ISO in
-- fondo, separati da " to ". Cosi' un nome di mezzo che contiene un
-- trattino non viene toccato, e una descrizione gia' corretta non
-- rientra nel filtro (quindi rilanciare la migrazione non fa danni).
--
-- Prima di lanciarla, per vedere quante righe cambiano e come:
--   SELECT description FROM credit_transactions
--   WHERE description ~ ' - [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z to [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$';
-- ---------------------------------------------------------------------
WITH da_correggere AS (
  SELECT
    id,
    regexp_replace(
      description,
      ' - [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z to [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$',
      ''
    ) AS testa,
    (substring(description from
      ' - ([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z) to [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$'
    ))::timestamptz AS ritiro,
    (substring(description from
      ' - [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z to ([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z)$'
    ))::timestamptz AS riconsegna
  FROM credit_transactions
  WHERE description ~ ' - [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z to [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$'
)
UPDATE credit_transactions t
SET description = d.testa
  || ' - dal ' || to_char(d.ritiro AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY HH24:MI')
  || ' al '    || to_char(d.riconsegna AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY HH24:MI')
FROM da_correggere d
WHERE t.id = d.id;
