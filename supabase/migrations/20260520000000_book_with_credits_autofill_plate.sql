-- =====================================================================
-- book_with_credits: auto-fill vehicle_plate from vehicles table
-- =====================================================================
-- Bug pattern (May 2026): the website wizard occasionally sent NULL as
-- vehicle_plate in the RPC payload (item.plates fallback path returned
-- null). The RPC stored NULL on the booking row. Downstream the monthly
-- Report Noleggio dropped these rows entirely because the filter
-- "vehicle_plate NOT IN ('TEST000','TEST002')" excludes NULL plates in
-- PostgreSQL three-valued logic.
--
-- Defense in depth: even if a future caller forgets to send the plate,
-- the RPC now looks it up from the vehicles table by vehicle_id and
-- writes the correct value. Bookings will always have a plate when the
-- vehicle exists, so Report Noleggio / Calendar / GPS Fleet all see them.
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

  INSERT INTO credit_transactions (
    user_id, transaction_type, amount, balance_after, description, service_type, created_at
  ) VALUES (
    p_user_id, 'debit', v_amount_eur, v_new_balance,
    'Noleggio ' || p_vehicle_name || ' - ' || (p_booking_payload->>'pickup_date') || ' to ' || (p_booking_payload->>'dropoff_date'),
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

-- Backfill: any existing wallet booking with vehicle_id set but no plate
-- gets its plate filled from the vehicles table. This is a one-shot
-- catch-up for historical wallet bookings (Massimo Runchina's missing
-- rentals etc.) so they show up immediately in Report Noleggio without
-- waiting for the next booking.
UPDATE public.bookings b
SET vehicle_plate = v.plate
FROM public.vehicles v
WHERE b.vehicle_id = v.id
  AND (b.vehicle_plate IS NULL OR TRIM(b.vehicle_plate) = '')
  AND v.plate IS NOT NULL
  AND TRIM(v.plate) <> '';
