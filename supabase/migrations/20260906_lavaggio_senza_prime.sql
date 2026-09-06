-- ═══════════════════════════════════════════════════════════════════════════
--  Lavaggio: via la parola PRIME dai nomi dei servizi
--
--  06/09/2026 — "Prime" non e' piu' un marchio in uso: il servizio si chiama
--  URBAN, non PRIME URBAN. I nomi a schermo nel sito e nel gestionale sono
--  gia' stati cambiati nel codice; questa migration sistema il catalogo, che
--  vive nel database (`car_wash_services`) e alimenta tutte e due.
--
--  Si tocca SOLO il prefisso, e solo dove c'e': "PRIME MAXI FULL CLEAN"
--  diventa "MAXI FULL CLEAN", "PRIME TOP SHINE MAXI" diventa "TOP SHINE
--  MAXI". Gli `id` non si toccano (urban-full resta urban-full): sono loro a
--  legare prezzi, prenotazioni e listini. Le prenotazioni gia' fatte
--  conservano il nome dentro `booking_details`, e restano com'erano — sono
--  documenti di quel giorno, non vanno riscritti.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Prima di toccare: quante righe e quali ────────────────────────────
SELECT count(*) FILTER (WHERE name LIKE 'PRIME %')    AS nomi_it_da_cambiare,
       count(*) FILTER (WHERE name_en LIKE 'PRIME %') AS nomi_en_da_cambiare,
       count(*)                                       AS righe_totali
  FROM public.car_wash_services;

SELECT id, category, name, name_en
  FROM public.car_wash_services
 WHERE name LIKE 'PRIME %' OR name_en LIKE 'PRIME %'
 ORDER BY category, id;

-- ── 2. Il cambio ─────────────────────────────────────────────────────────
UPDATE public.car_wash_services
   SET name = regexp_replace(name, '^PRIME\s+', '')
 WHERE name LIKE 'PRIME %';

UPDATE public.car_wash_services
   SET name_en = regexp_replace(name_en, '^PRIME\s+', '')
 WHERE name_en LIKE 'PRIME %';

-- ── 3. Verifica: la prima colonna deve essere 0 ──────────────────────────
SELECT count(*) FILTER (WHERE name LIKE 'PRIME %' OR name_en LIKE 'PRIME %') AS rimasti_con_prime,
       count(*)                                                              AS righe_totali
  FROM public.car_wash_services;

SELECT id, category, name, name_en
  FROM public.car_wash_services
 ORDER BY category, display_order, id;
