-- =============================================================================
-- Scadenza cauzione — FASE 7 (allarme campanella) + FASE 10 (migrazione pratiche)
-- Richiede 20260722_cauzione_scadenza_rimborso.sql + 20260722b.
-- =============================================================================

-- ── FASE 7: riga di config dell'allarme "Scadenza cauzione" (campanella) ─────
-- La logica di trigger vive in VehicleAlarmContext.checkCauzioneScadenzaAlarms.
-- threshold_value = giorni di anticipo (0 = suona il giorno della scadenza).
INSERT INTO public.system_alarms
  (id, label, schedule, reason, category, threshold_value, threshold_unit, is_enabled, sort_order)
VALUES
  ('cauzione_scadenza_rimborso',
   'Scadenza Cauzione da Restituire',
   'Il giorno della scadenza restituzione (e finche'' non gestita)',
   'La restituzione della cauzione scade oggi: avvisa Amministrazione di eseguire il bonifico / svincolo. Suona finche'' la pratica non passa a Restituita/Trattenuta.',
   'booking', 0, 'days', true, 60)
ON CONFLICT (id) DO NOTHING;

-- ── FASE 10: migrazione delle pratiche gia' aperte ──────────────────────────
-- 1) stato_restituzione coerente con lo stato attuale: le cauzioni gia'
--    restituite/svincolate non devono generare avvisi.
UPDATE public.cauzioni
   SET stato_restituzione = 'RESTITUITA'
 WHERE stato IN ('Restituita', 'Sbloccata')
   AND stato_restituzione = 'DA_RESTITUIRE';

-- 2) Ricalcolo scadenza con la regola FASE 3 (15 gg calendario) sulle pratiche
--    ancora da restituire e non forzate a mano. La modifica diretta di
--    scadenza_cauzione NON riattiva il trigger (che guarda solo
--    data_restituzione_veicolo), quindi il valore impostato qui resta.
UPDATE public.cauzioni c
   SET scadenza_cauzione = (c.data_restituzione_veicolo
        + ((SELECT COALESCE(giorni_restituzione_default, 15) FROM public.cauzioni_config WHERE id = 'main') || ' days')::interval)::date
 WHERE c.stato_restituzione = 'DA_RESTITUIRE'
   AND c.scadenza_forzata_manualmente = FALSE
   AND c.stato NOT IN ('Restituita', 'Sbloccata', 'Bloccata', 'Danno');

-- 3) Se la scadenza calcolata e' gia' passata, spostala a DOMANI: cosi' al primo
--    rilascio non parte una raffica di avvisi arretrati tutti insieme.
UPDATE public.cauzioni
   SET scadenza_cauzione = (CURRENT_DATE + INTERVAL '1 day')::date
 WHERE stato_restituzione = 'DA_RESTITUIRE'
   AND scadenza_forzata_manualmente = FALSE
   AND stato NOT IN ('Restituita', 'Sbloccata', 'Bloccata', 'Danno')
   AND scadenza_cauzione < CURRENT_DATE;

-- 4) Precompila l'intestatario del rimborso col nome del cliente dove mancante.
UPDATE public.cauzioni c
   SET intestatario_conto = TRIM(BOTH ' ' FROM COALESCE(
        CASE WHEN cust.tipo_cliente = 'azienda' THEN COALESCE(cust.ragione_sociale, cust.denominazione) END,
        NULLIF(TRIM(BOTH ' ' FROM CONCAT_WS(' ', cust.nome, cust.cognome)), '')
      ))
  FROM public.customers_extended cust
 WHERE c.cliente_id = cust.id
   AND (c.intestatario_conto IS NULL OR c.intestatario_conto = '')
   AND c.stato_restituzione = 'DA_RESTITUIRE';
-- iban_rimborso resta vuoto di proposito: comparira' nel filtro "IBAN mancante".
