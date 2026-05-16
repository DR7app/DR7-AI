-- ============================================================
-- Davide: rimuovi ruoli elevati cosi' gli OTP tornano a scattare.
--
-- Sintomo: Davide non riceveva piu' OTP per nessuna azione, anche
-- quando le regole in system_otp_overrides erano is_required=true.
-- Causa: nella riga admins di davide@dr7.app era stato aggiunto
-- 'role:direzione' (o 'role:developer'), che sbloccava i tab senza
-- richiedere l'OTP gestione_*_access + bypassava i check role-based
-- in ~10 tab admin.
--
-- Soluzione: rimuoviamo i ruoli da bypass (direzione, developer,
-- sito-direzione, payment-manager, stipendio-editor, preventivi-admin)
-- dalla sua riga permissions. Lasciamo i permessi tab-specifici (se
-- presenti) cosi' continua ad accedere ai tab a cui era abilitato,
-- ma con OTP richiesto come per gli altri operatori.
-- ============================================================

-- Prima vediamo cosa ha adesso (utile in log se serve debug):
DO $$
DECLARE
    cur_perms jsonb;
    davide_email text := 'davide@dr7.app';
BEGIN
    SELECT a.permissions INTO cur_perms
    FROM public.admins a
    JOIN auth.users u ON u.id = a.user_id
    WHERE LOWER(u.email) = davide_email;

    RAISE NOTICE 'Davide permissions PRIMA: %', cur_perms;
END $$;

-- Rimuovi i tag role:* sensibili.
UPDATE public.admins a
SET permissions = (
    SELECT COALESCE(
        jsonb_agg(p)
        FILTER (WHERE p NOT IN (
            to_jsonb('role:direzione'::text),
            to_jsonb('role:developer'::text),
            to_jsonb('role:sito-direzione'::text),
            to_jsonb('role:payment-manager'::text),
            to_jsonb('role:stipendio-editor'::text),
            to_jsonb('role:preventivi-admin'::text)
        )),
        '[]'::jsonb
    )
    FROM jsonb_array_elements(a.permissions) p
)
FROM auth.users u
WHERE u.id = a.user_id
  AND LOWER(u.email) = 'davide@dr7.app';

-- Conferma:
DO $$
DECLARE
    cur_perms jsonb;
    davide_email text := 'davide@dr7.app';
BEGIN
    SELECT a.permissions INTO cur_perms
    FROM public.admins a
    JOIN auth.users u ON u.id = a.user_id
    WHERE LOWER(u.email) = davide_email;

    RAISE NOTICE 'Davide permissions DOPO: %', cur_perms;
END $$;
