-- Accessi recenti al sito, letti direttamente da auth.users.
--
-- Perche': il pannello "Accessi al sito" usava la function list-site-users, che
-- pagina TUTTI gli account auth (1000 per volta) prima di restituire qualcosa.
-- Con il volume attuale supera i 20 secondi e il riquadro va in timeout. Inoltre
-- l'arricchimento con i nomi soffre del limite di 1000 righe di PostgREST.
--
-- Qui il filtro sta nel database: si chiedono SOLO gli accessi del periodo, gia'
-- ordinati e con nome e cognome uniti. Risposta immediata.
--
-- SECURITY DEFINER perche' auth.users non e' esposto a PostgREST. L'accesso e'
-- ristretto agli operatori NON archiviati: dr7_admin_id() torna NULL per
-- chiunque altro (clienti del sito compresi, che condividono lo stesso progetto).
CREATE OR REPLACE FUNCTION public.dr7_recent_logins(
  p_from  TIMESTAMPTZ DEFAULT NULL,
  p_to    TIMESTAMPTZ DEFAULT NULL,
  p_limit INTEGER     DEFAULT 300
)
RETURNS TABLE (
  id               UUID,
  email            TEXT,
  nome             TEXT,
  cognome          TEXT,
  last_sign_in_at  TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id,
         u.email::text,
         COALESCE(c.nome, '')    AS nome,
         COALESCE(c.cognome, '') AS cognome,
         u.last_sign_in_at
    FROM auth.users u
    LEFT JOIN public.customers_extended c ON c.user_id = u.id
   WHERE public.dr7_admin_id() IS NOT NULL      -- solo operatori del gestionale
     AND u.last_sign_in_at IS NOT NULL
     AND (p_from IS NULL OR u.last_sign_in_at >= p_from)
     AND (p_to   IS NULL OR u.last_sign_in_at <= p_to)
   ORDER BY u.last_sign_in_at DESC
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 300), 1000));
$$;

REVOKE ALL ON FUNCTION public.dr7_recent_logins(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dr7_recent_logins(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) TO authenticated;

COMMENT ON FUNCTION public.dr7_recent_logins IS
  'Accessi al sito nel periodo, da auth.users + nome cliente. Solo per operatori non archiviati.';

-- Verifica: accessi di oggi.
SELECT count(*) AS accessi_oggi
  FROM public.dr7_recent_logins(date_trunc('day', now()), now(), 1000);
