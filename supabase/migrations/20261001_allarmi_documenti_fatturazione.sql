-- 01/10/2026: rilevazioni per i gruppi "documenti" e "fatturazione".
--
-- Codice: src/utils/allarmi/documentiFatture.ts (modulo registrato in
-- src/utils/allarmi/index.ts). Si collegano solo le righe ancora
-- 'in_attesa'; is_enabled NON si tocca: accendere resta una scelta della
-- direzione da Centralina Pro > Allarmi.
--
-- Restano 'in_attesa' perche' il dato non esiste:
--   doc_documento_scadenza / doc_documento_scaduto — la scadenza del
--     documento d'identita' non e' salvata (nessuna colonna in
--     customers_extended; solo 1 scheda su 2158 la ha in metadata).
--   doc_patente_non_compatibile_veicolo — i veicoli non dicono che patente
--     serve e tipo_patente e' compilato su 15 schede su 2158.
--   fat_rimborso_cliente_effettuare / _scadenza / _non_completato — refunds e
--     refund_requests sono vuote, bookings.refund_status e' sempre 'none':
--     nessun rimborso viene registrato.

-- Documenti
UPDATE system_alarms SET detector = 'doc_x_anzianita_patente', stato_rilevamento = 'attivo'
 WHERE id = 'doc_anzianita_patente_insufficiente' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'doc_x_eta_conducente', stato_rilevamento = 'attivo'
 WHERE id = 'doc_eta_conducente_non_compatibile' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'doc_x_pratica_da_confermare', stato_rilevamento = 'attivo'
 WHERE id = 'doc_cliente_pratica_ancora_approvare' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'doc_x_dati_incompleti', stato_rilevamento = 'attivo'
 WHERE id = 'doc_dati_cliente_incompleti' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'doc_x_documento_rifiutato', stato_rilevamento = 'attivo'
 WHERE id = 'doc_documento_illeggibile' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'doc_x_verifica_in_sospeso', stato_rilevamento = 'attivo'
 WHERE id = 'doc_verifica_documentale_non_completata' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'doc_x_lato_mancante:fronte', stato_rilevamento = 'attivo'
 WHERE id = 'doc_fronte_documento_mancante' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'doc_x_lato_mancante:retro', stato_rilevamento = 'attivo'
 WHERE id = 'doc_retro_documento_mancante' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'doc_x_secondo_conducente', stato_rilevamento = 'attivo'
 WHERE id = 'doc_secondo_conducente_senza_documenti' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'doc_x_patente_scaduta', stato_rilevamento = 'attivo'
 WHERE id = 'doc_patente_scaduta' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'doc_x_patente_in_scadenza', stato_rilevamento = 'attivo'
 WHERE id = 'doc_patente_scadenza' AND stato_rilevamento = 'in_attesa';

-- Fatturazione
UPDATE system_alarms SET detector = 'fatt_scartata_sdi', stato_rilevamento = 'attivo'
 WHERE id = 'fat_fattura_correggere' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'fatt_bozza_bloccata', stato_rilevamento = 'attivo'
 WHERE id = 'fat_fattura_dati_mancanti' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'fatt_cf_non_valido', stato_rilevamento = 'attivo'
 WHERE id = 'fat_codice_fiscale_mancante_fattura' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'fatt_dato_azienda:partita_iva', stato_rilevamento = 'attivo'
 WHERE id = 'fat_partita_iva_mancante' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'fatt_dato_azienda:sdi_pec', stato_rilevamento = 'attivo'
 WHERE id = 'fat_codice_sdi_pec_mancante_quando_necessario' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'fatt_senza_pagamento:attiva', stato_rilevamento = 'attivo'
 WHERE id = 'fat_fattura_emessa_senza_pagamento_associato' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'fatt_senza_pagamento:annullata', stato_rilevamento = 'attivo'
 WHERE id = 'fat_nota_credito_generare' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'fatt_senza_fattura', stato_rilevamento = 'attivo'
 WHERE id = 'fat_fattura_non_generata_dopo_pagamento' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'fatt_extra_senza_fattura', stato_rilevamento = 'attivo'
 WHERE id = 'fat_pagamento_registrato_senza_fattura' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'fatt_incasso_senza_pratica', stato_rilevamento = 'attivo'
 WHERE id = 'fat_incasso_non_riconciliato' AND stato_rilevamento = 'in_attesa';
UPDATE system_alarms SET detector = 'fatt_documento_senza_pratica', stato_rilevamento = 'attivo'
 WHERE id = 'fat_movimento_amministrativo_senza_pratica_associata' AND stato_rilevamento = 'in_attesa';

-- Da decidere a parte (non applicato qui): fat_fattura_generare e' gia'
-- 'attivo' con detector 'invoice_missing', che guarda bookings.invoice_url —
-- colonna che nessuno scrive piu' (le fatture stanno in `fatture`). Acceso,
-- suonerebbe su OGNI prenotazione pagata, wallet compresi. Ripuntarlo su
-- 'fatt_senza_fattura' lo farebbe funzionare:
--   UPDATE system_alarms SET detector = 'fatt_senza_fattura' WHERE id = 'fat_fattura_generare';
