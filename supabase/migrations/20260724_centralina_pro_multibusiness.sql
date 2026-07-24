-- =============================================================================
-- Centralina Pro multi-business: consenti righe di config oltre a 'main'.
-- Terra resta 'main' (invariato). Gli altri business usano id 'business_*'.
-- Prima due vincoli bloccavano gli id != 'main':
--   1) CHECK di colonna  centralina_pro_config_id_check  (id = 'main')
--   2) policy INSERT      centralina_pro_insert_auth      WITH CHECK (id = 'main')
-- =============================================================================

-- 1) Rimuovi il CHECK di colonna che imponeva id = 'main'.
ALTER TABLE public.centralina_pro_config
  DROP CONSTRAINT IF EXISTS centralina_pro_config_id_check;

-- Consenti solo 'main' o righe business_* (niente id arbitrari).
ALTER TABLE public.centralina_pro_config
  DROP CONSTRAINT IF EXISTS centralina_pro_config_id_allowed;
ALTER TABLE public.centralina_pro_config
  ADD CONSTRAINT centralina_pro_config_id_allowed
  CHECK (id = 'main' OR id LIKE 'business\_%');

-- 2) Rilassa la policy di INSERT per accettare gli stessi id.
DROP POLICY IF EXISTS "centralina_pro_insert_auth" ON public.centralina_pro_config;
CREATE POLICY "centralina_pro_insert_auth"
  ON public.centralina_pro_config
  FOR INSERT
  TO authenticated
  WITH CHECK (id = 'main' OR id LIKE 'business\_%');
