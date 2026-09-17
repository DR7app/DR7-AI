-- ============================================================================
-- Una sola fattura principale per prenotazione — anche con chiamate in parallelo
-- ============================================================================
--
-- 17/09/2026: un lavaggio pagato con link Nexi ha ricevuto DUE fatture
-- (DR7-2026-2035 e 2036, a 170 ms), entrambe trasmesse allo SDI e mandate su
-- WhatsApp. L'indice `ux_fatture_principale_per_prenotazione` della migrazione
-- 20260901_fatture_doppie non e' mai stato creato: quella migrazione lo salta
-- finche' restano vecchi doppioni gia' trasmessi (v_fatture_doppie), che si
-- chiudono solo con una nota di credito.
--
-- Questo indice vale per le fatture create da ora in poi: i doppioni storici
-- restano fuori e non ne bloccano la creazione. Due righe nuove per la stessa
-- prenotazione vengono respinte dal database con 23505, qualunque sia il codice
-- che le inserisce. generate-invoice-from-booking gestisce il 23505 e
-- restituisce la fattura gia' creata.
--
-- Stesse esclusioni di isFatturaPrincipale (netlify/functions/utils/fatturaTipi.ts).
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS ux_fatture_principale_nuove
    ON public.fatture (booking_id)
    WHERE booking_id IS NOT NULL
      AND extension_index IS NULL
      AND coalesce(lower(tipo_fattura), 'standard')
          NOT IN ('nota_di_credito', 'nota_credito', 'td04', 'penale', 'danno', 'penali', 'danni', 'estensione')
      AND coalesce(lower(stato), '') <> 'cancelled'
      AND created_at >= '2026-09-17 11:15:00+02'::timestamptz;
