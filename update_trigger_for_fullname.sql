-- =====================================================
-- UPDATED AUTH USER SYNC TRIGGER
-- =====================================================
-- This trigger handles BOTH metadata formats:
-- 1. nome/cognome/telefono (Italian format)
-- 2. fullName/phone (English format from website)
-- =====================================================

-- Step 1: Create the updated trigger function
CREATE OR REPLACE FUNCTION sync_auth_user_to_customers()
RETURNS TRIGGER AS $$
DECLARE
  nome_value TEXT;
  cognome_value TEXT;
  telefono_value TEXT;
  existing_id UUID;
  full_name TEXT;
BEGIN
  -- Extract metadata - try both formats
  -- Format 1: Italian (nome, cognome, telefono)
  nome_value := NEW.raw_user_meta_data->>'nome';
  cognome_value := NEW.raw_user_meta_data->>'cognome';
  telefono_value := NEW.raw_user_meta_data->>'telefono';
  
  -- Format 2: English (fullName, phone) - used by website
  full_name := NEW.raw_user_meta_data->>'fullName';
  IF full_name IS NOT NULL AND nome_value IS NULL THEN
    -- Split fullName into nome and cognome
    nome_value := split_part(full_name, ' ', 1);
    cognome_value := substring(full_name from position(' ' in full_name) + 1);
  END IF;
  
  -- Get phone from either telefono or phone
  IF telefono_value IS NULL THEN
    telefono_value := NEW.raw_user_meta_data->>'phone';
  END IF;
  
  -- Only create customer record if we have at least email
  IF NEW.email IS NOT NULL THEN
    -- Check if customer already exists
    SELECT id INTO existing_id
    FROM customers_extended
    WHERE user_id = NEW.id
    LIMIT 1;
    
    IF existing_id IS NULL THEN
      -- Insert new customer
      INSERT INTO customers_extended (
        user_id,
        email,
        nome,
        cognome,
        telefono,
        tipo_cliente,
        nazione,
        source,
        created_at
      ) VALUES (
        NEW.id,
        NEW.email,
        COALESCE(nome_value, ''),
        COALESCE(cognome_value, ''),
        COALESCE(telefono_value, ''),
        'persona_fisica',
        'Italia',
        'website_registration',
        NEW.created_at
      );
      
      RAISE NOTICE 'Auto-created customer for user: % (email: %, name: % %)', 
        NEW.id, NEW.email, nome_value, cognome_value;
    ELSE
      -- Update existing customer
      UPDATE customers_extended SET
        email = NEW.email,
        nome = COALESCE(nome_value, nome),
        cognome = COALESCE(cognome_value, cognome),
        telefono = COALESCE(telefono_value, telefono),
        updated_at = NOW()
      WHERE user_id = NEW.id;
      
      RAISE NOTICE 'Updated existing customer for user: % (email: %)', NEW.id, NEW.email;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 2: Recreate the trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION sync_auth_user_to_customers();

-- Step 3: Verify trigger was created
SELECT 
  trigger_name,
  event_manipulation,
  event_object_table
FROM information_schema.triggers
WHERE trigger_name = 'on_auth_user_created';

-- Success message
DO $$
BEGIN
  RAISE NOTICE '✅ Updated trigger created! Now handles both nome/cognome/telefono AND fullName/phone formats.';
END $$;
