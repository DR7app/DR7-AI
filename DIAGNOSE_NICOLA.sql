-- Diagnostica Nicola Frongia: verifica che la riga admins sia OK
-- e collegata correttamente al suo auth user.

-- 1) Riga in admins
SELECT id, email, nome, role, user_id, permissions
FROM public.admins
WHERE LOWER(email) = 'nicolafrongia@dr7.app';

-- 2) Riga in auth.users (per verificare user_id match)
SELECT id, email, last_sign_in_at
FROM auth.users
WHERE LOWER(email) = 'nicolafrongia@dr7.app';

-- 3) Se user_id non è settato in admins, collegalo qui:
/*
UPDATE public.admins
SET user_id = (SELECT id FROM auth.users WHERE LOWER(email) = 'nicolafrongia@dr7.app' LIMIT 1)
WHERE LOWER(email) = 'nicolafrongia@dr7.app';
*/

-- 4) Re-applica i permessi corretti (se 1) mostra valori sbagliati):
UPDATE public.admins
SET permissions = '[
       "reservations-preventivi",
       "preventivo-template-only",
       "calendar",
       "hide:vehicle-plate:TEST000",
       "hide:vehicle-plate:TEST002"
     ]'::jsonb
WHERE LOWER(email) = 'nicolafrongia@dr7.app';

-- 5) Verifica finale
SELECT id, email, role, user_id, permissions
FROM public.admins
WHERE LOWER(email) = 'nicolafrongia@dr7.app';
