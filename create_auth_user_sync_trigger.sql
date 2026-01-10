-- =====================================================
-- CREATE AUTH USER SYNC TRIGGER
-- =====================================================
-- This trigger automatically creates a customers_extended record
-- when a new user registers on the main website via auth.users
-- =====================================================

-- Step 1: Create the trigger function
CREATE OR REPLACE FUNCTION sync_auth_user_to_customers()
RETURNS TRIGGER AS $$
DECLARE
  nome_value TEXT;
  cognome_value TEXT;
  telefono_value TEXT;
BEGIN
  -- Extract metadata from raw_user_meta_data
  -- The main website registration should store: nome, cognome, telefono
  nome_value := NEW.raw_user_meta_data->>'nome';
  cognome_value := NEW.raw_user_meta_data->>'cognome';
  telefono_value := NEW.raw_user_meta_data->>'telefono';
  
  -- Only create customer record if we have at least email
  -- (nome and cognome might be optional on registration)
  IF NEW.email IS NOT NULL THEN
    -- Insert into customers_extended
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
    )
    ON CONFLICT (user_id) DO UPDATE SET
      email = EXCLUDED.email,
      nome = COALESCE(EXCLUDED.nome, customers_extended.nome),
      cognome = COALESCE(EXCLUDED.cognome, customers_extended.cognome),
      telefono = COALESCE(EXCLUDED.telefono, customers_extended.telefono),
      updated_at = NOW();
    
    RAISE NOTICE 'Auto-created customer for user: % (email: %)', NEW.id, NEW.email;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 2: Create the trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION sync_auth_user_to_customers();

-- Step 3: Verify trigger was created
SELECT 
  trigger_name,
  event_manipulation,
  event_object_table,
  action_statement
FROM information_schema.triggers
WHERE trigger_name = 'on_auth_user_created';

-- Success message
DO $$
BEGIN
  RAISE NOTICE '✅ Trigger created successfully! New user registrations will now automatically sync to customers_extended.';
END $$;
