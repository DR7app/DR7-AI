-- 01/10/2026 (direzione): nomi dei template Pro leggibili e coerenti con il
-- testo. Solo il LABEL cambia; chiavi, testi, eventi e invii restano uguali.
-- Controllato prima: nessuno di questi label e' letto dal codice (i template
-- cercati per nome esatto — Preventivo WhatsApp, Promozione a ELITE/MEMBER,
-- Notifica Autista, Ordine Ricambi, Codice Sconto Recensione, Invio Codice
-- Sconto — NON sono toccati) e nessun nuovo nome cambia cosa salta la cron
-- (LABEL_FALLBACKS). Ogni UPDATE parte solo se il nome e' ancora quello vecchio.
UPDATE system_messages SET label = 'Modifica Lavaggio' WHERE message_key = 'pro_promemoria_pagamento' AND label = 'Modifica prime Wash';
UPDATE system_messages SET label = 'Modifica Noleggio Confermata' WHERE message_key = 'pro_promemoria_appuntamento' AND label = 'Modifica Noleggio confermato';
UPDATE system_messages SET label = 'Allerta Meteo — Noleggio Auto' WHERE message_key = 'pro_allerta_meteo' AND label = 'Allerta Meteo';
UPDATE system_messages SET label = 'Link Pagamento Noleggio' WHERE message_key = 'pro_richiesta_pagamento' AND label = 'Link Pagamento';
UPDATE system_messages SET label = 'Link Pagamento Lavaggio' WHERE message_key LIKE 'pro_custom_link_pagamento_lavaggi_%' AND label = 'Link pagamento lavaggi';
UPDATE system_messages SET label = 'Link Pagamento Penali e Danni' WHERE message_key LIKE 'pro_custom_link_pagamento_penali_e_danni_%' AND label = 'Link pagamento penali e danni';
UPDATE system_messages SET label = 'Acconto Registrato (collaboratore)' WHERE message_key LIKE 'pro_custom_acconti_%' AND label = 'acconti';
UPDATE system_messages SET label = 'Preautorizzazione Cauzione Confermata' WHERE message_key LIKE 'pro_custom_preautorizzazione_confermata_%' AND label = 'preautorizzazione confermata';
UPDATE system_messages SET label = 'Cauzione Scaduta — Avviso al Cliente' WHERE message_key LIKE 'pro_custom_reso_cauzione_al_cliente_%' AND label = 'Reso Cauzione- al cliente';
UPDATE system_messages SET label = 'Promemoria Ritiro Noleggio (giorno prima)' WHERE message_key LIKE 'pro_custom_promemoria_ritiro_veicolo_%' AND label = 'promemoria ritiro veicolo';
UPDATE system_messages SET label = 'Promemoria Autista — Uscita Straordinaria' WHERE message_key LIKE 'pro_custom_uscita_straordinaria_%' AND label = 'uscita straordinaria';
UPDATE system_messages SET label = 'Fidelity Prime Wash — 250 Punti' WHERE message_key LIKE 'pro_custom_raggiungimento_250_punti_fidelity_%' AND label = 'RAGGIUNGIMENTO 250 PUNTI FIDELITY';
UPDATE system_messages SET label = 'Maxi Promo — Giorno Libero' WHERE message_key LIKE 'pro_custom_maxi_promo_gap_1gg_%' AND label = 'MAXI PROMO GAP';
UPDATE system_messages SET label = 'Maxi Promo — Lun-Gio' WHERE message_key LIKE 'pro_custom_promo_incassi_%' AND label = 'PROMO INCASSI';
UPDATE system_messages SET label = 'Lavaggio Pronto per il Ritiro' WHERE message_key LIKE 'pro_custom_lavaggio_concluso_%' AND label = 'Lavaggio concluso';
UPDATE system_messages SET label = 'Veicolo Pronto per il Ritiro' WHERE message_key LIKE 'pro_custom_noleggio_pronto_%' AND label = 'Noleggio pronto';
