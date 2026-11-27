-- 27/11/2026 (video di Valerio, confermato dalla direzione): la cauzione gia'
-- versata vale anche per i noleggi successivi. Esempio: Runchina ha 2000 EUR
-- versati per un'auto; noleggia la Lamborghini che ne chiede 5000: integra
-- solo 3000. Dal sito, area cliente > Le mie cauzioni.
--
-- Due colonne:
--  - prenotazioni_coperte: le prenotazioni (oltre a quella di origine) che
--    questa cauzione copre. Finche' una di queste non e' riconsegnata, la
--    cauzione non si restituisce.
--  - integra_cauzioni: su una cauzione di INTEGRAZIONE (i 3000), le cauzioni
--    gia' versate su cui si appoggia (i 2000).
--
-- La restituzione segue la regola di sempre: la data di riconsegna
-- (data_restituzione_veicolo) + 14 giorni lavorativi, calcolata dal trigger
-- auto_calculate_scadenza_cauzione. Riusare una cauzione = spostare la sua
-- data di riconsegna a quella dell'ultima prenotazione coperta; la scadenza
-- si ricalcola da sola (salvo scadenza forzata a mano, che vince sempre).
--
-- Il collegamento avviene SOLO quando l'integrazione risulta versata: un link
-- di integrazione aperto e mai pagato non allunga niente.

BEGIN;

ALTER TABLE public.cauzioni
  ADD COLUMN IF NOT EXISTS prenotazioni_coperte UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS integra_cauzioni     UUID[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.cauzioni.prenotazioni_coperte IS
  'Prenotazioni successive coperte da questa cauzione (riuso, 27/11/2026). Non si restituisce prima della loro riconsegna.';
COMMENT ON COLUMN public.cauzioni.integra_cauzioni IS
  'Cauzione di integrazione: id delle cauzioni gia versate su cui si appoggia.';

-- ── La cauzione e' versata e ancora presso DR7? ─────────────────────────────
-- Stessa lettura del tab Cauzioni:
--  - pre-autorizzata: metodo preautorizzazione + nexi_transaction_id;
--  - incassata (data_incasso) ma non ancora resa;
--  - 'Incassata' = presa, la rendo;
--  - 'Bloccata' SENZA data_incasso = trattenuta per un noleggio successivo.
-- Restituita / Sbloccata / Danno / Bloccata con data_incasso = non disponibile.
CREATE OR REPLACE FUNCTION public.dr7_cauzione_versata(
  p_stato TEXT, p_metodo TEXT, p_nexi_tx TEXT, p_data_incasso TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_stato IN ('Restituita', 'Sbloccata', 'Danno') THEN FALSE
    WHEN p_stato = 'Bloccata' THEN p_data_incasso IS NULL
    WHEN p_stato = 'Incassata' THEN TRUE
    WHEN p_metodo = 'preautorizzazione' AND p_nexi_tx IS NOT NULL THEN TRUE
    ELSE p_data_incasso IS NOT NULL
  END;
$$;

-- ── Collega una prenotazione a una cauzione gia' versata ────────────────────
CREATE OR REPLACE FUNCTION public.dr7_cauzione_copri_prenotazione(p_cauzione_id UUID, p_booking_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_riconsegna DATE;
BEGIN
  IF p_cauzione_id IS NULL OR p_booking_id IS NULL THEN RETURN; END IF;

  SELECT (b.dropoff_date AT TIME ZONE 'Europe/Rome')::date
    INTO v_riconsegna
    FROM public.bookings b WHERE b.id = p_booking_id;

  UPDATE public.cauzioni c
     SET prenotazioni_coperte = CASE
           WHEN p_booking_id = ANY (c.prenotazioni_coperte) OR p_booking_id = c.riferimento_contratto_id
             THEN c.prenotazioni_coperte
           ELSE array_append(c.prenotazioni_coperte, p_booking_id) END,
         data_restituzione_veicolo = CASE
           WHEN v_riconsegna IS NOT NULL
            AND (c.data_restituzione_veicolo IS NULL OR v_riconsegna > c.data_restituzione_veicolo)
             THEN v_riconsegna
           ELSE c.data_restituzione_veicolo END
   WHERE c.id = p_cauzione_id
     AND public.dr7_cauzione_versata(c.stato, c.metodo, c.nexi_transaction_id, c.data_incasso);
END;
$$;

REVOKE ALL ON FUNCTION public.dr7_cauzione_copri_prenotazione(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dr7_cauzione_copri_prenotazione(UUID, UUID) TO service_role;

-- ── Integrazione versata => le cauzioni su cui si appoggia restano ──────────
CREATE OR REPLACE FUNCTION public.dr7_cauzione_integrazione_versata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF cardinality(NEW.integra_cauzioni) = 0 OR NEW.riferimento_contratto_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT public.dr7_cauzione_versata(NEW.stato, NEW.metodo, NEW.nexi_transaction_id, NEW.data_incasso) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND public.dr7_cauzione_versata(OLD.stato, OLD.metodo, OLD.nexi_transaction_id, OLD.data_incasso)
     AND OLD.integra_cauzioni = NEW.integra_cauzioni THEN
    RETURN NEW; -- gia' versata prima: niente di nuovo
  END IF;
  FOREACH v_id IN ARRAY NEW.integra_cauzioni LOOP
    IF v_id <> NEW.id THEN
      PERFORM public.dr7_cauzione_copri_prenotazione(v_id, NEW.riferimento_contratto_id);
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cauzione_integrazione_versata ON public.cauzioni;
CREATE TRIGGER trg_cauzione_integrazione_versata
  AFTER INSERT OR UPDATE ON public.cauzioni
  FOR EACH ROW EXECUTE FUNCTION public.dr7_cauzione_integrazione_versata();

COMMIT;
