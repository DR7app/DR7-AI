-- ============================================================================
-- PREVENDITE: UN ACQUISTO = UNA RIGA PAGATA (04/11/2026)
--
-- Da eseguire a mano nel SQL editor. Rilanciabile. Il sito e il gestionale
-- funzionano anche prima: la chiave d'acquisto viaggia dentro p_dati (JSONB),
-- che la versione attuale della funzione ignora.
--
-- 1. Colonna `chiave_acquisto` + indice unico (user_id, chiave_acquisto):
--    il sito manda una chiave per ogni intenzione d'acquisto (scheda aperta,
--    articolo del carrello). Lo stesso clic ripetuto, un doppio tocco o un
--    nuovo tentativo dopo un errore di rete restituiscono la riga gia' creata,
--    senza scalare il wallet una seconda volta.
--
-- 2. prevendita_acquista_con_credito (STESSA FIRMA: mai un secondo overload,
--    vedi PGRST203 di add_credits):
--     - con chiave: se esiste gia' una riga di quel cliente con quella
--       chiave, risponde ok con quella riga e non addebita niente;
--     - senza chiave (client vecchi): se lo stesso cliente ha comprato la
--       STESSA prevendita col wallet negli ultimi 2 minuti, risponde ok con
--       quella riga. Chi la ricompra piu' tardi la compra davvero.
--    Il lock FOR UPDATE sulla prevendita serializza gli acquisti: il secondo
--    aspetta il primo e poi lo vede, anche con due chiamate in parallelo.
--
-- 3. Indice unico su nexi_order_id (solo righe che lo hanno): un ordine Nexi
--    non puo' attivare due pacchetti. Se in produzione ci fossero gia' doppioni
--    l'indice NON viene creato (NOTICE con il numero): la migrazione non fallisce.
-- ============================================================================

ALTER TABLE public.prevendite_clienti ADD COLUMN IF NOT EXISTS chiave_acquisto TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_prevendite_clienti_chiave_acquisto
  ON public.prevendite_clienti (user_id, chiave_acquisto)
  WHERE chiave_acquisto IS NOT NULL;

DO $$
DECLARE
  v_doppi INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ux_prevendite_clienti_nexi_order') THEN
    RETURN;
  END IF;
  SELECT count(*) INTO v_doppi FROM (
    SELECT nexi_order_id FROM public.prevendite_clienti
     WHERE nexi_order_id IS NOT NULL
     GROUP BY nexi_order_id HAVING count(*) > 1
  ) d;
  IF v_doppi > 0 THEN
    RAISE NOTICE 'prevendite_clienti: % ordini Nexi su piu righe, indice unico NON creato. Controllare: SELECT nexi_order_id, count(*) FROM prevendite_clienti WHERE nexi_order_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1', v_doppi;
  ELSE
    CREATE UNIQUE INDEX ux_prevendite_clienti_nexi_order
      ON public.prevendite_clienti (nexi_order_id)
      WHERE nexi_order_id IS NOT NULL;
  END IF;
END $$;

-- ── Acquisto col Credit Wallet, idempotente ─────────────────────────────────
-- Identica alla versione del 22/10 (interruttore, codice, saldo libero,
-- attivazione) piu' i due controlli sui doppioni.
CREATE OR REPLACE FUNCTION public.prevendita_acquista_con_credito(
  p_prevendita_id UUID,
  p_dati          JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  p          public.prevendite%ROWTYPE;
  v_saldo    NUMERIC;
  v_nuovo    NUMERIC;
  v_pc_id    UUID;
  v_attiva   JSONB;
  v_codice   TEXT := nullif(trim(coalesce(p_dati->>'codice_sconto', '')), '');
  v_chiave   TEXT := nullif(left(trim(coalesce(p_dati->>'chiave_acquisto', '')), 100), '');
  v_sconto   JSONB;
  v_prezzo   NUMERIC;
  v_esistente UUID;
BEGIN
  IF NOT coalesce((public.prevendite_opzioni_pagamento()->>'wallet')::boolean, true) THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Il pagamento con Credit Wallet non e'' disponibile per le prevendite.');
  END IF;
  -- Chi compra e' sempre chi ha fatto l'accesso: mai un user_id dal browser.
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Accedi per acquistare una prevendita.');
  END IF;

  -- Il lock serializza gli acquisti della stessa prevendita: da qui in poi
  -- un secondo clic aspetta il primo e ne vede il risultato.
  SELECT * INTO p FROM public.prevendite WHERE id = p_prevendita_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Questa prevendita non e piu in vendita.');
  END IF;

  -- Stesso acquisto gia' fatto: si restituisce quello, senza addebitare.
  IF v_chiave IS NOT NULL THEN
    SELECT id INTO v_esistente FROM public.prevendite_clienti
     WHERE user_id = v_uid AND chiave_acquisto = v_chiave
     LIMIT 1;
  ELSE
    SELECT id INTO v_esistente FROM public.prevendite_clienti
     WHERE user_id = v_uid
       AND prevendita_id = p.id
       AND payment_method = 'credit'
       AND payment_status IN ('paid', 'completed', 'succeeded')
       AND created_at > now() - interval '2 minutes'
     ORDER BY created_at DESC
     LIMIT 1;
  END IF;
  IF v_esistente IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'prevendita_cliente_id', v_esistente, 'gia_acquistata', true);
  END IF;

  IF NOT p.attiva OR NOT p.visibile_sito THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Questa prevendita non e piu in vendita.');
  END IF;
  IF p.posti_totali IS NOT NULL AND p.posti_venduti >= p.posti_totali THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Prevendita esaurita: i posti sono finiti.');
  END IF;
  IF p.prezzo IS NULL OR p.prezzo <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Prezzo della prevendita non valido.');
  END IF;

  v_prezzo := p.prezzo;
  IF v_codice IS NOT NULL THEN
    v_sconto := public.prevendita_calcola_sconto(p.id, v_codice);
    IF NOT coalesce((v_sconto->>'ok')::boolean, false) THEN
      RETURN jsonb_build_object('ok', false, 'errore', v_sconto->>'errore');
    END IF;
    v_prezzo := (v_sconto->>'prezzo_finale')::numeric;
  END IF;

  SELECT balance INTO v_saldo FROM public.user_credit_balance WHERE user_id = v_uid FOR UPDATE;
  v_saldo := coalesce(v_saldo, 0);
  IF v_saldo < v_prezzo THEN
    RETURN jsonb_build_object('ok', false, 'errore',
      format('Credito insufficiente. Disponibile: €%s, richiesto: €%s.',
        to_char(v_saldo, 'FM999999990.00'), to_char(v_prezzo, 'FM999999990.00')));
  END IF;

  v_nuovo := round(v_saldo - v_prezzo, 2);
  UPDATE public.user_credit_balance SET balance = v_nuovo, last_updated = now() WHERE user_id = v_uid;

  -- Il pacchetto porta con se' le condizioni di OGGI (come l'acquisto a carta).
  -- prezzo_pagato e sconto li riscrive il trigger dal catalogo e dal codice.
  INSERT INTO public.prevendite_clienti (
    prevendita_id, user_id, customer_email, customer_nome, customer_telefono,
    nome, foto_url, prezzo_pagato, utilizzi_iniziali, utilizzi_usati,
    veicoli, km_inclusi, assicurazione_inclusa, max_utilizzi_mese,
    max_giorni_consecutivi, regole_extra, payment_status, payment_method, origine,
    customer_codice_fiscale, customer_indirizzo, customer_numero_civico,
    customer_citta, customer_cap, customer_provincia, codice_sconto, chiave_acquisto
  ) VALUES (
    p.id, v_uid,
    coalesce(nullif(p_dati->>'email', ''), auth.jwt()->>'email', ''),
    coalesce(p_dati->>'nome', ''),
    coalesce(p_dati->>'telefono', ''),
    p.nome, p.foto_url, v_prezzo, p.utilizzi_inclusi, 0,
    p.veicoli, p.km_inclusi, p.assicurazione_inclusa, p.max_utilizzi_mese,
    p.max_giorni_consecutivi, p.regole_extra, 'pending', 'credit', 'sito',
    nullif(p_dati->>'codice_fiscale', ''), nullif(p_dati->>'indirizzo', ''),
    nullif(p_dati->>'numero_civico', ''), nullif(p_dati->>'citta', ''),
    nullif(p_dati->>'cap', ''), nullif(p_dati->>'provincia', ''), v_codice, v_chiave
  ) RETURNING id INTO v_pc_id;

  INSERT INTO public.credit_transactions (
    user_id, transaction_type, amount, balance_after, description,
    reference_id, reference_type, service_type, created_at
  ) VALUES (
    v_uid, 'debit', v_prezzo, v_nuovo, 'Prevendita ' || p.nome,
    v_pc_id, 'prevendita', 'prevendita', now()
  );

  -- Stessa attivazione del pagamento con carta: pagato, scadenza, posti.
  v_attiva := public.prevendita_attiva_pagamento(v_pc_id, 'credit');
  IF NOT coalesce((v_attiva->>'ok')::boolean, false) THEN
    RAISE EXCEPTION 'Attivazione prevendita non riuscita: %', v_attiva->>'errore';
  END IF;

  RETURN jsonb_build_object('ok', true, 'prevendita_cliente_id', v_pc_id, 'nuovo_saldo', v_nuovo);
END;
$$;

REVOKE ALL ON FUNCTION public.prevendita_acquista_con_credito(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prevendita_acquista_con_credito(UUID, JSONB) TO authenticated;

-- Verifica: deve esserci UNA sola funzione con questo nome, e i due indici.
SELECT
  (SELECT count(*) FROM pg_proc WHERE proname = 'prevendita_acquista_con_credito') AS funzioni,
  (SELECT count(*) FROM pg_indexes WHERE indexname = 'ux_prevendite_clienti_chiave_acquisto') AS indice_chiave,
  (SELECT count(*) FROM pg_indexes WHERE indexname = 'ux_prevendite_clienti_nexi_order') AS indice_nexi;
