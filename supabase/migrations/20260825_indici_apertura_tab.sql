-- Indici per l'apertura delle tab (25/08/2026)
--
-- Aprire Noleggio e il Calendario legge le stesse tabelle con gli stessi
-- ordinamenti a ogni giro. Su `bookings` esisteva UN SOLO indice
-- (brand_id, sede_id): tutto il resto era scansione completa.
--
-- Nessun indice cambia i dati o i risultati: cambiano solo i tempi.
-- Su tabelle di queste dimensioni la creazione e' immediata.

-- Lista Noleggio: ORDER BY created_at DESC
create index if not exists bookings_created_at_desc_idx
  on public.bookings (created_at desc);

-- Calendario: finestra sul mese (pickup_date < to AND dropoff_date >= from)
create index if not exists bookings_pickup_date_idx
  on public.bookings (pickup_date);

create index if not exists bookings_dropoff_date_idx
  on public.bookings (dropoff_date);

-- Filtri per business / tipo servizio, usati da quasi tutte le tab
create index if not exists bookings_service_type_idx
  on public.bookings (service_type);

-- Contratti: la mappa booking_id -> pdf firmato
create index if not exists contracts_booking_id_idx
  on public.contracts (booking_id);

-- Clienti: ORDER BY updated_at DESC in list-customers, e i lookup per email
create index if not exists customers_extended_updated_at_desc_idx
  on public.customers_extended (updated_at desc);

create index if not exists customers_extended_email_idx
  on public.customers_extended (email);
