-- ============================================================================
-- PREVENDITE: CREDIT WALLET E CARRELLO (26/09/2026)
--
-- DA RIVEDERE PRIMA DI APPLICARE. Il sito funziona anche senza: finche' questa
-- migrazione non c'e', la prevendita si paga solo con carta e non compare il
-- pulsante "Aggiungi al carrello" (il sito lo verifica con
-- prevendite_wallet_carrello_attivo()).
--
-- 1. prevendita_acquista_con_credito: il cliente compra una prevendita col
--    Credit Wallet. Tutto in una transazione: si blocca la prevendita (posti),
--    si scala il saldo, si crea il pacchetto e lo si attiva con la stessa
--    prevendita_attiva_pagamento del pagamento con carta. Il PREZZO lo legge
--    il database dal catalogo, mai dal browser.
--
--    Solo SALDO LIBERO, niente credito vincolato: un lotto vincolato ha una
--    scadenza decisa dalla direzione, mentre una prevendita si usa fino a 12
--    mesi dopo — comprarla col vincolato aggirerebbe la scadenza. In piu'
--    book_with_credits attacca alla prossima prenotazione i movimenti dei
--    lotti senza booking_id: un movimento "di prevendita" finirebbe sulla
--    prenotazione sbagliata.
--
--    Niente fattura: la ricarica del wallet e' gia' stata fatturata (regola
--    DR7, come per le prenotazioni pagate a credito).
--
-- 2. carrello_articoli accetta il tipo 'prevendita'.
-- ============================================================================

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
BEGIN
  -- Chi compra e' sempre chi ha fatto l'accesso: mai un user_id dal browser.
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Accedi per acquistare una prevendita.');
  END IF;

  SELECT * INTO p FROM public.prevendite WHERE id = p_prevendita_id FOR UPDATE;
  IF NOT FOUND OR NOT p.attiva OR NOT p.visibile_sito THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Questa prevendita non e piu in vendita.');
  END IF;
  IF p.posti_totali IS NOT NULL AND p.posti_venduti >= p.posti_totali THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Prevendita esaurita: i posti sono finiti.');
  END IF;
  IF p.prezzo IS NULL OR p.prezzo <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'errore', 'Prezzo della prevendita non valido.');
  END IF;

  SELECT balance INTO v_saldo FROM public.user_credit_balance WHERE user_id = v_uid FOR UPDATE;
  v_saldo := coalesce(v_saldo, 0);
  IF v_saldo < p.prezzo THEN
    RETURN jsonb_build_object('ok', false, 'errore',
      format('Credito insufficiente. Disponibile: €%s, richiesto: €%s.',
        to_char(v_saldo, 'FM999999990.00'), to_char(p.prezzo, 'FM999999990.00')));
  END IF;

  v_nuovo := round(v_saldo - p.prezzo, 2);
  UPDATE public.user_credit_balance SET balance = v_nuovo, last_updated = now() WHERE user_id = v_uid;

  -- Il pacchetto porta con se' le condizioni di OGGI (come l'acquisto a carta).
  INSERT INTO public.prevendite_clienti (
    prevendita_id, user_id, customer_email, customer_nome, customer_telefono,
    nome, foto_url, prezzo_pagato, utilizzi_iniziali, utilizzi_usati,
    veicoli, km_inclusi, assicurazione_inclusa, max_utilizzi_mese,
    max_giorni_consecutivi, regole_extra, payment_status, payment_method, origine,
    customer_codice_fiscale, customer_indirizzo, customer_numero_civico,
    customer_citta, customer_cap, customer_provincia
  ) VALUES (
    p.id, v_uid,
    coalesce(nullif(p_dati->>'email', ''), auth.jwt()->>'email', ''),
    coalesce(p_dati->>'nome', ''),
    coalesce(p_dati->>'telefono', ''),
    p.nome, p.foto_url, p.prezzo, p.utilizzi_inclusi, 0,
    p.veicoli, p.km_inclusi, p.assicurazione_inclusa, p.max_utilizzi_mese,
    p.max_giorni_consecutivi, p.regole_extra, 'pending', 'credit', 'sito',
    nullif(p_dati->>'codice_fiscale', ''), nullif(p_dati->>'indirizzo', ''),
    nullif(p_dati->>'numero_civico', ''), nullif(p_dati->>'citta', ''),
    nullif(p_dati->>'cap', ''), nullif(p_dati->>'provincia', '')
  ) RETURNING id INTO v_pc_id;

  INSERT INTO public.credit_transactions (
    user_id, transaction_type, amount, balance_after, description,
    reference_id, reference_type, service_type, created_at
  ) VALUES (
    v_uid, 'debit', p.prezzo, v_nuovo, 'Prevendita ' || p.nome,
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

-- Il sito chiede se questa migrazione c'e' prima di mostrare wallet e carrello
-- per le prevendite: senza, resta tutto come prima (solo carta).
CREATE OR REPLACE FUNCTION public.prevendite_wallet_carrello_attivo()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$ SELECT true $$;
GRANT EXECUTE ON FUNCTION public.prevendite_wallet_carrello_attivo() TO anon, authenticated;

-- Carrello: nuovo tipo 'prevendita'.
ALTER TABLE public.carrello_articoli DROP CONSTRAINT IF EXISTS carrello_articoli_tipo_check;
ALTER TABLE public.carrello_articoli ADD CONSTRAINT carrello_articoli_tipo_check
  CHECK (tipo = ANY (ARRAY['noleggio','lavaggio','meccanica','tour','club','membership','wallet','prevendita']));
