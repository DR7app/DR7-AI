-- ============================================================================
-- PREVENTIVI LAVAGGIO — servizi veri, veicolo e targa (14/09/2026)
--
-- Richiesta direzione: "il preventivo del lavaggio non e' collegato ai lavaggi
-- veri che abbiamo".
--
-- La scheda Preventivi del Lavaggio riusava quella di Mare/Aria, che pesca i
-- mezzi da `noleggio_catalog`: li' il lavaggio non c'e' (e non deve esserci —
-- il suo listino sta in `car_wash_services`, si modifica dal Catalogo Prime
-- Wash). La tendina restava vuota e servizio e prezzo andavano riscritti a
-- mano, scollegati dal listino.
--
-- Adesso il preventivo lavaggio legge `car_wash_services` e salva il carrello
-- scelto (servizio principale + opzione di prezzo + extra + Prime Flex), cosi'
-- la conversione in prenotazione crea una riga identica a quella scritta dal
-- form Prenotazioni. Servono tre colonne.
--
-- `asset_name` RESTA e continua a contenere il riepilogo leggibile: i
-- preventivi gia' salvati non perdono niente, e il gestionale funziona anche
-- PRIMA di questa migration (salva riepilogo e importo, senza il dettaglio).
-- ============================================================================

ALTER TABLE public.noleggio_preventivi
  ADD COLUMN IF NOT EXISTS carwash_servizi JSONB,
  ADD COLUMN IF NOT EXISTS vehicle_name    TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_plate   TEXT;

COMMENT ON COLUMN public.noleggio_preventivi.carwash_servizi IS
  'Preventivi Lavaggio & Meccanica: { items: [{serviceId, serviceName, quantity, price, option, subtotal, durationMinutes, principale}], prime_flex, prime_flex_price }. serviceId = car_wash_services.id. Stessa forma dei booking_details.cartItems, cosi'' la conversione in prenotazione non traduce niente.';
COMMENT ON COLUMN public.noleggio_preventivi.vehicle_name IS
  'Marca e modello del veicolo da lavare (il lavaggio non ha un mezzo a catalogo: il mezzo e'' quello del cliente).';
COMMENT ON COLUMN public.noleggio_preventivi.vehicle_plate IS 'Targa del veicolo del cliente.';

-- Nessun vincolo di chiave esterna verso car_wash_services: un servizio tolto
-- dal catalogo non deve svuotare i preventivi storici, che restano leggibili
-- grazie a serviceName e asset_name.

-- ── VERIFICA ────────────────────────────────────────────────────────────────
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'noleggio_preventivi'
   AND column_name IN ('carwash_servizi', 'vehicle_name', 'vehicle_plate')
 ORDER BY column_name;
