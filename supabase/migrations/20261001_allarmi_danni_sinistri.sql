-- 01/10/2026: rilevazioni dei gruppi "danni" e "sinistri".
-- Codice: src/utils/allarmi/danniSinistri.ts (fonte: bookings.booking_details.danni[]).
-- Si accende solo la rilevazione; is_enabled resta come l'ha scelto la direzione.
-- Le voci "sinistri" e gli altri "danni" restano in_attesa: in database non
-- esistono i dati per rilevarle (nessuna tabella sinistri, nessuno stato
-- "riparato", nessuna gravita', nessun controllo al rientro, nessun preventivo).

UPDATE system_alarms SET detector = 'danni_nuovo', stato_rilevamento = 'attivo'
 WHERE id = 'dan_nuovo_danno_rilevato' AND stato_rilevamento = 'in_attesa';

UPDATE system_alarms SET detector = 'danni_senza_foto', stato_rilevamento = 'attivo'
 WHERE id = 'dan_danno_rilevato_non_fotografato' AND stato_rilevamento = 'in_attesa';

UPDATE system_alarms SET detector = 'danni_senza_importo', stato_rilevamento = 'attivo'
 WHERE id = 'dan_danno_rilevato_non_valorizzato' AND stato_rilevamento = 'in_attesa';

UPDATE system_alarms SET detector = 'danni_non_addebitato', stato_rilevamento = 'attivo'
 WHERE id = 'dan_addebito_danno_non_effettuato' AND stato_rilevamento = 'in_attesa';

UPDATE system_alarms SET detector = 'danni_saldo_aperto', stato_rilevamento = 'attivo'
 WHERE id = 'dan_danno_pratica_ancora_aperta' AND stato_rilevamento = 'in_attesa';
