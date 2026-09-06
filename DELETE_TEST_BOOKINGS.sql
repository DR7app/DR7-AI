-- =====================================================================
-- Cancellazione delle PRENOTAZIONI sui VEICOLI TEST
--
-- Criterio: lo stesso del gestionale (src/utils/isTestBooking.ts)
--   vehicle_name = 'test'  oppure  vehicle_plate LIKE 'TEST%'
-- letti sia in colonna sia dentro booking_details. Copre TEST000,
-- TEST001, TEST002 e qualunque altra targa che inizi per TEST.
--
-- I VEICOLI restano nella flotta: qui si cancellano le prenotazioni.
--
-- Per una prova a vuoto: cambia COMMIT in ROLLBACK in fondo. Non
-- cancella niente e ti mostra i conteggi veri.
-- =====================================================================

BEGIN;

DROP TABLE IF EXISTS da_cancellare;

CREATE TEMP TABLE da_cancellare AS
SELECT b.id
FROM bookings b
-- Michel Ndary Adopo, BMW X5 su targa TEST002: prenotazione VERA finita
-- sulla targa di prova. Si tiene (deciso 01/09/2026).
WHERE b.id <> '955cfbb1-358b-4733-bd40-20d60b1cf3e5'
  -- Le parentesi non sono decorative: AND lega piu' stretto di OR, e
  -- senza, l'esclusione varrebbe solo per l'ultima riga dell'elenco.
  AND (
       lower(btrim(coalesce(b.vehicle_name, ''))) = 'test'
    OR upper(btrim(coalesce(b.vehicle_plate, ''))) LIKE 'TEST%'
    OR lower(btrim(coalesce(b.booking_details->'vehicle'->>'name', ''))) = 'test'
    OR lower(btrim(coalesce(b.booking_details->'vehicle'->>'display_name', ''))) = 'test'
    OR upper(btrim(coalesce(b.booking_details->>'vehicle_plate', ''))) LIKE 'TEST%'
    OR upper(btrim(coalesce(b.booking_details->'vehicle'->>'plate', ''))) LIKE 'TEST%'
  );

SELECT count(*) AS prenotazioni_da_cancellare FROM da_cancellare;

-- Tutto cio' che punta a quelle prenotazioni, in QUALSIASI tabella abbia
-- una colonna booking_id. Scoperto dal catalogo invece che elencato a
-- mano: cosi' non si dimentica una tabella e non se ne nomina una che
-- non esiste (nexi_transactions, contracts, fatture, preventivi,
-- alarm_events, limitation_overrides, report_overrides, ...).
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.column_name = 'booking_id'
      AND c.table_schema = 'public'
      AND tb.table_type = 'BASE TABLE'
  LOOP
    -- `booking_id` non ha lo stesso tipo dappertutto: in bookings.id e' uuid,
    -- ma tabelle come multe_pec_log lo tengono in text, e Postgres si rifiuta
    -- di confrontarli ("operator does not exist: text = uuid"). Il confronto
    -- si fa su testo da entrambe le parti, cosi' vale in tutti e due i casi.
    EXECUTE format(
      'DELETE FROM public.%I WHERE booking_id::text IN (SELECT id::text FROM da_cancellare)',
      t.table_name
    );
  END LOOP;
END $$;

-- Le cauzioni non stanno qui: ci pensa il trigger
-- trg_delete_cauzione_on_booking_delete (vedi CLAUDE.md).
DELETE FROM bookings WHERE id IN (SELECT id FROM da_cancellare);

-- Deve tornare 0.
SELECT count(*) AS rimaste FROM bookings WHERE id IN (SELECT id FROM da_cancellare);

COMMIT;
