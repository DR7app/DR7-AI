-- Setup Nicola Frongia (versione corretta)
UPDATE public.admins
SET permissions = '[
       "reservations-preventivi",
       "preventivo-template-only",
       "calendar",
       "hide:vehicle-plate:TEST000",
       "hide:vehicle-plate:TEST002"
     ]'::jsonb
WHERE LOWER(email) = 'nicolafrongia@dr7.app';

-- Verifica
SELECT id, email, permissions
FROM public.admins
WHERE LOWER(email) = 'nicolafrongia@dr7.app';
