-- 01/10/2026: rilevazioni dei gruppi `multe` e `officina`
-- (codice in src/utils/allarmi/multeOfficina.ts).
--
-- Si accendono SOLO le righe che hanno davvero un dato da guardare; is_enabled
-- non si tocca (lo decide la direzione). Le altre restano 'in_attesa' perche'
-- il dato non esiste in database:
--   mul_multa_associata_non_notificata, mul_multa_ricevuta_associare_cliente,
--   mul_termine_comunicazione_conducente_scadenza -> la multa si salva solo
--     DOPO l'invio della PEC (multe_pec_log); prima vive solo nella schermata.
--   mul_multa_non_pagata -> nessuno stato di pagamento della multa.
--   mul_parcheggio_addebitare, mul_pedaggio_addebitare, mul_pedaggio_associare,
--   mul_ztl_verificare -> nessuna tabella di pedaggi / parcheggi / transiti ZTL.
--   off_preventivo_officina_atteso -> nessun preventivo officina registrato.
--   off_ricambio_non_arrivato_entro_data_prevista -> inv_ordini non ha una
--     data di consegna prevista.

UPDATE system_alarms SET detector = 'multe_da_riaddebitare', stato_rilevamento = 'attivo'
 WHERE id = 'mul_multa_riaddebitare' AND stato_rilevamento = 'in_attesa';

UPDATE system_alarms SET detector = 'multe_spesa_da_recuperare', stato_rilevamento = 'attivo'
 WHERE id = 'mul_spesa_post_noleggio_recuperare' AND stato_rilevamento = 'in_attesa';

UPDATE system_alarms SET detector = 'multe_pratica_post_noleggio_aperta', stato_rilevamento = 'attivo'
 WHERE id = 'mul_pratica_post_noleggio_ancora_aperta' AND stato_rilevamento = 'in_attesa';

UPDATE system_alarms SET detector = 'officina_appuntamento_lead', stato_rilevamento = 'attivo'
 WHERE id = 'off_appuntamento_officina_tra_24_ore' AND stato_rilevamento = 'in_attesa';

UPDATE system_alarms SET detector = 'officina_appuntamento_lead', stato_rilevamento = 'attivo'
 WHERE id = 'off_appuntamento_officina_tra_60_minuti' AND stato_rilevamento = 'in_attesa';

UPDATE system_alarms SET detector = 'officina_veicolo_da_portare', stato_rilevamento = 'attivo'
 WHERE id = 'off_veicolo_portare_officina' AND stato_rilevamento = 'in_attesa';

UPDATE system_alarms SET detector = 'officina_veicolo_da_ritirare', stato_rilevamento = 'attivo'
 WHERE id = 'off_veicolo_ritirare_dall_officina' AND stato_rilevamento = 'in_attesa';

UPDATE system_alarms SET detector = 'officina_oltre_data_prevista', stato_rilevamento = 'attivo'
 WHERE id = 'off_riparazione_oltre_data_prevista' AND stato_rilevamento = 'in_attesa';

UPDATE system_alarms SET detector = 'officina_veicolo_fermo', stato_rilevamento = 'attivo'
 WHERE id = 'off_veicolo_fermo' AND stato_rilevamento = 'in_attesa';

UPDATE system_alarms SET detector = 'officina_ricambio_ordinato', stato_rilevamento = 'attivo'
 WHERE id = 'off_ricambio_ordinato' AND stato_rilevamento = 'in_attesa';
