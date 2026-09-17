-- ═══════════════════════════════════════════════════════════════════════════
-- CREDIT WALLET: SERVE IL CODICE DEL CLIENTE — 17/09/2026
--
-- Decisione della direzione: nessun prelievo dal Credit Wallet fatto da un
-- operatore del gestionale senza il codice che il cliente riceve via email
-- (netlify/functions/wallet-autorizzazione-cliente.ts). Le schermate chiedono
-- il codice (hook useAutorizzazioneWallet) e lo salvano in
-- bookings.booking_details.wallet_autorizzazione_cliente.override_id. Qui il
-- database lo controlla, cosi' nessuna schermata — anche dimenticata o futura —
-- puo' prelevare senza.
--
-- Chi NON e' vincolato, di proposito:
--   - il cliente che paga da se' dal sito (auth.uid() = titolare del wallet);
--   - i server e i cron (service_role, nessun utente loggato), SQL a mano;
--   - gli storni (importo negativo) e i salvataggi che non cambiano l'importo.
--
-- L'autorizzazione e' un BUDGET: autorizza fino a `importo` EUR per quel
-- cliente. Ogni prelievo scala `metadata.residuo`; a zero la riga diventa
-- 'consumed'. Lo stesso codice non puo' pagare due volte.
--
-- Codice errore DR7WA, rilanciato dal trigger come DR7WL (credito insufficiente).
-- Prova: npm run wallet:autorizzazione (PGlite).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Consumo di un'autorizzazione (uso comune: trigger e addebito manuale) ──
CREATE OR REPLACE FUNCTION public.dr7_wallet_consuma_autorizzazione(
  p_override    UUID,
  p_account     UUID,
  p_importo     NUMERIC,
  p_riferimento JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_riga         public.limitation_overrides%ROWTYPE;
  v_cliente      UUID;
  v_account_aut  UUID;
  v_residuo      NUMERIC;
  v_nuovo        NUMERIC;
BEGIN
  IF p_override IS NULL THEN
    RAISE EXCEPTION 'Serve il codice del cliente per prelevare % EUR dal Credit Wallet: premi "Richiedi autorizzazione" e inserisci il codice che il cliente riceve via email.',
      to_char(p_importo, 'FM999999990.00')
      USING ERRCODE = 'DR7WA';
  END IF;

  SELECT * INTO v_riga
    FROM public.limitation_overrides
   WHERE id = p_override
     AND limitation_code = 'wallet_autorizzazione_cliente'
     AND otp_verified
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Codice del cliente non valido o non confermato: richiedi un nuovo codice per il Credit Wallet.'
      USING ERRCODE = 'DR7WA';
  END IF;

  BEGIN
    v_cliente := nullif(v_riga.metadata->>'customer_id', '')::uuid;
  EXCEPTION WHEN others THEN
    v_cliente := NULL;
  END;
  v_account_aut := public.dr7_wallet_account_del_cliente(v_cliente, NULL);

  IF v_account_aut IS NULL OR v_account_aut <> p_account THEN
    RAISE EXCEPTION 'Il codice inserito appartiene a un altro cliente: richiedi il codice al titolare del Credit Wallet.'
      USING ERRCODE = 'DR7WA';
  END IF;

  v_residuo := round(coalesce((v_riga.metadata->>'residuo')::numeric,
                              (v_riga.metadata->>'importo')::numeric, 0), 2);

  IF v_residuo + 0.005 < p_importo THEN
    RAISE EXCEPTION 'Il codice del cliente copre ancora % EUR, ne servono %: richiedi un nuovo codice.',
      to_char(v_residuo, 'FM999999990.00'), to_char(p_importo, 'FM999999990.00')
      USING ERRCODE = 'DR7WA';
  END IF;

  v_nuovo := round(v_residuo - p_importo, 2);

  UPDATE public.limitation_overrides
     SET metadata = coalesce(metadata, '{}'::jsonb)
                    || jsonb_build_object(
                         'residuo', v_nuovo,
                         'utilizzi', coalesce(metadata->'utilizzi', '[]'::jsonb)
                                     || jsonb_build_array(coalesce(p_riferimento, '{}'::jsonb)
                                          || jsonb_build_object('importo', p_importo, 'il', now()))),
         status      = CASE WHEN v_nuovo < 0.01 THEN 'consumed' ELSE status END,
         consumed_at = CASE WHEN v_nuovo < 0.01 THEN now() ELSE consumed_at END,
         updated_at  = now()
   WHERE id = p_override;
END;
$$;

REVOKE ALL ON FUNCTION public.dr7_wallet_consuma_autorizzazione(UUID, UUID, NUMERIC, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dr7_wallet_consuma_autorizzazione(UUID, UUID, NUMERIC, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.dr7_wallet_consuma_autorizzazione(UUID, UUID, NUMERIC, JSONB) TO service_role;

-- ── 2. Il controllo del trigger: chi scrive, e con quale codice ─────────────
CREATE OR REPLACE FUNCTION public.dr7_wallet_verifica_autorizzazione(
  p_booking UUID,
  p_account UUID,
  p_importo NUMERIC,
  p_details JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      UUID;
  v_ruolo    TEXT;
  v_override UUID;
BEGIN
  v_uid := auth.uid();
  v_ruolo := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb)->>'role',
    '');

  -- Server, cron, SQL a mano: nessun utente loggato.
  IF v_uid IS NULL OR v_ruolo = 'service_role' THEN
    RETURN;
  END IF;

  -- Il titolare del wallet che paga da se' (sito).
  IF v_uid = p_account THEN
    RETURN;
  END IF;

  BEGIN
    v_override := nullif(p_details->'wallet_autorizzazione_cliente'->>'override_id', '')::uuid;
  EXCEPTION WHEN others THEN
    v_override := NULL;
  END;

  PERFORM public.dr7_wallet_consuma_autorizzazione(
    v_override, p_account, p_importo,
    jsonb_build_object('booking_id', p_booking, 'operatore', v_uid));
END;
$$;

REVOKE ALL ON FUNCTION public.dr7_wallet_verifica_autorizzazione(UUID, UUID, NUMERIC, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dr7_wallet_verifica_autorizzazione(UUID, UUID, NUMERIC, JSONB) FROM authenticated;

-- ── 3. Il trigger (versione in produzione al 17/09/2026 + passo f2) ─────────
CREATE OR REPLACE FUNCTION public.dr7_wallet_sync_prenotazione()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id        UUID;
  v_dovuto         NUMERIC := 0;
  v_dovuto_prima   NUMERIC := 0;
  v_gia_addebitato NUMERIC := 0;
  v_base           NUMERIC := 0;
  v_delta          NUMERIC := 0;
  v_saldo          NUMERIC;
  v_nuovo_saldo    NUMERIC;
  v_movimento      UUID;
  v_descrizione    TEXT;
  v_riferimento    TEXT;
  v_stato          TEXT;
  v_da_vincolati   NUMERIC := 0;   -- quanto copre il credito vincolato
  v_delta_libero   NUMERIC := 0;   -- quanto resta al saldo libero
  v_disponibile    NUMERIC := 0;
BEGIN
  -- (a) Niente da fare se non e' cambiato nulla che riguardi il pagamento.
  --     Un salvataggio che tocca solo le note non deve nemmeno leggere il wallet.
  IF TG_OP = 'UPDATE'
     AND NEW.payment_method  IS NOT DISTINCT FROM OLD.payment_method
     AND NEW.payment_status  IS NOT DISTINCT FROM OLD.payment_status
     AND NEW.price_total     IS NOT DISTINCT FROM OLD.price_total
     AND NEW.amount_paid     IS NOT DISTINCT FROM OLD.amount_paid
     AND NEW.user_id         IS NOT DISTINCT FROM OLD.user_id
     AND NEW.customer_email  IS NOT DISTINCT FROM OLD.customer_email THEN
    RETURN NEW;
  END IF;

  -- (b) Prenotazioni di prova: non toccano mai denaro vero.
  IF coalesce(NEW.vehicle_plate, '') ILIKE 'TEST%'
     OR lower(coalesce(NEW.vehicle_name, '')) = 'test' THEN
    RETURN NEW;
  END IF;

  v_dovuto := public.dr7_wallet_importo_dovuto(
    NEW.payment_method, NEW.payment_status, NEW.price_total, NEW.amount_paid);

  IF TG_OP = 'UPDATE' THEN
    v_dovuto_prima := public.dr7_wallet_importo_dovuto(
      OLD.payment_method, OLD.payment_status, OLD.price_total, OLD.amount_paid);
  END IF;

  -- Prenotazione annullata: il wallet non si tocca. Il rimborso segue la
  -- politica di cancellazione (10% trattenuto, 90% a credito), che e' un
  -- flusso a parte con le sue regole. Qui si congela la situazione attuale.
  v_stato := lower(btrim(coalesce(NEW.status, '')));
  IF v_stato IN ('cancelled', 'annullata', 'canceled', 'expired') THEN
    RETURN NEW;
  END IF;

  -- Nessun movimento previsto ne' prima ne' adesso: strada piu' corta.
  IF v_dovuto = 0 AND v_dovuto_prima = 0 THEN
    RETURN NEW;
  END IF;

  -- (c) Il cliente e il suo wallet. Senza account sito non esiste un wallet da
  --     addebitare: si avvisa e si lascia passare la prenotazione (la scheda
  --     del gestionale lo segnala all'operatore prima del salvataggio).
  -- 16/09/2026: `bookings.user_id` e' l'account del sito quando la
  -- prenotazione arriva dal sito, ma e' l'id della SCHEDA CLIENTE quando la
  -- scrive il gestionale. Chiedere sempre e comunque un account qui dentro
  -- voleva dire non addebitare mai le prenotazioni fatte dall'ufficio.
  v_user_id := public.dr7_wallet_account_del_cliente(NEW.user_id, NEW.customer_email);

  IF v_user_id IS NULL THEN
    RAISE WARNING '[wallet] prenotazione % con metodo wallet ma nessun account cliente: addebito non eseguito', NEW.id;
    RETURN NEW;
  END IF;

  -- (d) Quanto e' gia' stato prelevato PER QUESTA prenotazione.
  --     Si contano solo gli addebiti collegati e gli storni emessi da qui:
  --     un eventuale cashback accreditato sulla stessa prenotazione non deve
  --     far sembrare che il cliente abbia pagato di meno.
  SELECT coalesce(sum(
           CASE WHEN ct.transaction_type = 'debit' THEN ct.amount
                WHEN ct.reference_type = 'booking_refund' THEN -ct.amount
                ELSE 0 END), 0)
    INTO v_gia_addebitato
    FROM public.credit_transactions ct
   WHERE ct.reference_id = NEW.id;

  -- (e) Adozione: il sito addebita il wallet e SUBITO DOPO crea la
  --     prenotazione, senza poter scrivere un reference_id che ancora non
  --     esiste. Se troviamo quell'addebito, lo colleghiamo a questa
  --     prenotazione invece di prelevare una seconda volta.
  IF v_gia_addebitato = 0 AND TG_OP = 'INSERT' AND v_dovuto > 0 THEN
    SELECT ct.id INTO v_movimento
      FROM public.credit_transactions ct
     WHERE ct.user_id = v_user_id
       AND ct.transaction_type = 'debit'
       AND ct.reference_id IS NULL
       AND ct.reference_type IS NULL
       AND abs(ct.amount - v_dovuto) < 0.01
       AND ct.created_at >= now() - interval '15 minutes'
     ORDER BY ct.created_at DESC
     LIMIT 1;

    IF v_movimento IS NOT NULL THEN
      UPDATE public.credit_transactions
         SET reference_id   = NEW.id,
             reference_type = 'booking_payment',
             service_type   = coalesce(service_type, NEW.service_type)
       WHERE id = v_movimento;
      RAISE NOTICE '[wallet] movimento % collegato alla prenotazione % (addebito gia effettuato dal sito)', v_movimento, NEW.id;
      RETURN NEW;
    END IF;
  END IF;

  -- (f) Base di calcolo. Se il registro parla, vince il registro. Altrimenti,
  --     su una MODIFICA, si assume che l'importo gia' dovuto prima fosse stato
  --     incassato: si movimenta solo la differenza, non tutto da capo.
  IF v_gia_addebitato > 0 THEN
    v_base := v_gia_addebitato;
  ELSIF TG_OP = 'UPDATE' THEN
    v_base := v_dovuto_prima;
  ELSE
    v_base := 0;
  END IF;

  v_delta := round(v_dovuto - v_base, 2);

  -- Non si restituisce denaro che non risulta prelevato da noi, e non si
  -- restituisce piu' di quanto prelevato.
  IF v_delta < 0 THEN
    IF v_gia_addebitato <= 0 THEN
      v_delta := 0;
    ELSE
      v_delta := greatest(v_delta, -v_gia_addebitato);
    END IF;
  END IF;

  IF abs(v_delta) < 0.01 THEN
    RETURN NEW;
  END IF;

  -- (f2) 17/09/2026 (direzione): un prelievo fatto da un operatore del
  --      gestionale vuole il codice del cliente (email). La verifica e il
  --      consumo dell'autorizzazione stanno in dr7_wallet_verifica_autorizzazione:
  --      se manca o non copre l'importo, errore DR7WA e la scrittura si ferma.
  IF v_delta > 0 THEN
    PERFORM public.dr7_wallet_verifica_autorizzazione(NEW.id, v_user_id, v_delta, NEW.booking_details);
  END IF;

  -- (g1) Credito VINCOLATO (16/09/2026). Prima di toccare il saldo libero si
  --      consumano i lotti validi per QUESTO servizio, il piu' stretto e il
  --      piu' vicino a scadere per primo: altrimenti il credito a scadenza
  --      muore nel wallet mentre si spende quello che non scade mai.
  --      Sullo storno si restituisce a ogni lotto quello che quel lotto aveva
  --      pagato su questa prenotazione, non al saldo libero.
  IF v_delta > 0 THEN
    v_da_vincolati := public.dr7_wallet_consuma_vincolato(v_user_id, v_delta, NEW.service_type, NEW.id);
  ELSE
    v_da_vincolati := - public.dr7_wallet_restituisci_vincolato(v_user_id, -v_delta, NEW.id);
  END IF;

  v_delta_libero := round(v_delta - v_da_vincolati, 2);

  -- (g2) Movimento sul saldo libero. La riga si blocca: due salvataggi in
  --      parallelo non possono spendere lo stesso credito.
  SELECT balance INTO v_saldo
    FROM public.user_credit_balance
   WHERE user_id = v_user_id
   FOR UPDATE;

  IF v_saldo IS NULL THEN
    v_saldo := 0;
    INSERT INTO public.user_credit_balance (user_id, balance, last_updated)
         VALUES (v_user_id, 0, now())
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  v_nuovo_saldo := round(v_saldo - v_delta_libero, 2);

  -- Saldo insufficiente: SI RIFIUTA. Regola della direzione (15/09/2026):
  -- una prenotazione non puo' essere pagata con un credito che non c'e'. Il
  -- gestionale mostra il popup prima di arrivare qui, ma il salvataggio passa
  -- da molte schermate (Da Saldare > segna pagato, check-out, estensioni,
  -- import, SQL a mano): questa e' l'ultima porta, ed e' chiusa per tutte.
  --
  -- E' l'UNICO caso in cui questo trigger fa fallire una scrittura su bookings.
  -- Il codice DR7WL lo distingue da qualunque altro errore: sotto, nel blocco
  -- EXCEPTION, viene rilanciato invece di essere trasformato in un warning.
  IF v_nuovo_saldo < 0 AND v_delta_libero > 0 THEN
    -- Nel messaggio va il credito che il cliente puo' davvero spendere QUI:
    -- saldo libero piu' i lotti vincolati validi per questo servizio. Un
    -- credito "solo Lavaggio" non e' disponibile per un noleggio, e dirlo
    -- disponibile manderebbe l'operatore a cercare un errore che non c'e'.
    v_disponibile := round(v_saldo + v_da_vincolati, 2);
    RAISE EXCEPTION 'Credito Wallet insufficiente: su questo servizio il cliente ha % EUR e ne servono %. Scegli un altro metodo di pagamento oppure ricarica il wallet.',
      to_char(v_disponibile, 'FM999999990.00'), to_char(v_delta, 'FM999999990.00')
      USING ERRCODE = 'DR7WL';
  END IF;

  UPDATE public.user_credit_balance
     SET balance = v_nuovo_saldo,
         last_updated = now()
   WHERE user_id = v_user_id;

  v_riferimento := 'DR7-' || upper(substring(NEW.id::text, 1, 8));
  IF v_delta > 0 THEN
    v_descrizione := 'Prenotazione ' || v_riferimento
                     || coalesce(' - ' || nullif(btrim(coalesce(NEW.vehicle_name, NEW.service_name, '')), ''), '')
                     || CASE WHEN v_da_vincolati > 0
                             THEN ' (di cui ' || to_char(v_da_vincolati, 'FM999999990.00') || ' EUR di credito vincolato)'
                             ELSE '' END;
  ELSE
    v_descrizione := 'Storno prenotazione ' || v_riferimento;
  END IF;

  INSERT INTO public.credit_transactions (
    user_id, transaction_type, amount, balance_after,
    description, reference_id, reference_type, service_type, created_at
  ) VALUES (
    v_user_id,
    CASE WHEN v_delta > 0 THEN 'debit' ELSE 'credit' END,
    abs(v_delta),
    v_nuovo_saldo,
    v_descrizione,
    NEW.id,
    CASE WHEN v_delta > 0 THEN 'booking_payment' ELSE 'booking_refund' END,
    NEW.service_type,
    now()
  );

  RETURN NEW;

EXCEPTION
  WHEN SQLSTATE 'DR7WL' THEN
    -- Credito insufficiente: e' una risposta, non un guasto. Deve arrivare
    -- all'operatore cosi' com'e' ed impedire il salvataggio.
    RAISE;
  WHEN SQLSTATE 'DR7WA' THEN
    -- 17/09/2026: manca il codice del cliente. Stessa logica: e' un no.
    RAISE;
  WHEN OTHERS THEN
    -- Tutto il resto: un problema sul wallet non puo' impedire di salvare una
    -- prenotazione. Si scrive nel log e si va avanti.
    RAISE WARNING '[wallet] sincronizzazione fallita per la prenotazione %: % (%)', NEW.id, SQLERRM, SQLSTATE;
    RETURN NEW;
END;
$function$;

-- Il trigger resta lo stesso (AFTER INSERT OR UPDATE ON bookings): cambia
-- solo la funzione.
