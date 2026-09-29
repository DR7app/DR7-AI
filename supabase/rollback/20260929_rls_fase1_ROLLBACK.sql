-- ROLLBACK di 20260929_rls_fase1_aperte_a_tutti.sql
-- Rimette le policy ESATTAMENTE com'erano il 29/09/2026 prima della fase 1
-- (fotografia presa da pg_policies in produzione). Da usare solo se dopo la
-- fase 1 qualcosa del sito o del gestionale smette di funzionare.

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname, tablename FROM pg_policies
           WHERE schemaname = 'public' AND tablename IN (
             'admin_activity_log','booking_line_items','centralina_pro_config','discount_codes','fidelity_point_awards',
             'fleet_vehicle_inventory','google_reviews_config','immondizia_calendario','magazzino_ordini','movimenti_aerei',
             'payment_audit_logs','payment_config','payment_configurations','payment_method_config','payments',
             'pending_addebiti','refund_requests','refunds','sent_messages_log','system_messages','user_documents')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

CREATE POLICY "Admin full access on admin_activity_log" ON public.admin_activity_log AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "Admin full access on discount_codes" ON public.discount_codes AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "Admin full access on sent_messages_log" ON public.sent_messages_log AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "Admin full access on system_messages" ON public.system_messages AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "Admins can insert activity logs" ON public.admin_activity_log AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON public.discount_codes AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON public.fleet_vehicle_inventory AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated read
  system_messages" ON public.system_messages AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated update
  system_messages" ON public.system_messages AS PERMISSIVE FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Allow read centralina_pro_config" ON public.centralina_pro_config AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "Allow write centralina_pro_config" ON public.centralina_pro_config AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can read system_messages" ON public.system_messages AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can view config" ON public.google_reviews_config AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can view payment config" ON public.payment_config AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can view payment configurations" ON public.payment_configurations AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "Authenticated users can insert sent_messages_log" ON public.sent_messages_log AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Authenticated users can insert system_messages" ON public.system_messages AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Authenticated users can update documents" ON public.user_documents AS PERMISSIVE FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can update system_messages" ON public.system_messages AS PERMISSIVE FOR UPDATE TO public USING (true);
CREATE POLICY "Authenticated users can view documents" ON public.user_documents AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can view sent_messages_log" ON public.sent_messages_log AS PERMISSIVE FOR SELECT TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "Service can insert payments" ON public.payments AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Service can manage audit logs" ON public.payment_audit_logs AS PERMISSIVE FOR ALL TO public USING (true);
CREATE POLICY "Service can manage config" ON public.google_reviews_config AS PERMISSIVE FOR ALL TO public USING (true);
CREATE POLICY "Service can manage line items" ON public.booking_line_items AS PERMISSIVE FOR ALL TO public USING (true);
CREATE POLICY "Service can manage payment config" ON public.payment_config AS PERMISSIVE FOR ALL TO public USING (true);
CREATE POLICY "Service can manage payment configurations" ON public.payment_configurations AS PERMISSIVE FOR ALL TO public USING (true);
CREATE POLICY "Service can manage refund requests" ON public.refund_requests AS PERMISSIVE FOR ALL TO public USING (true);
CREATE POLICY "Service can manage refunds" ON public.refunds AS PERMISSIVE FOR ALL TO public USING (true);
CREATE POLICY "Service can update payments" ON public.payments AS PERMISSIVE FOR UPDATE TO public USING (true);
CREATE POLICY "Service role full access sent_messages_log" ON public.sent_messages_log AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.pending_addebiti AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Service role has full access" ON public.user_documents AS PERMISSIVE FOR ALL TO public USING (true);
CREATE POLICY "Superadmins can read activity logs" ON public.admin_activity_log AS PERMISSIVE FOR SELECT TO public USING (is_superadmin());
CREATE POLICY "Users can delete documents" ON public.user_documents AS PERMISSIVE FOR DELETE TO authenticated USING (true);
CREATE POLICY "Users can insert documents" ON public.user_documents AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Users can view own booking line items" ON public.booking_line_items AS PERMISSIVE FOR SELECT TO public USING ((booking_id IN ( SELECT bookings.id FROM bookings WHERE (bookings.user_id = auth.uid()))));
CREATE POLICY "Users can view own documents" ON public.user_documents AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can view own payments" ON public.payments AS PERMISSIVE FOR SELECT TO public USING ((((auth.uid() IS NOT NULL) AND (auth.uid() = user_id)) OR ((auth.uid() IS NULL) AND (user_id IS NULL))));
CREATE POLICY anon_select_discount_codes ON public.discount_codes AS PERMISSIVE FOR SELECT TO anon USING (true);
CREATE POLICY authenticated_all_discount_codes ON public.discount_codes AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY authenticated_full_admin_activity_log ON public.admin_activity_log AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY centralina_pro_insert_auth ON public.centralina_pro_config AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((id = 'main'::text) OR (id ~~ 'business\_%'::text)));
CREATE POLICY centralina_pro_read_public ON public.centralina_pro_config AS PERMISSIVE FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY centralina_pro_write_auth ON public.centralina_pro_config AS PERMISSIVE FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY fidelity_awards_service_role ON public.fidelity_point_awards AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY immondizia_read ON public.immondizia_calendario AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY immondizia_write ON public.immondizia_calendario AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY magazzino_ordini_read ON public.magazzino_ordini AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY magazzino_ordini_write ON public.magazzino_ordini AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);
CREATE POLICY movimenti_aerei_read ON public.movimenti_aerei AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY movimenti_aerei_write ON public.movimenti_aerei AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY payment_method_config_admin_all ON public.payment_method_config AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY payment_method_config_read_all ON public.payment_method_config AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY service_role_all_discount_codes ON public.discount_codes AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_full_admin_activity_log ON public.admin_activity_log AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

SELECT tablename, count(*) AS policy FROM pg_policies
 WHERE schemaname = 'public' AND tablename IN ('centralina_pro_config','discount_codes','system_messages','user_documents')
 GROUP BY 1 ORDER BY 1;
