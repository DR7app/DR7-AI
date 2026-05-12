-- Catalogo dei metodi di pagamento accettati (configurabile dall'admin).
-- TABELLA DISTINTA da `payment_methods` (che memorizza i metodi salvati
-- per cliente con user_id NOT NULL). Questa serve come catalogo letto da:
--   - Messaggi di Sistema Pro (dropdown filtro pagamento)
--   - Backend matching rules (triggerSystemMessageEvent.ts cache)
--
-- Vedi history: tentativo precedente con nome "payment_methods" e' fallito
-- per collisione con la tabella user-specific gia' esistente.

CREATE TABLE IF NOT EXISTS payment_method_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    aliases TEXT NOT NULL DEFAULT '',
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE payment_method_options IS
    'Catalogo dei metodi di pagamento accettati. Letto da filtri Messaggi Pro e matching backend. Distinto da payment_methods che memorizza i metodi salvati per cliente.';

INSERT INTO payment_method_options (key, label, aliases, sort_order) VALUES
    ('card',     'Carta di credito', 'card,carta,nexi,stripe,bancomat,pos,debit', 10),
    ('wallet',   'Credit Wallet',    'credit,wallet,credit_wallet',               20),
    ('cash',     'Contanti',         'cash,contanti',                             30),
    ('bonifico', 'Bonifico',         'bonifico,wire,bank',                        40)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION payment_method_options_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payment_method_options_updated_at ON payment_method_options;
CREATE TRIGGER payment_method_options_updated_at
    BEFORE UPDATE ON payment_method_options
    FOR EACH ROW EXECUTE FUNCTION payment_method_options_set_updated_at();

ALTER TABLE payment_method_options ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pmo_read_all" ON payment_method_options;
CREATE POLICY "pmo_read_all" ON payment_method_options
    FOR SELECT USING (true);
DROP POLICY IF EXISTS "pmo_admin_all" ON payment_method_options;
CREATE POLICY "pmo_admin_all" ON payment_method_options
    FOR ALL USING (true) WITH CHECK (true);
