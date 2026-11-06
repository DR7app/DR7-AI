-- =====================================================================
-- 07/11/2026 (direzione): invii massivi WhatsApp in coda, a frequenza
-- automatica.
--
-- Problema: "Invia" nella Campagna Marketing mandava a tutti di fila e il bot
-- WhatsApp (Green API) veniva bloccato.
--
-- Regola: al massimo 50 messaggi in un'ora (somma di TUTTE le campagne), solo
-- dalle 9 alle 21 ora di Roma; quello che resta riparte il giorno dopo alle 9.
-- La coda e' la tabella che esiste gia' (marketing_campaign_recipients):
--   pending  -> in coda
--   sending  -> preso da un invio in corso (nuovo)
--   sent / failed / skipped -> come prima
--
-- La presa di un destinatario avviene SOLO qui dentro, sotto un lock
-- (pg_advisory_xact_lock + FOR UPDATE SKIP LOCKED): due giri del cron o una
-- scheda del browser aperta non possono prendere lo stesso cliente ne'
-- sforare il tetto dell'ora contando in parallelo.
--
-- Idempotente: si puo' rilanciare.
-- =====================================================================

ALTER TABLE public.marketing_campaign_recipients
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempts   integer NOT NULL DEFAULT 0;

-- Eventuale vincolo vecchio sullo stato: si sostituisce con uno che conosce
-- anche 'sending'. NOT VALID: le righe gia' presenti non vengono ricontrollate.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.marketing_campaign_recipients'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.marketing_campaign_recipients DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.marketing_campaign_recipients
  ADD CONSTRAINT marketing_campaign_recipients_status_check
  CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')) NOT VALID;

-- Prossimo in coda di una campagna.
CREATE INDEX IF NOT EXISTS marketing_campaign_recipients_coda_idx
  ON public.marketing_campaign_recipients (campaign_id, created_at, id)
  WHERE status = 'pending';

-- Conteggio del tetto orario (prese recenti, di tutte le campagne).
CREATE INDEX IF NOT EXISTS marketing_campaign_recipients_claimed_idx
  ON public.marketing_campaign_recipients (claimed_at)
  WHERE claimed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS marketing_campaign_recipients_sent_at_idx
  ON public.marketing_campaign_recipients (sent_at)
  WHERE sent_at IS NOT NULL;

-- ---------------------------------------------------------------------
-- campagne_prenota_destinatario: prende (al massimo) UN destinatario da
-- inviare per la campagna, se la fascia oraria e il tetto lo permettono.
--
-- Risposta jsonb:
--   { esito: 'preso', usati, destinatario: {id, customer_id, customer_name, phone, email} }
--   { esito: 'fuori_fascia' }       -> prima delle 9 o dopo le 21 (Roma)
--   { esito: 'limite', usati }      -> tetto dell'ora raggiunto
--   { esito: 'vuoto', usati, in_corso } -> niente in coda per la campagna
--
-- Una presa 'sending' piu' vecchia di p_presa_scade_minuti e' un invio
-- interrotto a meta' (funzione uccisa dopo la chiamata a Green API): NON si
-- rimette in coda da sola, perche' il messaggio potrebbe essere gia' partito
-- (niente doppioni). Diventa 'failed' con il motivo; l'admin puo' rimetterla
-- in coda a mano.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.campagne_prenota_destinatario(
  p_campaign_id        uuid,
  p_limite_ora         integer DEFAULT 50,
  p_ora_da             integer DEFAULT 9,
  p_ora_a              integer DEFAULT 21,
  p_finestra_minuti    integer DEFAULT 60,
  p_presa_scade_minuti integer DEFAULT 15
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ora_roma integer;
  v_da       timestamptz := now() - make_interval(mins => p_finestra_minuti);
  v_usati    integer;
  v_in_corso integer;
  v_riga     record;
BEGIN
  -- Un solo "prenotatore" alla volta: il conteggio del tetto e la presa
  -- devono essere atomici rispetto agli altri giri.
  PERFORM pg_advisory_xact_lock(hashtext('campagne_marketing_coda_invii'));

  UPDATE marketing_campaign_recipients
     SET status = 'failed',
         error_message = 'Esito incerto: invio interrotto a meta''. Non rimandato in automatico per evitare doppioni.'
   WHERE status = 'sending'
     AND claimed_at < now() - make_interval(mins => p_presa_scade_minuti);

  v_ora_roma := extract(hour FROM (now() AT TIME ZONE 'Europe/Rome'))::int;
  IF v_ora_roma < p_ora_da OR v_ora_roma >= p_ora_a THEN
    RETURN jsonb_build_object('esito', 'fuori_fascia');
  END IF;

  -- Tetto orario su tutte le campagne. Le righe inviate prima di questa
  -- migrazione non hanno claimed_at: contano con sent_at.
  SELECT count(*) INTO v_usati
    FROM marketing_campaign_recipients
   WHERE status IN ('sending', 'sent', 'failed')
     AND (claimed_at >= v_da OR (claimed_at IS NULL AND sent_at >= v_da));

  IF v_usati >= p_limite_ora THEN
    RETURN jsonb_build_object('esito', 'limite', 'usati', v_usati);
  END IF;

  SELECT id, customer_id, customer_name, phone, email
    INTO v_riga
    FROM marketing_campaign_recipients
   WHERE campaign_id = p_campaign_id
     AND status = 'pending'
   ORDER BY created_at, id
   LIMIT 1
   FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    SELECT count(*) INTO v_in_corso
      FROM marketing_campaign_recipients
     WHERE campaign_id = p_campaign_id AND status = 'sending';
    RETURN jsonb_build_object('esito', 'vuoto', 'usati', v_usati, 'in_corso', v_in_corso);
  END IF;

  UPDATE marketing_campaign_recipients
     SET status = 'sending',
         claimed_at = now(),
         attempts = attempts + 1,
         error_message = NULL
   WHERE id = v_riga.id;

  RETURN jsonb_build_object(
    'esito', 'preso',
    'usati', v_usati + 1,
    'destinatario', jsonb_build_object(
      'id', v_riga.id,
      'customer_id', v_riga.customer_id,
      'customer_name', v_riga.customer_name,
      'phone', v_riga.phone,
      'email', v_riga.email
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.campagne_prenota_destinatario(uuid, integer, integer, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.campagne_prenota_destinatario(uuid, integer, integer, integer, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.campagne_prenota_destinatario(uuid, integer, integer, integer, integer, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
