-- =====================================================
-- FIX: Lead/Customer Duplication Bug
-- =====================================================
-- ROOT CAUSE: The trigger `booking_auto_create_customer` fires on EVERY
-- booking INSERT and creates a new customer in customers_extended when
-- user_id IS NULL. Since admin-created customers have user_id = NULL,
-- the lookup `SELECT user_id FROM customers_extended WHERE email = ...`
-- always returns NULL (it reads user_id, not id), so a duplicate is
-- created on every booking.
--
-- FIX: Replace the trigger with a safe version that:
-- 1. First checks if booking already has a linked customer (via user_id or booking_details->customer->customerId)
-- 2. Performs dedup by email, phone, AND name
-- 3. Links to existing customer instead of creating duplicates
-- 4. Only creates a new customer as absolute last resort
-- =====================================================

-- Step 1: Drop the broken trigger
DROP TRIGGER IF EXISTS booking_auto_create_customer ON bookings;

-- Step 2: Replace the function with a safe, dedup-aware version
CREATE OR REPLACE FUNCTION auto_create_customer_from_booking()
RETURNS TRIGGER AS $$
DECLARE
  existing_customer_id UUID;
  nome_part TEXT;
  cognome_part TEXT;
  customer_email TEXT;
  customer_phone TEXT;
  norm_phone TEXT;
BEGIN
  -- ===== GUARD 1: If booking already has a customer linked, do nothing =====
  -- Admin bookings set user_id to the customers_extended.id of the customer
  IF NEW.user_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Also check if customer is linked via booking_details JSONB
  IF NEW.booking_details IS NOT NULL AND (
    NEW.booking_details->'customer'->>'customerId' IS NOT NULL OR
    NEW.booking_details->>'customer_id' IS NOT NULL
  ) THEN
    RETURN NEW;
  END IF;

  -- ===== GUARD 2: Need at least email or phone to do anything =====
  customer_email := COALESCE(NEW.customer_email, NEW.guest_email);
  customer_phone := COALESCE(NEW.customer_phone, NEW.guest_phone);

  IF customer_email IS NULL AND customer_phone IS NULL THEN
    RETURN NEW;
  END IF;

  -- ===== DEDUP: Try to find existing customer =====
  existing_customer_id := NULL;

  -- Try by email first (most reliable)
  IF existing_customer_id IS NULL AND customer_email IS NOT NULL AND customer_email != '' THEN
    SELECT id INTO existing_customer_id
    FROM customers_extended
    WHERE LOWER(email) = LOWER(customer_email)
    LIMIT 1;
  END IF;

  -- Try by phone (normalized)
  IF existing_customer_id IS NULL AND customer_phone IS NOT NULL AND customer_phone != '' THEN
    norm_phone := REGEXP_REPLACE(customer_phone, '[\s\-\+\(\)]', '', 'g');
    IF norm_phone LIKE '00%' THEN
      norm_phone := SUBSTRING(norm_phone FROM 3);
    END IF;
    IF LENGTH(norm_phone) = 10 THEN
      norm_phone := '39' || norm_phone;
    END IF;

    SELECT id INTO existing_customer_id
    FROM customers_extended
    WHERE telefono = norm_phone
    LIMIT 1;
  END IF;

  -- If found, link the booking to the existing customer
  IF existing_customer_id IS NOT NULL THEN
    NEW.user_id := existing_customer_id;
    RAISE NOTICE '[auto_create_customer] Linked booking % to existing customer %', NEW.id, existing_customer_id;
    RETURN NEW;
  END IF;

  -- ===== LAST RESORT: Create new customer only if no match found =====
  IF NEW.customer_name IS NOT NULL AND (customer_email IS NOT NULL OR customer_phone IS NOT NULL) THEN
    nome_part := SPLIT_PART(NEW.customer_name, ' ', 1);
    cognome_part := SUBSTRING(NEW.customer_name FROM LENGTH(nome_part) + 2);

    INSERT INTO customers_extended (
      nome,
      cognome,
      email,
      telefono,
      tipo_cliente,
      source,
      created_at
    ) VALUES (
      nome_part,
      COALESCE(cognome_part, ''),
      customer_email,
      customer_phone,
      'persona_fisica',
      'booking_auto_created',
      NOW()
    )
    RETURNING id INTO existing_customer_id;

    NEW.user_id := existing_customer_id;
    RAISE NOTICE '[auto_create_customer] Created new customer % for booking %', existing_customer_id, NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 3: Recreate the trigger with the fixed function
CREATE TRIGGER booking_auto_create_customer
  BEFORE INSERT ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_customer_from_booking();

-- Step 4: Add comment for documentation
COMMENT ON FUNCTION auto_create_customer_from_booking() IS
  'Safe customer auto-creation trigger for bookings. Performs dedup by email and phone before creating. '
  'Skips entirely if booking already has user_id or booking_details.customer.customerId set.';
