-- 2026-08-24 — Backfill: aggancio prenotazioni Mare/Aria/Soggiorni al catalogo
--
-- PERCHE'. Tutte le 21 prenotazioni boat_rental/heli_rental esistenti hanno
-- vehicle_id NULL e vehicle_plate NULL: il Report le abbina al mezzo SOLO per
-- nome esatto. Una riga salvata "Bell 407 GX" invece di "Bell 407 GXP" usciva
-- dai totali del Report Aria (398 EUR su 2.888 di luglio 2026).
-- Da adesso il gestionale scrive booking_details.vehicle_id alla creazione;
-- questo script sistema lo storico.
--
-- NOTA: si scrive in booking_details, NON in bookings.vehicle_id, che riferisce
-- la tabella `vehicles` (flotta Terra). Barche ed elicotteri stanno in
-- `noleggio_catalog`.

-- ── 1. CONTROLLO PRIMA (non scrive niente) ───────────────────────────────────
-- Chi si aggancia e chi no. Le righe con catalog_id NULL sono quelle col nome
-- che non esiste a catalogo: vanno corrette a mano (vedi punto 3).
SELECT b.id,
       b.service_type,
       b.vehicle_name,
       c.id   AS catalog_id,
       c.name AS catalog_name,
       b.price_total / 100.0 AS totale_eur,
       b.status
FROM public.bookings b
LEFT JOIN public.noleggio_catalog c
       ON c.service_type = b.service_type
      AND lower(btrim(c.name)) = lower(btrim(b.vehicle_name))
WHERE b.service_type IN ('boat_rental', 'heli_rental', 'stay_rental')
  AND b.booking_details->>'vehicle_id' IS NULL
ORDER BY c.id NULLS FIRST, b.created_at DESC;

-- ── 2. CORREZIONE DEL NOME SBAGLIATO (1 riga attesa) ─────────────────────────
-- "Bell 407 GX" -> "Bell 407 GXP". Ancorata all'id esatto della prenotazione,
-- non al nome, cosi' non puo' toccare altro.
UPDATE public.bookings
   SET vehicle_name = 'Bell 407 GXP'
 WHERE id = 'f5c2908f-4cdd-41b0-8a80-a283ea1d8c33'
   AND vehicle_name = 'Bell 407 GX';
-- Atteso: UPDATE 1

-- ── 3. BACKFILL vehicle_id ───────────────────────────────────────────────────
UPDATE public.bookings b
   SET booking_details = COALESCE(b.booking_details, '{}'::jsonb)
                         || jsonb_build_object('vehicle_id', c.id::text)
  FROM public.noleggio_catalog c
 WHERE c.service_type = b.service_type
   AND lower(btrim(c.name)) = lower(btrim(b.vehicle_name))
   AND b.service_type IN ('boat_rental', 'heli_rental', 'stay_rental')
   AND b.booking_details->>'vehicle_id' IS NULL;
-- Atteso: UPDATE 21 (dopo il punto 2)

-- ── 4. CONTROLLO DOPO: deve restituire 0 righe ───────────────────────────────
SELECT b.id, b.service_type, b.vehicle_name
FROM public.bookings b
WHERE b.service_type IN ('boat_rental', 'heli_rental', 'stay_rental')
  AND b.booking_details->>'vehicle_id' IS NULL;
