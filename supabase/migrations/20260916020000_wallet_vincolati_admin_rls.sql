-- ═══════════════════════════════════════════════════════════════════════════
-- CREDITO VINCOLATO: LO STAFF DEVE POTERLO VEDERE — 16/09/2026
--
-- BUG: la tabella nasceva con una sola policy, "ognuno vede i propri lotti"
-- (user_id = auth.uid()). Nel gestionale, pero', chi guarda e' un OPERATORE:
-- la sua auth.uid() non e' quella del cliente, quindi la lettura tornava
-- SEMPRE VUOTA. Risultato: si caricavano 200 EUR di credito vincolato, il
-- database li scriveva, e ogni schermata continuava a mostrare 0,00. Nessun
-- deploy poteva risolverlo: mancava il permesso, non il codice.
--
-- Stessa regola delle altre tabelle del gestionale (customers_extended):
-- chi e' in `admins` vede e gestisce tutto; il cliente continua a vedere
-- soltanto i propri lotti.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS wcv_staff ON public.wallet_crediti_vincolati;
CREATE POLICY wcv_staff ON public.wallet_crediti_vincolati
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()));

DROP POLICY IF EXISTS wcvm_staff ON public.wallet_crediti_vincolati_movimenti;
CREATE POLICY wcvm_staff ON public.wallet_crediti_vincolati_movimenti
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()));

GRANT INSERT, UPDATE, DELETE ON public.wallet_crediti_vincolati TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.wallet_crediti_vincolati_movimenti TO authenticated;
