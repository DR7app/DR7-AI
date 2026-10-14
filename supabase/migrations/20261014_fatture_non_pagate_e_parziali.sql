-- ============================================================================
-- Fatture emesse prima del pagamento e fatture parziali
-- ============================================================================
--
-- 14/10/2026: da "In attesa di pagamento" si puo' fatturare un cliente anche
-- se non ha pagato (es. fattura da mandare all'avvocato per penali/danni) o
-- solo una parte (fattura parziale).
--
-- 1. Nuovo tipo_fattura 'parziale': una prenotazione ne puo' avere piu' d'una,
--    quindi NON e' una principale. Si toglie dall'indice unico e dalla vista
--    dei doppioni (stessa lista di netlify/functions/utils/fatturaTipi.ts e
--    src/utils/fattureDoppie.ts).
-- 2. Trigger: quando il cliente paga, le fatture emesse prima diventano
--    'paid' da sole, qualunque sia la schermata o il callback che registra il
--    pagamento. In ordine di emissione, fino a quanto e' stato pagato.
-- ============================================================================

-- ─── 1. Indice unico della principale ──────────────────────────────────────
DROP INDEX IF EXISTS public.ux_fatture_principale_nuove;
CREATE UNIQUE INDEX ux_fatture_principale_nuove
    ON public.fatture (booking_id)
    WHERE booking_id IS NOT NULL
      AND extension_index IS NULL
      AND coalesce(lower(tipo_fattura), 'standard')
          NOT IN ('nota_di_credito', 'nota_credito', 'td04', 'penale', 'danno', 'penali', 'danni', 'estensione', 'parziale')
      AND coalesce(lower(stato), '') <> 'cancelled'
      AND created_at >= '2026-09-17 11:15:00+02'::timestamptz;

-- ─── 1b. Vista dei doppioni ────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_fatture_doppie AS
WITH principali AS (
    SELECT
        f.id,
        f.booking_id,
        f.numero_fattura,
        f.data_emissione,
        f.importo_totale,
        f.customer_name,
        f.sdi_status,
        f.aruba_invoice_id,
        f.created_at,
        coalesce(
            f.aruba_invoice_id IS NOT NULL
                OR f.sdi_status IN ('sending', 'sent', 'delivered', 'accepted'),
            false
        ) AS uscita_sdi
    FROM public.fatture f
    WHERE f.booking_id IS NOT NULL
      AND f.extension_index IS NULL
      AND coalesce(lower(f.tipo_fattura), 'standard')
          NOT IN ('nota_di_credito', 'nota_credito', 'td04', 'penale', 'danno', 'penali', 'danni', 'estensione', 'parziale')
      AND coalesce(lower(f.stato), '') <> 'cancelled'
), ordinate AS (
    SELECT
        p.*,
        row_number() OVER (PARTITION BY p.booking_id ORDER BY p.uscita_sdi DESC, p.created_at, p.id) AS posizione,
        count(*) OVER (PARTITION BY p.booking_id) AS quante
    FROM principali p
)
SELECT
    id,
    booking_id,
    numero_fattura,
    data_emissione,
    importo_totale,
    customer_name,
    sdi_status,
    uscita_sdi,
    created_at,
    quante AS fatture_sulla_prenotazione
FROM ordinate o
WHERE quante > 1 AND posizione > 1;

-- ─── 2. Fatture emesse prima del pagamento -> 'paid' al pagamento ──────────
CREATE OR REPLACE FUNCTION public.dr7_fatture_pagate_dal_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    chiave  text;
    voce    jsonb;
    fatt    jsonb;
    pagato  numeric;
    somma   numeric;
    riga    record;
BEGIN
    -- a) Penali e danni: ogni voce ricorda le fatture emesse su di lei
    --    (fattureEmesse, scritto da generate-penalty-invoice).
    IF NEW.booking_details IS DISTINCT FROM OLD.booking_details THEN
        FOREACH chiave IN ARRAY ARRAY['penalties', 'danni'] LOOP
            IF jsonb_typeof(NEW.booking_details -> chiave) IS DISTINCT FROM 'array' THEN
                CONTINUE;
            END IF;
            FOR voce IN SELECT value FROM jsonb_array_elements(NEW.booking_details -> chiave) LOOP
                IF jsonb_typeof(voce -> 'fattureEmesse') IS DISTINCT FROM 'array' THEN
                    CONTINUE;
                END IF;
                IF voce ->> 'paymentStatus' = 'paid' THEN
                    pagato := 1e12;
                ELSIF coalesce(voce ->> 'amountPaid', '') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN
                    pagato := (voce ->> 'amountPaid')::numeric;
                ELSE
                    pagato := 0;
                END IF;
                somma := 0;
                FOR fatt IN SELECT value FROM jsonb_array_elements(voce -> 'fattureEmesse') LOOP
                    IF coalesce(fatt ->> 'importo', '') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN
                        somma := somma + (fatt ->> 'importo')::numeric;
                    END IF;
                    IF somma <= pagato + 0.05
                       AND coalesce(fatt ->> 'id', '') ~ '^[0-9a-fA-F-]{36}$' THEN
                        UPDATE public.fatture
                           SET stato = 'paid'
                         WHERE id = (fatt ->> 'id')::uuid
                           AND stato = 'pending';
                    END IF;
                END LOOP;
            END LOOP;
        END LOOP;
    END IF;

    -- b) Noleggio / lavaggio: principale, estensioni e parziali della
    --    prenotazione, in ordine di emissione, fino a quanto e' pagato.
    IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
       OR NEW.amount_paid IS DISTINCT FROM OLD.amount_paid
       OR (NEW.booking_details ->> 'amountPaid') IS DISTINCT FROM (OLD.booking_details ->> 'amountPaid') THEN
        IF lower(coalesce(NEW.payment_status, '')) IN ('paid', 'completed', 'succeeded') THEN
            pagato := 1e12;
        ELSE
            pagato := greatest(
                coalesce(NEW.amount_paid, 0),
                CASE WHEN coalesce(NEW.booking_details ->> 'amountPaid', '') ~ '^[0-9]+(\.[0-9]+)?$'
                     THEN (NEW.booking_details ->> 'amountPaid')::numeric ELSE 0 END
            ) / 100.0;
        END IF;
        IF pagato > 0 THEN
            somma := 0;
            FOR riga IN
                SELECT id, importo_totale, stato
                  FROM public.fatture
                 WHERE booking_id = NEW.id
                   AND coalesce(lower(tipo_fattura), 'standard')
                       NOT IN ('nota_di_credito', 'nota_credito', 'td04', 'penale', 'danno', 'penali', 'danni')
                   AND coalesce(lower(stato), '') <> 'cancelled'
                 ORDER BY created_at, id
            LOOP
                somma := somma + coalesce(riga.importo_totale, 0);
                IF somma <= pagato + 0.05 AND riga.stato IN ('pending', 'unpaid') THEN
                    UPDATE public.fatture SET stato = 'paid' WHERE id = riga.id;
                END IF;
            END LOOP;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fatture_pagate_dal_booking ON public.bookings;
CREATE TRIGGER trg_fatture_pagate_dal_booking
    AFTER UPDATE OF booking_details, payment_status, amount_paid ON public.bookings
    FOR EACH ROW
    EXECUTE FUNCTION public.dr7_fatture_pagate_dal_booking();
