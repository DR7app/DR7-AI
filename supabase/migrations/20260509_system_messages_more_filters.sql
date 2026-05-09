-- Aggiunge filtri avanzati ai template di Messaggi di Sistema Pro.
-- Permettono di restringere quando/per chi un template parte:
--   target_service_type  → 'rental' | 'car_wash' | 'mechanical' | 'all'
--   target_with_deposit  → 'yes' | 'no' | 'all' (solo se la booking ha cauzione)
--   target_plate         → targa esatta (opzionale, max 15 char)
--   target_payment_method → es. 'card' | 'wallet' | 'cash' | 'bonifico' | 'all'
--   target_amount_min    → importo minimo del booking in cents (NULL = nessun limite)
--   target_amount_max    → importo massimo (NULL = nessun limite)

ALTER TABLE system_messages ADD COLUMN IF NOT EXISTS target_service_type TEXT DEFAULT 'all';
ALTER TABLE system_messages ADD COLUMN IF NOT EXISTS target_with_deposit TEXT DEFAULT 'all';
ALTER TABLE system_messages ADD COLUMN IF NOT EXISTS target_plate TEXT;
ALTER TABLE system_messages ADD COLUMN IF NOT EXISTS target_payment_method TEXT DEFAULT 'all';
ALTER TABLE system_messages ADD COLUMN IF NOT EXISTS target_amount_min INTEGER;
ALTER TABLE system_messages ADD COLUMN IF NOT EXISTS target_amount_max INTEGER;

COMMENT ON COLUMN system_messages.target_service_type IS 'rental|car_wash|mechanical|all — filtra il tipo di booking';
COMMENT ON COLUMN system_messages.target_with_deposit IS 'yes|no|all — invia solo se la booking ha (o non ha) una cauzione';
COMMENT ON COLUMN system_messages.target_plate IS 'Targa esatta del veicolo (opzionale) per limitare a un veicolo specifico';
COMMENT ON COLUMN system_messages.target_payment_method IS 'card|wallet|cash|bonifico|all — filtra il metodo di pagamento del booking';
COMMENT ON COLUMN system_messages.target_amount_min IS 'Importo minimo booking in cents (NULL = nessun limite)';
COMMENT ON COLUMN system_messages.target_amount_max IS 'Importo massimo booking in cents (NULL = nessun limite)';
