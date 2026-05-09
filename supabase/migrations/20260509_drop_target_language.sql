-- Rimuove il filtro target_language dai Messaggi di Sistema Pro.
-- DR7 e' Italian-only nelle comunicazioni — il filtro non serve e
-- aggiungeva solo rumore alla form. Sicuro a rieseguire.

ALTER TABLE system_messages
    DROP COLUMN IF EXISTS target_language;
