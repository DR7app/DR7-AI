-- Acconti: a decidere e' SOLO la spunta, non il tag direzione.
--
-- Verifica del 20/08 sul database: Davide, Salvatore e Ophelie hanno tutti
-- `role:direzione`. La funzione precedente accettava quel tag come lasciapassare,
-- quindi vedevano gli acconti di tutti — l'esatto contrario della richiesta
-- ("David deve vedere solo i suoi, anche da superadmin").
--
-- Regola definitiva, una sola: vede tutti gli acconti chi ha `role:acconti-tutti`.
-- Unica eccezione, il failsafe di Valerio e Ilenia, che non possono restare
-- chiusi fuori dalla cassa se la spunta viene tolta per errore.
CREATE OR REPLACE FUNCTION public.dr7_can_see_all_acconti()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    lower(coalesce(auth.jwt() ->> 'email', '')) IN
      ('valerio@dr7.app', 'ilenia@dr7.app')
    OR EXISTS (
      SELECT 1
        FROM public.admins a
       WHERE a.user_id = auth.uid()
         AND a.archived_at IS NULL
         AND a.permissions @> '["role:acconti-tutti"]'::jsonb
    );
$$;

COMMENT ON FUNCTION public.dr7_can_see_all_acconti() IS
  'Vede tutti gli acconti SOLO chi ha il tag role:acconti-tutti (piu il failsafe valerio/ilenia). Ne superadmin ne role:direzione bastano: gli incassi personali non sono un dato di gestione condiviso.';

-- Verifica: chi vede gli acconti di tutti DOPO questa modifica.
-- Attesi: solo chi ha la spunta. Valerio e Ilenia passano dal failsafe e
-- possono non comparire qui.
SELECT email, nome,
       (permissions @> '["role:acconti-tutti"]'::jsonb) AS spunta_acconti
  FROM public.admins
 WHERE archived_at IS NULL
   AND permissions @> '["role:acconti-tutti"]'::jsonb
 ORDER BY email;
