-- ═══════════════════════════════════════════════════════════════════════════
-- BOOK_WITH_CREDITS IMPARA IL CREDITO VINCOLATO — 16/09/2026
--
-- La prenotazione fatta dal sito col wallet passa da qui. Leggeva solo
-- `user_credit_balance`: un credito vincolato (vedi 20260916000000) non
-- sarebbe stato spendibile dal sito, e il cliente avrebbe visto un credito
-- che non riusciva a usare.
--
-- Stessa regola del trigger sulle prenotazioni: prima i lotti validi per il
-- servizio, a partire da quello che scade prima; il resto dal saldo libero.
-- Il registro continua a segnare l'importo INTERO pagato col wallet.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.book_with_credits(
  p_user_id UUID,
  p_amount_cents INTEGER,
  p_vehicle_name TEXT,
  p_booking_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$

DECLARE
  v_current_balance NUMERIC;
  v_amount_eur NUMERIC;
  v_new_balance NUMERIC;
  v_booking_id UUID;
  v_vehicle_id UUID;
  v_vehicle_plate TEXT;
  v_servizio TEXT;
  v_vincolato NUMERIC := 0;
  v_dal_saldo NUMERIC := 0;
BEGIN
  v_amount_eur := p_amount_cents / 100.0;

  -- 16/09/2026 — CREDITO VINCOLATO. Il cliente puo' avere credito che vale
  -- solo su certi servizi e fino a una data. Si spende PRIMA quello, a
  -- partire da quello che scade prima, e solo il resto esce dal saldo libero.
  -- Senza questo, dal sito il credito vincolato non si sarebbe potuto usare:
  -- il saldo non lo contiene.
  v_servizio := COALESCE(p_booking_payload->>'service_type', 'car_rental');
  v_vincolato := public.dr7_wallet_consuma_vincolato(p_user_id, v_amount_eur, v_servizio, NULL);
  v_dal_saldo := ROUND(v_amount_eur - v_vincolato, 2);

  SELECT balance INTO v_current_balance
  FROM user_credit_balance
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_current_balance IS NULL THEN v_current_balance := 0; END IF;

  IF v_current_balance < v_dal_saldo THEN
    -- Nel messaggio ci va il credito spendibile SU QUESTO SERVIZIO: il
    -- vincolato appena coperto piu' il saldo libero.
    RAISE EXCEPTION 'Credito insufficiente. Disponibile: €%, Richiesto: €%',
      ROUND(v_current_balance + v_vincolato, 2), v_amount_eur;
  END IF;

  v_new_balance := ROUND(v_current_balance - v_dal_saldo, 2);

  UPDATE user_credit_balance
  SET balance = v_new_balance, last_updated = NOW()
  WHERE user_id = p_user_id;

  INSERT INTO credit_transactions (
    user_id, transaction_type, amount, balance_after, description, service_type, created_at
  ) VALUES (
    p_user_id, 'debit', v_amount_eur, v_new_balance,
    'Noleggio ' || p_vehicle_name || ' - ' || (p_booking_payload->>'pickup_date') || ' to ' || (p_booking_payload->>'dropoff_date')
      || CASE WHEN v_vincolato > 0 THEN ' (di cui ' || TO_CHAR(v_vincolato, 'FM999999990.00') || ' EUR di credito vincolato)' ELSE '' END,
    'car_rental', NOW()
  );

  v_vehicle_id := CASE
    WHEN p_booking_payload->>'vehicle_id' IS NOT NULL AND p_booking_payload->>'vehicle_id' != ''
    THEN (p_booking_payload->>'vehicle_id')::uuid
    ELSE NULL
  END;

  v_vehicle_plate := NULLIF(TRIM(p_booking_payload->>'vehicle_plate'), '');

  IF v_vehicle_plate IS NULL AND v_vehicle_id IS NOT NULL THEN
    SELECT NULLIF(TRIM(plate), '') INTO v_vehicle_plate
    FROM vehicles WHERE id = v_vehicle_id;
  END IF;

  IF v_vehicle_plate IS NULL THEN
    v_vehicle_plate := NULLIF(TRIM(
      COALESCE(
        p_booking_payload->'booking_details'->>'vehicle_plate',
        p_booking_payload->'booking_details'->>'plate'
      )
    ), '');
  END IF;

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

  -- I lotti sono stati consumati prima che la prenotazione esistesse: adesso
  -- che ha un id, i movimenti lo prendono. Senza, uno storno non saprebbe a
  -- quale lotto restituire il denaro.
  IF v_vincolato > 0 THEN
    UPDATE public.wallet_crediti_vincolati_movimenti
       SET booking_id = v_booking_id
     WHERE user_id = p_user_id
       AND booking_id IS NULL;
  END IF;

  RETURN jsonb_build_object('success', true, 'booking_id', v_booking_id,
                            'new_balance', v_new_balance, 'da_credito_vincolato', v_vincolato);
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Prenotazione fallita: %', SQLERRM;
END;

$function$;

GRANT EXECUTE ON FUNCTION public.book_with_credits(UUID, INTEGER, TEXT, JSONB) TO authenticated, service_role;
