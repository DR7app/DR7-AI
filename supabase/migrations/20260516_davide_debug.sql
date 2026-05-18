-- Diagnostic: dove vive davide@dr7.app nel sistema?
-- Esegui ognuna delle 4 query separatamente in Supabase SQL Editor
-- e mandami l'output di ciascuna. Cosi' capisco DOVE sta il bypass OTP.

-- 1) Auth users (qualunque casing del dominio)
SELECT id, email, created_at, last_sign_in_at
FROM auth.users
WHERE LOWER(email) LIKE '%davide%';

-- 2) Admins (con email da auth.users)
SELECT a.id, a.user_id, a.role, a.nome, a.permissions, u.email
FROM public.admins a
JOIN auth.users u ON u.id = a.user_id
WHERE LOWER(u.email) LIKE '%davide%';

-- 3) Operatori_persone (potrebbe avere bypass via ruolo)
SELECT id, user_id, email, nome, cognome, ruolo, attivo
FROM public.operatori_persone
WHERE LOWER(email) LIKE '%davide%';

-- 4) System OTP overrides — qualche regola disattivata?
SELECT id, label, is_required, used_in, updated_at
FROM public.system_otp_overrides
WHERE is_required = false
ORDER BY updated_at DESC;
