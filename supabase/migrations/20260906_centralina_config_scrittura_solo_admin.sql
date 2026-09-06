-- ═══════════════════════════════════════════════════════════════════════════
--  centralina_pro_config: la legge tutto il sito, la scrive solo un operatore
--
--  06/09/2026 — una PATCH REST fatta con la sola chiave anon (nessun login,
--  quella chiave sta dentro il bundle JavaScript servito da dr7.app) riscrive
--  oggi la riga 'main' per intero: prezzi, orari, testi del sito, coefficienti,
--  destinatari delle notifiche. Verificato in produzione: risposta 204 e valori
--  cambiati davvero.
--
--  Le policy scritte in `20260418_create_centralina_pro_config.sql` dicevano
--  gia' UPDATE `TO authenticated`, quindi in produzione c'e' dell'altro che il
--  repository non ha (una policy aggiunta a mano dall'editor SQL, oppure RLS
--  spenta). Per questo qui sotto NON si tocca una policy per nome: si azzerano
--  tutte quelle presenti sulla tabella e si riscrive l'elenco completo.
--
--  Dopo questa migration:
--    - lettura pubblica invariata (il sito legge la config senza login: serve);
--    - scrittura solo a chi ha una riga in `admins` non archiviata, cioe'
--      esattamente chi puo' usare il gestionale (`leggiRigaAdmin` cerca
--      `admins.user_id = auth.uid()`, stessa identita');
--    - nessuna cancellazione, per nessuno;
--    - le Netlify Functions continuano a scrivere: usano la service role, che
--      salta le policy.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Chi e' un operatore del gestionale ─────────────────────────────────
-- Deliberatamente piu' larga di dr7_is_direzione(): la Centralina la cambiano
-- anche i ruoli operativi (prezzi, orari, messaggi), non solo la direzione.
-- Quello che taglia fuori e' il cliente del sito, che ha un token valido ma
-- nessuna riga in `admins`.
CREATE OR REPLACE FUNCTION public.dr7_is_operatore()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.admins a
     WHERE a.user_id = auth.uid()
       AND a.archived_at IS NULL
  );
$$;

COMMENT ON FUNCTION public.dr7_is_operatore() IS
  'true se l''utente collegato ha una riga admins non archiviata: identita'' usata da leggiRigaAdmin() nel gestionale.';

-- ── 2. RLS accesa e tavola pulita ─────────────────────────────────────────
ALTER TABLE public.centralina_pro_config ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'centralina_pro_config'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.centralina_pro_config', p.policyname);
    RAISE NOTICE 'rimossa policy %', p.policyname;
  END LOOP;
END $$;

-- ── 3. L'elenco completo, riscritto ───────────────────────────────────────

-- Lettura: pubblica. Il sito costruisce prezzi, orari e testi da qui prima
-- che il visitatore abbia un account.
CREATE POLICY "centralina_pro_read_public"
  ON public.centralina_pro_config
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Scrittura: solo operatori del gestionale.
CREATE POLICY "centralina_pro_update_operatore"
  ON public.centralina_pro_config
  FOR UPDATE
  TO authenticated
  USING (public.dr7_is_operatore())
  WITH CHECK (public.dr7_is_operatore());

-- Creazione righe: stessi id gia' ammessi dal CHECK di colonna
-- (main = Terra, business_* = gli altri).
CREATE POLICY "centralina_pro_insert_operatore"
  ON public.centralina_pro_config
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.dr7_is_operatore()
    AND (id = 'main' OR id LIKE 'business\_%')
  );

-- Nessuna policy di DELETE: la configurazione non si cancella, si modifica.

-- ── 4. Verifica ───────────────────────────────────────────────────────────
-- Attese: rls_abilitata = true, e tre righe — SELECT {anon,authenticated},
-- UPDATE {authenticated} con dr7_is_operatore(), INSERT {authenticated}.
SELECT
  (SELECT relrowsecurity
     FROM pg_class
    WHERE oid = 'public.centralina_pro_config'::regclass) AS rls_abilitata,
  p.policyname,
  p.cmd,
  p.roles,
  p.qual,
  p.with_check
FROM pg_policies p
WHERE p.schemaname = 'public'
  AND p.tablename  = 'centralina_pro_config'
ORDER BY p.cmd, p.policyname;
