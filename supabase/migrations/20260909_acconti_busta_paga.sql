-- ============================================================================
-- Acconti collegati alle buste paga (09/09/2026, richiesta direzione)
--
-- L'acconto della tab Acconti e' un ANTICIPO SUL SALARIO consegnato al
-- collaboratore: e' un fatto interno tra azienda e operatore, e va scalato dal
-- totale della busta paga del periodo. Chi calcola le buste paga deve quindi
-- vedere gli acconti di TUTTI gli operatori, altrimenti il netto mostrato non
-- ha scalato niente e si paga due volte la stessa somma.
--
-- Cosa NON si tocca: `dr7_can_see_all_acconti()` e le policy della tab Acconti
-- restano strette (solo la spunta `role:acconti-tutti` + failsafe
-- Valerio/Ilenia). Il registro giornaliero della cassa resta riservato; qui si
-- apre SOLO la lettura che serve al calcolo delle paghe, attraverso una
-- funzione dedicata.
--
-- Il gate della funzione e' lo stesso della UI (OperatoriTab -> Buste Paga):
-- direzione / developer / stipendio-editor, MENO gli operatori "solo miei
-- dati" (REPORT_RESTRICTED_EMAILS in src/utils/reportAccess.ts), che vedono
-- unicamente i propri acconti come vedono unicamente la propria busta paga.
-- ============================================================================

-- Chi puo' vedere le buste paga di TUTTI gli operatori.
-- SECURITY DEFINER: deve leggere `admins` anche quando la RLS di quella
-- tabella non lo permetterebbe al chiamante.
CREATE OR REPLACE FUNCTION public.dr7_puo_vedere_buste_paga_tutti()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- Operatori "solo miei dati": mai i dati altrui, nemmeno con i permessi.
    -- Stessa lista di REPORT_RESTRICTED_EMAILS lato client.
    lower(coalesce(auth.jwt() ->> 'email', '')) NOT IN
      ('salvatore@dr7.app', 'alessiocasula@dr7.app', 'alekskiszka@dr7.app')
    AND (
      -- Failsafe: direzione e developer non possono restare chiusi fuori dalle
      -- paghe se `admins.permissions` viene svuotato. Stesso ROLE_FAILSAFE di
      -- useAdminRole.ts, limitato ai ruoli che aprono le buste paga.
      lower(coalesce(auth.jwt() ->> 'email', '')) IN
        ('valerio@dr7.app', 'ilenia@dr7.app', 'ophe@dr7.app')
      OR EXISTS (
        SELECT 1
          FROM public.admins a
         WHERE a.user_id = auth.uid()
           AND a.archived_at IS NULL
           AND (
             a.permissions @> '["role:direzione"]'::jsonb
             OR a.permissions @> '["role:developer"]'::jsonb
             OR a.permissions @> '["role:stipendio-editor"]'::jsonb
           )
      )
    );
$$;

COMMENT ON FUNCTION public.dr7_puo_vedere_buste_paga_tutti() IS
  'Vede le buste paga di tutti gli operatori: direzione / developer / stipendio-editor (failsafe valerio, ilenia, ophe), escluse le email "solo miei dati". Stesso gate della tab Operatori -> Buste Paga.';

-- Acconti del periodo per il calcolo delle buste paga.
-- Restituisce gli acconti di tutti gli operatori a chi calcola le paghe, e i
-- soli acconti propri a chiunque altro (stesso ripiego per nome della RLS,
-- per le righe vecchie senza operatore_id).
CREATE OR REPLACE FUNCTION public.dr7_acconti_busta_paga(p_da DATE, p_a DATE)
RETURNS TABLE (
  id               UUID,
  operatore_id     UUID,
  operatore_nome   TEXT,
  data             DATE,
  importo_cents    INTEGER,
  causale          TEXT,
  metodo_pagamento TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.operatore_id, a.operatore_nome, a.data,
         a.importo_cents, a.causale, a.metodo_pagamento
    FROM public.acconti_giornalieri a
   WHERE a.data >= p_da
     AND a.data <= p_a
     AND (
       public.dr7_puo_vedere_buste_paga_tutti()
       OR a.operatore_id = public.dr7_admin_id()
       OR (a.operatore_id IS NULL
           AND a.operatore_nome IS NOT NULL
           AND a.operatore_nome = public.dr7_admin_nome())
     )
   ORDER BY a.data, a.id;
$$;

COMMENT ON FUNCTION public.dr7_acconti_busta_paga(DATE, DATE) IS
  'Acconti (anticipi sul salario) del periodo, per scalarli dalla busta paga. Tutti gli operatori per chi calcola le paghe, solo i propri per gli altri. La tab Acconti continua a leggere la tabella con la sua RLS piu stretta.';

REVOKE ALL ON FUNCTION public.dr7_acconti_busta_paga(DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dr7_acconti_busta_paga(DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dr7_puo_vedere_buste_paga_tutti() TO authenticated;

-- Verifica: chi vede le buste paga di tutti dopo questa migrazione.
-- Attesi: direzione, developer e stipendio-editor non archiviati; Salvatore e
-- i lavaggisti NON devono comparire come "vede tutti".
SELECT email, nome,
       (permissions @> '["role:direzione"]'::jsonb)        AS direzione,
       (permissions @> '["role:developer"]'::jsonb)        AS developer,
       (permissions @> '["role:stipendio-editor"]'::jsonb) AS stipendio_editor
  FROM public.admins
 WHERE archived_at IS NULL
   AND (permissions @> '["role:direzione"]'::jsonb
        OR permissions @> '["role:developer"]'::jsonb
        OR permissions @> '["role:stipendio-editor"]'::jsonb)
 ORDER BY email;
