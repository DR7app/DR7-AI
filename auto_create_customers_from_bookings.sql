-- Step 1: Create the trigger function
CREATE OR REPLACE FUNCTION auto_create_customer_from_booking()
RETURNS TRIGGER AS $$
DECLARE
  customer_user_id UUID;
  nome_part TEXT;
  cognome_part TEXT;
BEGIN
  -- Only proceed if user_id is NULL and we have customer data
  IF NEW.user_id IS NULL AND NEW.customer_name IS NOT NULL AND NEW.customer_email IS NOT NULL THEN
    
    -- Split name into nome/cognome
    nome_part := SPLIT_PART(NEW.customer_name, ' ', 1);
    cognome_part := SUBSTRING(NEW.customer_name FROM LENGTH(nome_part) + 2);
    
    -- Check if customer already exists with this email
    SELECT user_id INTO customer_user_id
    FROM customers_extended
    WHERE LOWER(email) = LOWER(NEW.customer_email)
    LIMIT 1;
    
    -- If not found, create new customer (without auth user, admin-created)
    IF customer_user_id IS NULL THEN
      INSERT INTO customers_extended (
        user_id,
        nome,
        cognome,
        email,
        telefono,
        tipo_cliente,
        source
      ) VALUES (
        NULL, -- No auth user for admin-created customers
        nome_part,
        COALESCE(cognome_part, ''),
        NEW.customer_email,
        NEW.customer_phone,
        'persona_fisica',
        'booking_auto_created'
      )
      RETURNING user_id INTO customer_user_id;
      
      RAISE NOTICE 'Auto-created customer (no auth) for booking %', NEW.id;
    ELSE
      RAISE NOTICE 'Linked existing customer to booking %', NEW.id;
    END IF;
    
    -- Link booking to customer's auth user (may be NULL for admin-created)
    NEW.user_id := customer_user_id;
    
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 2: Create the trigger
DROP TRIGGER IF EXISTS booking_auto_create_customer ON bookings;
CREATE TRIGGER booking_auto_create_customer
  BEFORE INSERT ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_customer_from_booking();

-- Step 3: Backfill RICCARDO PILIA specifically (without auth user)
DO $$
DECLARE
  new_customer_id UUID;
BEGIN
  -- Create customer for RICCARDO PILIA
  INSERT INTO customers_extended (
    user_id,
    nome,
    cognome,
    email,
    telefono,
    tipo_cliente,
    source
  ) VALUES (
    NULL, -- No auth user
    'RICCARDO',
    'PILIA',
    'r.p.system.srl@gmail.com',
    '+39 351 577 6809',
    'persona_fisica',
    'backfill_manual'
  )
  RETURNING id INTO new_customer_id;
  
  -- For admin-created customers, we'll store the customer ID in booking_details
  UPDATE bookings 
  SET booking_details = COALESCE(booking_details, '{}'::jsonb) || jsonb_build_object('customer_id', new_customer_id)
  WHERE id = '6304f31a-b81b-4c2f-9efa-67b9e35f75c6';
  
  RAISE NOTICE 'Created customer % for RICCARDO PILIA (stored in booking_details)', new_customer_id;
END $$;

-- Step 4: Backfill ALL other existing unlinked bookings
DO $$
DECLARE
  booking_record RECORD;
  new_customer_id UUID;
  nome_part TEXT;
  cognome_part TEXT;
BEGIN
  FOR booking_record IN 
    SELECT * FROM bookings 
    WHERE user_id IS NULL 
    AND customer_name IS NOT NULL
    AND customer_email IS NOT NULL
    AND id != '6304f31a-b81b-4c2f-9efa-67b9e35f75c6' -- Skip RICCARDO, already done
  LOOP
    -- Split name
    nome_part := SPLIT_PART(booking_record.customer_name, ' ', 1);
    cognome_part := SUBSTRING(booking_record.customer_name FROM LENGTH(nome_part) + 2);
    
    -- Check existing
    SELECT id INTO new_customer_id
    FROM customers_extended
    WHERE LOWER(email) = LOWER(booking_record.customer_email)
    LIMIT 1;
    
    -- Create if needed
    IF new_customer_id IS NULL THEN
      INSERT INTO customers_extended (user_id, nome, cognome, email, telefono, tipo_cliente, source)
      VALUES (
        NULL, -- No auth user
        nome_part, 
        COALESCE(cognome_part, ''), 
        booking_record.customer_email, 
        booking_record.customer_phone, 
        'persona_fisica', 
        'backfill_auto'
      )
      RETURNING id INTO new_customer_id;
      
      RAISE NOTICE 'Created customer % for %', new_customer_id, booking_record.customer_name;
    ELSE
      RAISE NOTICE 'Found existing customer % for %', new_customer_id, booking_record.customer_name;
    END IF;
    
    -- Store customer ID in booking_details
    UPDATE bookings 
    SET booking_details = COALESCE(booking_details, '{}'::jsonb) || jsonb_build_object('customer_id', new_customer_id)
    WHERE id = booking_record.id;
  END LOOP;
END $$;

-- Verification query
SELECT 
  COUNT(*) FILTER (WHERE user_id IS NULL AND booking_details->>'customer_id' IS NULL) as unlinked_bookings,
  COUNT(*) FILTER (WHERE user_id IS NOT NULL OR booking_details->>'customer_id' IS NOT NULL) as linked_bookings,
  COUNT(*) as total_bookings
FROM bookings
WHERE customer_name IS NOT NULL;
