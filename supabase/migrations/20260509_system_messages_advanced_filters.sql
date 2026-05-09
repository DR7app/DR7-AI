-- Filtri avanzati Messaggi di Sistema Pro — sprint autonomia 1.
-- Permette all'admin di restringere il pubblico di un template senza
-- chiamare lo sviluppatore. Tutte le colonne sono opzionali, default NULL
-- = "nessuna restrizione" (compat 100% con i template gia' creati).

-- 1) Tier membership: tutte | Free | Member | Elite | Gold | Platinum
ALTER TABLE system_messages
    ADD COLUMN IF NOT EXISTS target_membership_tier TEXT;

COMMENT ON COLUMN system_messages.target_membership_tier IS
    'Filtro per tier DR7 Club: NULL/all = nessuna restrizione. Valori: free|member|elite|gold|platinum.';

-- 2) Lingua del cliente: tutte | IT | EN | FR | DE
ALTER TABLE system_messages
    ADD COLUMN IF NOT EXISTS target_language TEXT;

COMMENT ON COLUMN system_messages.target_language IS
    'Filtro per lingua del cliente: NULL/all = nessuna restrizione. ISO short: it|en|fr|de.';

-- 3) Numero minimo di prenotazioni passate (per messaggio di lealta')
ALTER TABLE system_messages
    ADD COLUMN IF NOT EXISTS target_min_prev_bookings INTEGER;

COMMENT ON COLUMN system_messages.target_min_prev_bookings IS
    'Filtro: parte solo se il cliente ha almeno N prenotazioni precedenti (escluso quella corrente). NULL = nessuna restrizione.';

-- 4) Durata noleggio in giorni (range)
ALTER TABLE system_messages
    ADD COLUMN IF NOT EXISTS target_rental_duration_min INTEGER;
ALTER TABLE system_messages
    ADD COLUMN IF NOT EXISTS target_rental_duration_max INTEGER;

COMMENT ON COLUMN system_messages.target_rental_duration_min IS
    'Filtro: parte solo se la durata del noleggio in giorni e'' >= questo valore. NULL = nessun min.';
COMMENT ON COLUMN system_messages.target_rental_duration_max IS
    'Filtro: parte solo se la durata del noleggio in giorni e'' <= questo valore. NULL = nessun max.';

-- 5) Tag cliente custom (CSV) — match se ALMENO uno dei tag e' presente.
ALTER TABLE system_messages
    ADD COLUMN IF NOT EXISTS target_customer_tags TEXT;

COMMENT ON COLUMN system_messages.target_customer_tags IS
    'Filtro: CSV di tag cliente (es. "vip,turista,sardo"). Match se almeno UNO presente in customers_extended.tags. NULL = nessuna restrizione.';
