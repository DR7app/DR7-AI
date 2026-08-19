-- Acconti: la spunta "Acconti: vede tutti" vale anche a livello di database.
--
-- Richiesta direzione (19/08/2026): David e' superadmin ma deve vedere SOLO i
-- propri acconti. Il ruolo non c'entra: a decidere e' una casella nella scheda
-- operatore (`role:acconti-tutti`), che l'amministrazione spunta caso per caso.
--
-- Senza questo aggiornamento la UI mostrerebbe la vista completa a chi ha la
-- spunta, ma la RLS continuerebbe a restituirgli solo le proprie righe.
CREATE OR REPLACE FUNCTION public.dr7_can_see_all_acconti()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    -- Failsafe direzione: non possono restare chiusi fuori dalla propria cassa.
    lower(coalesce(auth.jwt() ->> 'email', '')) IN
      ('valerio@dr7.app', 'ilenia@dr7.app')
    OR EXISTS (
      SELECT 1
        FROM public.admins a
       WHERE a.user_id = auth.uid()
         AND a.archived_at IS NULL
         AND ( a.permissions @> '["role:direzione"]'::jsonb
               OR a.permissions @> '["role:acconti-tutti"]'::jsonb )
    );
$$;

COMMENT ON FUNCTION public.dr7_can_see_all_acconti() IS
  'Vede gli acconti di TUTTI: direzione (failsafe o tag role:direzione) oppure chi ha il tag role:acconti-tutti. Volutamente NON basta essere superadmin.';

-- Verifica: chi oggi avrebbe accesso completo agli acconti.
SELECT email, nome,
       (permissions @> '["role:direzione"]'::jsonb)     AS tag_direzione,
       (permissions @> '["role:acconti-tutti"]'::jsonb) AS tag_acconti_tutti
  FROM public.admins
 WHERE archived_at IS NULL
   AND ( permissions @> '["role:direzione"]'::jsonb
         OR permissions @> '["role:acconti-tutti"]'::jsonb )
 ORDER BY email;
