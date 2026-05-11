-- Variabili custom per i template di Messaggi di Sistema Pro.
-- L'admin definisce reusable string (es. "indirizzo principale",
-- "promo ferragosto", "telefono assistenza") una sola volta. Quei valori
-- vengono sostituiti automaticamente nei template come {key} ovunque siano
-- usati. Una modifica al valore aggiorna tutti i template senza dover
-- editare i singoli body.
--
-- Esempio:
--   key   = 'address_main'
--   value = 'DR7 Cagliari, Via Sonnino 1, 09125'
-- Un template che contiene "Ti aspettiamo a {address_main}" verra'
-- renderizzato come "Ti aspettiamo a DR7 Cagliari, Via Sonnino 1, 09125".

CREATE TABLE IF NOT EXISTS system_message_variables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL DEFAULT '',
    description TEXT,
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE system_message_variables IS
    'Variabili custom riutilizzabili nei template di Messaggi di Sistema Pro. Sostituite come {key} via send-whatsapp-notification.';
COMMENT ON COLUMN system_message_variables.key IS
    'Chiave del placeholder (senza graffe). Es. "address_main", "promo_ferragosto".';
COMMENT ON COLUMN system_message_variables.value IS
    'Valore letterale che sostituisce il placeholder nei template.';
COMMENT ON COLUMN system_message_variables.description IS
    'Nota per l''admin (es. "Da aggiornare ogni stagione").';
COMMENT ON COLUMN system_message_variables.is_enabled IS
    'Se false, il placeholder non viene sostituito (lascia il testo {key} grezzo).';

-- Index per match veloce su key
CREATE UNIQUE INDEX IF NOT EXISTS system_message_variables_key_idx
    ON system_message_variables (key)
    WHERE is_enabled = true;

-- Trigger updated_at
CREATE OR REPLACE FUNCTION system_message_variables_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS system_message_variables_updated_at ON system_message_variables;
CREATE TRIGGER system_message_variables_updated_at
    BEFORE UPDATE ON system_message_variables
    FOR EACH ROW
    EXECUTE FUNCTION system_message_variables_set_updated_at();

-- RLS abilitato (admin-only via service role)
ALTER TABLE system_message_variables ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON system_message_variables;
CREATE POLICY "service_role_all" ON system_message_variables
    FOR ALL USING (true) WITH CHECK (true);
