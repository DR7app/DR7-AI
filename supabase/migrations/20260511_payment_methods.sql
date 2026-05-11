-- Metodi di pagamento configurabili dall'admin.
--
-- L'admin definisce i metodi accettati una sola volta + i loro alias
-- (es. metodo "Carta" alias "card,nexi,stripe,bancomat,pos"). Il filtro
-- target_payment_method nei Messaggi di Sistema Pro legge da qui, sia
-- per la dropdown che per il matching dei valori reali sui booking.
--
-- Esempio uso reale:
--   admin aggiunge "Satispay" con aliases "satispay,satis"
--   → la dropdown nel form Messaggi Pro mostra "Satispay"
--   → un booking con payment_method="satis" matcha il filtro Satispay
--   → niente piu' lump-in-card per metodi nuovi

CREATE TABLE IF NOT EXISTS payment_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT NOT NULL UNIQUE,         -- es. 'card', 'wallet', 'satispay'
    label TEXT NOT NULL,              -- es. 'Carta di credito', 'Satispay'
    aliases TEXT NOT NULL DEFAULT '', -- CSV: 'card,nexi,stripe,bancomat,pos,debit'
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE payment_methods IS
    'Metodi di pagamento accettati dal sistema. Letti dai filtri Messaggi Pro e dalle matching rules backend.';
COMMENT ON COLUMN payment_methods.key IS
    'Chiave canonica del metodo (es. card, wallet, satispay). Usata come value nei filtri.';
COMMENT ON COLUMN payment_methods.aliases IS
    'CSV di stringhe sostitutive (case-insensitive substring match) per fare match contro booking.payment_method.';
COMMENT ON COLUMN payment_methods.is_enabled IS
    'Se false, il metodo non appare nelle dropdown ne'' nelle matching rules.';
COMMENT ON COLUMN payment_methods.sort_order IS
    'Ordine di visualizzazione (asc). 100 = default.';

-- Seed delle 4 modalita' canoniche con i loro alias storici hardcoded.
INSERT INTO payment_methods (key, label, aliases, sort_order) VALUES
    ('card',     'Carta di credito', 'card,carta,nexi,stripe,bancomat,pos,debit', 10),
    ('wallet',   'Credit Wallet',    'credit,wallet,credit_wallet',               20),
    ('cash',     'Contanti',         'cash,contanti',                             30),
    ('bonifico', 'Bonifico',         'bonifico,wire,bank',                        40)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION payment_methods_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payment_methods_updated_at ON payment_methods;
CREATE TRIGGER payment_methods_updated_at
    BEFORE UPDATE ON payment_methods
    FOR EACH ROW
    EXECUTE FUNCTION payment_methods_set_updated_at();

ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payment_methods_read_all" ON payment_methods;
CREATE POLICY "payment_methods_read_all" ON payment_methods
    FOR SELECT USING (true);
DROP POLICY IF EXISTS "payment_methods_admin_all" ON payment_methods;
CREATE POLICY "payment_methods_admin_all" ON payment_methods
    FOR ALL USING (true) WITH CHECK (true);
