-- 01/10/2026: rilevazioni dei gruppi manutenzione, pneumatici e chilometraggio
-- (codice in src/utils/allarmi/manutenzione.ts). Accende SOLO la rilevazione
-- delle righe che hanno un dato vero dietro; is_enabled non si tocca.
-- Le righe senza dato (batteria, liquidi, battistrada, pressione, richiami,
-- spie, appuntamenti officina, km percorsi durante il noleggio...) restano
-- in_attesa.

-- Chilometraggio
UPDATE system_alarms SET detector = 'km_sforo:da_calcolare', stato_rilevamento = 'attivo'
 WHERE id = 'km_addebito_chilometri_extra_calcolare' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'km_sforo:non_pagato', stato_rilevamento = 'attivo'
 WHERE id = 'km_addebito_chilometri_extra_non_effettuato' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'km_sforo:registrato', stato_rilevamento = 'attivo'
 WHERE id = 'km_sforamento_chilometrico' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'km_anomalo', stato_rilevamento = 'attivo'
 WHERE id = 'km_chilometraggio_anomalo_rispetto_all_ultimo' AND stato_rilevamento = 'in_attesa';

-- Manutenzione: le scadenze a km hanno l'anticipo in km (1.000 km, come le
-- righe storiche fleet_*), non "7 giorni".
UPDATE system_alarms SET detector = 'manut_tagliando:vicino', stato_rilevamento = 'attivo',
       threshold_value = 1000, threshold_unit = 'km', schedule = '1000 km prima'
 WHERE id = 'man_tagliando_scadenza_chilometraggio' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'manut_tagliando:scaduto', stato_rilevamento = 'attivo'
 WHERE id = 'man_tagliando_scaduto' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'manut_freni:entro', stato_rilevamento = 'attivo',
       threshold_value = 1000, threshold_unit = 'km', schedule = '1000 km prima'
 WHERE id = 'man_controllo_freni_scadenza' AND stato_rilevamento = 'in_attesa';

-- Pneumatici
UPDATE system_alarms SET detector = 'gomme_cambio:vicino', stato_rilevamento = 'attivo',
       threshold_value = 1000, threshold_unit = 'km', schedule = '1000 km prima'
 WHERE id = 'pne_cambio_gomme_programmato' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'gomme_cambio:scaduto', stato_rilevamento = 'attivo'
 WHERE id = 'pne_cambio_gomme_non_effettuato' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'gomme_cambio:scaduto', stato_rilevamento = 'attivo'
 WHERE id = 'pne_pneumatico_sostituire' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'gomme_non_idonee_uscita', stato_rilevamento = 'attivo'
 WHERE id = 'pne_veicolo_pneumatici_non_idonei_prossima_uscita' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'gomme_danno:danno', stato_rilevamento = 'attivo'
 WHERE id = 'pne_pneumatico_danneggiato' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'gomme_danno:usura', stato_rilevamento = 'attivo'
 WHERE id = 'pne_usura_anomala_pneumatici' AND stato_rilevamento = 'in_attesa';
