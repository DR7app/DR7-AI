-- Status clienti personalizzabili: customers_extended.status deve accettare
-- anche le chiavi create dall'admin in Centralina Pro > Status Clienti.
--
-- La vecchia migration add_customer_status.sql aveva messo un CHECK con tre
-- valori ('blacklist','has_rental','vip') che non comprende nemmeno gli status
-- usati oggi (member/elite). Se il vincolo esiste ancora su questo database,
-- qualsiasi assegnazione fallisce con errore 23514. Qui si toglie: la lista
-- valida vive nella configurazione, non nello schema.
--
-- Idempotente: se il vincolo non c'e' (caso probabile in produzione, visto che
-- member/elite si assegnano gia' senza errori) la migration non fa nulla.
ALTER TABLE public.customers_extended
  DROP CONSTRAINT IF EXISTS customers_extended_status_check;

COMMENT ON COLUMN public.customers_extended.status IS
  'Chiave status cliente. Valori validi = chiavi in centralina_pro_config.main.config.client_status (standard/member/elite/blacklist + quelli creati da Centralina Pro > Status Clienti).';
