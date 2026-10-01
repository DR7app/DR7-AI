-- 01/10/2026: allarmi operativi (ritiro, riconsegna, lavaggi, prenotazioni,
-- scadenze) collegati alle rilevazioni di src/utils/allarmi/operativo.ts.
-- Si attivano SOLO le voci per cui il gestionale scrive davvero il dato.
-- is_enabled non si tocca: accenderle resta una scelta della direzione.
--
-- Restano 'in_attesa' (dato inesistente in produzione): km/carburante/foto/
-- video/check di consegna e rientro, chiavi, accessori, verbale di
-- riconsegna, contatto cliente in ritardo, posizione GPS (nessun veicolo
-- collegato a SafeFleet), operatore e stati iniziato/completato/ritirato del
-- lavaggio, controllo qualita', foto finali, operatore della prenotazione,
-- contratto veicolo, garanzie, NLT, rate, soccorso stradale.

-- Ritiro
UPDATE system_alarms SET detector = 'op_pickup_not_ready', stato_rilevamento = 'attivo'
 WHERE id = 'rit_veicolo_non_segnato_come_pronto' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'op_pickup_offsite_todo', stato_rilevamento = 'attivo'
 WHERE id = 'rit_consegna_fuori_sede_organizzare' AND stato_rilevamento = 'in_attesa';

-- Riconsegna
UPDATE system_alarms SET detector = 'op_return_ext_unpaid', stato_rilevamento = 'attivo'
 WHERE id = 'ric_estensione_non_pagata' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'op_return_ext_unformalized', stato_rilevamento = 'attivo'
 WHERE id = 'ric_estensione_noleggio_non_formalizzata' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'return_blocks_next', stato_rilevamento = 'attivo'
 WHERE id = 'ric_ritardo_compromette_noleggio_successivo' AND stato_rilevamento = 'in_attesa';

-- Lavaggi
UPDATE system_alarms SET detector = 'wash_lead', stato_rilevamento = 'attivo'
 WHERE id = 'lav_lavaggio_tra_10_minuti' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'op_wash_no_deposit', stato_rilevamento = 'attivo'
 WHERE id = 'lav_acconto_lavaggio_mancante' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'op_wash_ready_not_notified', stato_rilevamento = 'attivo'
 WHERE id = 'lav_cliente_avvisare_veicolo_pronto' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'op_wash_near_pickup', stato_rilevamento = 'attivo'
 WHERE id = 'lav_lavaggio_prossimo_all_orario_consegna' AND stato_rilevamento = 'in_attesa';

-- Prenotazioni
UPDATE system_alarms SET detector = 'op_booking_duplicate', stato_rilevamento = 'attivo'
 WHERE id = 'pre_doppia_prenotazione_stesso_veicolo' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'op_booking_unverified', stato_rilevamento = 'attivo'
 WHERE id = 'pre_nuova_prenotazione_non_verificata' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'op_booking_cancelled_open', stato_rilevamento = 'attivo'
 WHERE id = 'pre_prenotazione_cancellata_attivita_ancora' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'op_booking_modified_recheck', stato_rilevamento = 'attivo'
 WHERE id = 'pre_prenotazione_modificata_ricontrollare' AND stato_rilevamento = 'in_attesa';
