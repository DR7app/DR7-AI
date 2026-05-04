-- Backfill operatori_persone da tabella admins.
-- Per ogni admin in `admins` che non ha gia' una riga in operatori_persone
-- (match per email case-insensitive), inserisce una riga operatore con
-- nome/cognome derivati da admins.nome e user_id linkato ad auth.users
-- se l'admin si e' gia' registrato in Supabase Auth con la stessa email.

INSERT INTO operatori_persone (
  nome,
  cognome,
  email,
  user_id,
  ore_target_giornaliere,
  attivo
)
SELECT
  -- Prima parola di admins.nome, fallback all'email-local capitalizzato
  COALESCE(
    NULLIF(SPLIT_PART(TRIM(a.nome), ' ', 1), ''),
    INITCAP(SPLIT_PART(a.email, '@', 1))
  ) AS nome,
  -- Tutto il resto di admins.nome dopo la prima parola, NULL se vuoto
  NULLIF(
    TRIM(REGEXP_REPLACE(TRIM(COALESCE(a.nome, '')), '^\S+\s*', '')),
    ''
  ) AS cognome,
  LOWER(TRIM(a.email)) AS email,
  au.id AS user_id,
  8 AS ore_target_giornaliere,
  TRUE AS attivo
FROM admins a
LEFT JOIN auth.users au ON LOWER(au.email) = LOWER(TRIM(a.email))
WHERE a.email IS NOT NULL
  AND TRIM(a.email) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM operatori_persone op
    WHERE LOWER(op.email) = LOWER(TRIM(a.email))
  );

-- Per gli operatori gia' esistenti ma senza user_id, prova a linkarli
-- agli utenti Supabase Auth via email match (case-insensitive).
UPDATE operatori_persone op
SET user_id = au.id
FROM auth.users au
WHERE op.user_id IS NULL
  AND LOWER(au.email) = LOWER(TRIM(op.email));
