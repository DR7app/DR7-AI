-- ============================================================
-- Link Nexi in attesa -> 'superseded' quando la prenotazione risulta pagata.
--
-- 01/10/2026. La prenotazione viene segnata pagata da molti punti (callback
-- Nexi, "Segna pagato" in Prenotazioni / Non pagati / Preventivi, wallet,
-- SQL a mano). I link Pay-by-Link rimasti `pending` restavano "In attesa" per
-- sempre e il cliente poteva ancora pagarli (Nexi tiene il link aperto fino
-- al giorno dopo). Come per le cauzioni, la regola vive nel database: un solo
-- posto, qualunque sia la strada che segna pagato.
--
-- Solo i link di PRENOTAZIONE / SALDO (payment_purpose booking o
-- booking_topup, o assente). Estensioni, danni, penali e cauzioni sono debiti
-- diversi e restano come sono.
--
-- Il link sostituito resta pagabile su Nexi: se il cliente lo paga, il
-- callback (nexi-payment-callback.ts + utils/pagamentoTardivo.ts) vede lo
-- stato 'superseded', NON lo applica sulla prenotazione gia' pagata e apre
-- l'allarme "Pagamento da verificare".
--
-- nexi_transactions.status non ha CHECK constraint: 'superseded' e' ammesso.
-- ============================================================

CREATE OR REPLACE FUNCTION public.supera_link_nexi_su_pagato()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF lower(coalesce(NEW.payment_status, '')) IN ('paid', 'completed', 'succeeded')
     AND lower(coalesce(OLD.payment_status, '')) NOT IN ('paid', 'completed', 'succeeded') THEN
    UPDATE public.nexi_transactions
       SET status = 'superseded',
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
             'superseded_at', now(),
             'superseded_reason', 'prenotazione segnata pagata (' || coalesce(NEW.payment_method, 'metodo non indicato') || ')'
           ),
           updated_at = now()
     WHERE booking_id = NEW.id
       AND status = 'pending'
       AND lower(coalesce(metadata->>'payment_purpose', 'booking')) IN ('booking', 'booking_topup');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_supera_link_nexi_su_pagato ON public.bookings;
CREATE TRIGGER trg_supera_link_nexi_su_pagato
  AFTER UPDATE OF payment_status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.supera_link_nexi_su_pagato();
