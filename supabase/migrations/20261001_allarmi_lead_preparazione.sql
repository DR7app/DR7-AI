-- 01/10/2026: rilevazioni dei gruppi `lead` e `preparazione`
-- (codice in src/utils/allarmi/leadPreparazione.ts).
--
-- Si accendono SOLO le rilevazioni: is_enabled non si tocca, l'allarme lo
-- accende la direzione. La condizione `stato_rilevamento = 'in_attesa'` evita
-- di sovrascrivere una riga gia' collegata a mano.
--
-- Restano 'in_attesa' (manca il dato, non il codice):
--   led_nuova_lead_non_presa_carico, led_cliente_ricontattare,
--   led_lead_calda_senza_attivita_programmata,
--   led_cliente_interessato_senza_follow_up,
--   led_cliente_ha_aperto_link_non_completato_prenotazione,
--   prp_adblue_ripristinare, prp_batteria_veicolo_bassa,
--   prp_carburante_ripristinare, prp_interni_controllare,
--   prp_liquido_lavavetri_basso, prp_veicolo_igienizzare,
--   prp_veicolo_mettere_carica.

-- Lead (preventivi, pagamenti, prenotazioni dal sito, inviti)
UPDATE public.system_alarms SET detector = 'lead_preventivo_richiesto', stato_rilevamento = 'attivo'
 WHERE id = 'led_preventivo_richiesto_non_inviato' AND stato_rilevamento = 'in_attesa';
UPDATE public.system_alarms SET detector = 'lead_preventivo_richiesto', stato_rilevamento = 'attivo'
 WHERE id = 'led_lead_senza_risposta_x_minuti' AND stato_rilevamento = 'in_attesa';
UPDATE public.system_alarms SET detector = 'lead_preventivo_senza_risposta', stato_rilevamento = 'attivo'
 WHERE id = 'led_preventivo_inviato_senza_risposta' AND stato_rilevamento = 'in_attesa';
UPDATE public.system_alarms SET detector = 'lead_preventivo_in_scadenza', stato_rilevamento = 'attivo'
 WHERE id = 'led_preventivo_scadenza' AND stato_rilevamento = 'in_attesa';
UPDATE public.system_alarms SET detector = 'lead_preventivo_in_scadenza', stato_rilevamento = 'attivo'
 WHERE id = 'led_prezzo_bloccato_prossimo_scadenza' AND stato_rilevamento = 'in_attesa';
UPDATE public.system_alarms SET detector = 'lead_prezzo_bloccato_scaduto', stato_rilevamento = 'attivo'
 WHERE id = 'led_prezzo_bloccato_scaduto' AND stato_rilevamento = 'in_attesa';
UPDATE public.system_alarms SET detector = 'lead_pagamento_richiesto', stato_rilevamento = 'attivo'
 WHERE id = 'led_pagamento_richiesto_non_ricevuto' AND stato_rilevamento = 'in_attesa';
UPDATE public.system_alarms SET detector = 'lead_prenotazione_abbandonata', stato_rilevamento = 'attivo'
 WHERE id = 'led_prenotazione_iniziata_non_completata' AND stato_rilevamento = 'in_attesa';
UPDATE public.system_alarms SET detector = 'lead_invito_non_compilato', stato_rilevamento = 'attivo'
 WHERE id = 'led_documenti_richiesti_non_ricevuti' AND stato_rilevamento = 'in_attesa';

-- Preparazione (bottone "Pronta" e lavaggi per targa)
UPDATE public.system_alarms SET detector = 'prep_pronta_mancante', stato_rilevamento = 'attivo'
 WHERE id = 'prp_preparazione_veicolo_non_completata' AND stato_rilevamento = 'in_attesa';
UPDATE public.system_alarms SET detector = 'prep_rientro_senza_lavaggio', stato_rilevamento = 'attivo'
 WHERE id = 'prp_veicolo_rientrato_lavaggio_programmare' AND stato_rilevamento = 'in_attesa';
UPDATE public.system_alarms SET detector = 'prep_lavaggio_mancante_prima_uscita', stato_rilevamento = 'attivo'
 WHERE id = 'prp_veicolo_sporco_prenotazione_imminente' AND stato_rilevamento = 'in_attesa';
UPDATE public.system_alarms SET detector = 'prep_lavaggio_mancante_prima_uscita', stato_rilevamento = 'attivo'
 WHERE id = 'prp_veicolo_non_pronto_prossima_uscita' AND stato_rilevamento = 'in_attesa';
