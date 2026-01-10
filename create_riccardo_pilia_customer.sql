-- Step 1: Check if Riccardo PILIA exists in customers_extended
SELECT * FROM customers_extended 
WHERE id = '4eba7599-5cd0-44dc-a93b-ff7b6384baf7';

-- Step 2: Check auth.users for this ID
SELECT id, email, raw_user_meta_data 
FROM auth.users 
WHERE id = '4eba7599-5cd0-44dc-a93b-ff7b6384baf7';

-- Step 3: Create the missing customer record
-- Based on the booking data:
-- - ID: 4eba7599-5cd0-44dc-a93b-ff7b6384baf7
-- - Name: RICCARDO PILIA
-- - Email: r.p.system.srl@gmail.com
-- - Phone: +39 351 577 6809

INSERT INTO customers_extended (
    id,
    tipo_cliente,
    nome,
    cognome,
    email,
    telefono,
    created_at,
    updated_at
) VALUES (
    '4eba7599-5cd0-44dc-a93b-ff7b6384baf7',
    'persona_fisica',
    'RICCARDO',
    'PILIA',
    'r.p.system.srl@gmail.com',
    '+39 351 577 6809',
    NOW(),
    NOW()
)
ON CONFLICT (id) DO UPDATE SET
    nome = EXCLUDED.nome,
    cognome = EXCLUDED.cognome,
    email = COALESCE(customers_extended.email, EXCLUDED.email),
    telefono = COALESCE(customers_extended.telefono, EXCLUDED.telefono),
    updated_at = NOW();

-- Step 4: Verify the customer was created
SELECT id, tipo_cliente, nome, cognome, email, telefono, created_at
FROM customers_extended 
WHERE id = '4eba7599-5cd0-44dc-a93b-ff7b6384baf7';
