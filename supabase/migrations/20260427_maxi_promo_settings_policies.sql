-- ============================================================
-- maxi_promo_settings — admin RLS policies.
-- The original migration enabled RLS but didn't create any
-- policies, so every admin read/upsert from the dashboard
-- returned 403. This adds SELECT + ALL access for any user
-- whose auth.uid() is registered in public.admins.
-- ============================================================

DROP POLICY IF EXISTS "Admins can read maxi_promo_settings" ON public.maxi_promo_settings;
CREATE POLICY "Admins can read maxi_promo_settings"
  ON public.maxi_promo_settings
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.admins
    WHERE admins.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Admins can write maxi_promo_settings" ON public.maxi_promo_settings;
CREATE POLICY "Admins can write maxi_promo_settings"
  ON public.maxi_promo_settings
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.admins
    WHERE admins.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.admins
    WHERE admins.user_id = auth.uid()
  ));
