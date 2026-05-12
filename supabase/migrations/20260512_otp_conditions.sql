-- OTP regole condizionali — l'admin puo' definire condizioni che restringono
-- quando un OTP scatta. Niente piu' "OTP sempre/mai" — adesso si puo' dire
-- "OTP solo se importo > 5000 E categoria = Hypercar E residenza ≠ resident".
--
-- Schema conditions: array di oggetti { field, op, value }.
-- Tutte le condizioni in AND (devono matchare TUTTE perche' l'OTP scatti).
-- Se conditions e' vuoto/null, comportamento legacy: is_required decide.
--
-- field   = nome del campo nel context object passato al runtime
--           (es. "amount", "vehicle_category", "customer_tier")
-- op      = uno di: 'eq', 'neq', 'gt', 'lt', 'gte', 'lte',
--                   'in', 'not_in', 'contains', 'starts_with', 'is_empty', 'is_not_empty'
-- value   = stringa (l'evaluator coerca numero/bool/CSV in base a op)
--
-- Esempio:
--   conditions = '[
--     { "field": "amount",            "op": "gt",  "value": "5000" },
--     { "field": "vehicle_category",  "op": "eq",  "value": "hypercar" },
--     { "field": "is_resident",       "op": "eq",  "value": "false" }
--   ]'

ALTER TABLE system_otp_overrides
    ADD COLUMN IF NOT EXISTS conditions JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN system_otp_overrides.conditions IS
    'Array di condizioni AND. Schema: [{field, op, value}]. Se vuoto, l''OTP usa solo is_required (binario). Se popolato, scatta solo se TUTTE le condizioni matchano il context runtime.';

-- Verifica che il JSON sia un array (constraint soft)
ALTER TABLE system_otp_overrides
    DROP CONSTRAINT IF EXISTS system_otp_overrides_conditions_is_array;
ALTER TABLE system_otp_overrides
    ADD CONSTRAINT system_otp_overrides_conditions_is_array
    CHECK (jsonb_typeof(conditions) = 'array');
