-- RLS fase 1 (29/09/2026): tabelle che CHIUNQUE poteva modificare, anche senza login
--
-- La chiave anon e' pubblica (sta nel JavaScript di dr7.app). Con le policy
-- trovate oggi, senza nessun account si poteva: riscrivere la Centralina
-- (prezzi, cauzioni, regole), creare codici sconto, riscrivere i template
-- WhatsApp dei clienti, leggere/modificare/cancellare user_documents, scrivere
-- in payments, refunds, pending_addebiti e nelle configurazioni di pagamento.
--
-- Nessun browser del sito scrive in queste tabelle (mappa del codice di Sito
-- e DR7-AI + 7 giorni di log API, 29/09/2026). Il gestionale le usa solo da
-- /admin, dove entrano soltanto gli utenti in `admins` = dr7_is_staff(). Il
-- server usa service_role, che salta RLS.
--
-- Dopo:
--   * staff (dr7_is_staff): tutto, come prima;
--   * lettura pubblica solo dove il sito la usa: centralina_pro_config,
--     system_messages;
--   * il cliente vede/aggiunge/cancella solo i SUOI user_documents, vede solo
--     i suoi payments e booking_line_items;
--   * tutto il resto: nessun accesso da anon o da clienti.
--
-- Ritorno indietro: supabase/rollback/20260929_rls_fase1_ROLLBACK.sql

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

-- Staff del gestionale su tutte le 21 tabelle. (select ...) = valutata una
-- volta per query, non per riga.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'admin_activity_log','booking_line_items','centralina_pro_config','discount_codes','fidelity_point_awards',
    'fleet_vehicle_inventory','google_reviews_config','immondizia_calendario','magazzino_ordini','movimenti_aerei',
    'payment_audit_logs','payment_config','payment_configurations','payment_method_config','payments',
    'pending_addebiti','refund_requests','refunds','sent_messages_log','system_messages','user_documents']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY "Staff full access" ON public.%I FOR ALL TO authenticated USING ((SELECT public.dr7_is_staff())) WITH CHECK ((SELECT public.dr7_is_staff()))', t);
  END LOOP;
END $$;

-- Il sito legge la Centralina e i testi dei messaggi anche senza login.
CREATE POLICY "Lettura pubblica" ON public.centralina_pro_config FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Lettura pubblica" ON public.system_messages FOR SELECT TO anon, authenticated USING (true);

-- Documenti del cliente: solo i propri.
CREATE POLICY "Cliente vede i suoi documenti" ON public.user_documents FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Cliente aggiunge i suoi documenti" ON public.user_documents FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Cliente cancella i suoi documenti" ON public.user_documents FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Pagamenti e righe prenotazione: solo i propri, in lettura.
CREATE POLICY "Cliente vede i suoi pagamenti" ON public.payments FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Cliente vede le sue righe prenotazione" ON public.booking_line_items FOR SELECT TO authenticated
  USING (booking_id IN (SELECT b.id FROM public.bookings b WHERE b.user_id = auth.uid()));

-- Verifica: nessuna policy aperta a chiunque in scrittura su queste tabelle.
SELECT tablename, policyname, cmd, roles::text, qual
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('admin_activity_log','booking_line_items','centralina_pro_config','discount_codes','fidelity_point_awards',
                     'fleet_vehicle_inventory','google_reviews_config','immondizia_calendario','magazzino_ordini','movimenti_aerei',
                     'payment_audit_logs','payment_config','payment_configurations','payment_method_config','payments',
                     'pending_addebiti','refund_requests','refunds','sent_messages_log','system_messages','user_documents')
 ORDER BY 1, 2;
