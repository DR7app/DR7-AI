-- Sprint autonomia 2 — TUTTI i filtri pubblico restanti per Messaggi
-- di Sistema Pro. Default NULL = nessuna restrizione, retro-compat 100%.

-- Residenza: resident (Italia) vs non_resident (turisti/esteri)
ALTER TABLE system_messages
    ADD COLUMN IF NOT EXISTS target_residency TEXT;
COMMENT ON COLUMN system_messages.target_residency IS
    'NULL/all = tutti. resident = nazione IT/Italia/Italy. non_resident = turisti / esteri.';

-- Max prenotazioni precedenti (per "prime N" promo)
ALTER TABLE system_messages
    ADD COLUMN IF NOT EXISTS target_max_prev_bookings INTEGER;
COMMENT ON COLUMN system_messages.target_max_prev_bookings IS
    'Filtro: parte solo se cliente ha al MASSIMO N prenotazioni precedenti. Es. 0 = primo cliente, 2 = primi 3 noleggi.';

-- Eta' cliente (range)
ALTER TABLE system_messages
    ADD COLUMN IF NOT EXISTS target_age_min INTEGER;
ALTER TABLE system_messages
    ADD COLUMN IF NOT EXISTS target_age_max INTEGER;
COMMENT ON COLUMN system_messages.target_age_min IS 'Eta'' minima cliente (anni). NULL = nessun min.';
COMMENT ON COLUMN system_messages.target_age_max IS 'Eta'' massima cliente (anni). NULL = nessun max.';

-- Veicolo: carburante (benzina|diesel|elettrico|ibrido)
ALTER TABLE system_messages
    ADD COLUMN IF NOT EXISTS target_vehicle_fuel TEXT;
COMMENT ON COLUMN system_messages.target_vehicle_fuel IS
    'NULL/all = tutti. petrol|diesel|electric|hybrid (case-insensitive su vehicle.fuel/carburante).';

-- Veicolo: trasmissione (manual|automatic)
ALTER TABLE system_messages
    ADD COLUMN IF NOT EXISTS target_vehicle_transmission TEXT;
COMMENT ON COLUMN system_messages.target_vehicle_transmission IS
    'NULL/all = tutti. manual|automatic.';

-- Fascia oraria pickup (Roma)
ALTER TABLE system_messages
    ADD COLUMN IF NOT EXISTS target_pickup_hour_min INTEGER;
ALTER TABLE system_messages
    ADD COLUMN IF NOT EXISTS target_pickup_hour_max INTEGER;
COMMENT ON COLUMN system_messages.target_pickup_hour_min IS 'Ora min pickup (0-23, Europe/Rome). NULL = no min.';
COMMENT ON COLUMN system_messages.target_pickup_hour_max IS 'Ora max pickup (0-23, Europe/Rome). NULL = no max.';

-- Source channel del cliente (google|instagram|walk-in|referral|...)
ALTER TABLE system_messages
    ADD COLUMN IF NOT EXISTS target_source_channel TEXT;
COMMENT ON COLUMN system_messages.target_source_channel IS
    'NULL/all = tutti. Match case-insensitive su customer.source / source_channel / channel.';

-- Provincia residenza (CSV per OR — es. "CA,SS")
ALTER TABLE system_messages
    ADD COLUMN IF NOT EXISTS target_province TEXT;
COMMENT ON COLUMN system_messages.target_province IS
    'CSV di sigle provincia (es. "CA,SS,NU,OR"). Match se almeno UNA matcha customer.provincia_residenza. NULL = tutti.';

-- LTV (Lifetime Value) minimo del cliente in euro
ALTER TABLE system_messages
    ADD COLUMN IF NOT EXISTS target_min_lifetime_value NUMERIC;
COMMENT ON COLUMN system_messages.target_min_lifetime_value IS
    'Filtro: parte solo se la spesa totale storica del cliente >= questo valore (in euro). NULL = no min.';

-- Fatture insolute presenti / assenti
ALTER TABLE system_messages
    ADD COLUMN IF NOT EXISTS target_has_unpaid_invoices BOOLEAN;
COMMENT ON COLUMN system_messages.target_has_unpaid_invoices IS
    'NULL = nessun filtro. true = solo clienti con fatture non pagate. false = solo clienti senza insoluti.';

-- Ha gia' usato un codice promo
ALTER TABLE system_messages
    ADD COLUMN IF NOT EXISTS target_used_promo_before BOOLEAN;
COMMENT ON COLUMN system_messages.target_used_promo_before IS
    'NULL = nessun filtro. true = solo clienti che hanno gia'' usato una promo. false = mai.';

-- Numero di estensioni / proroghe (range)
ALTER TABLE system_messages
    ADD COLUMN IF NOT EXISTS target_extension_count_min INTEGER;
ALTER TABLE system_messages
    ADD COLUMN IF NOT EXISTS target_extension_count_max INTEGER;
COMMENT ON COLUMN system_messages.target_extension_count_min IS 'Min N proroghe storiche del cliente. NULL = no min.';
COMMENT ON COLUMN system_messages.target_extension_count_max IS 'Max N proroghe storiche del cliente. NULL = no max.';
