-- 01/10/2026 (direzione): messaggio al cliente per l'allarme "Contratto non
-- firmato 30 minuti dal ritiro". Prima la riga puntava a signature_otp_whatsapp
-- (il testo del codice OTP, senza codice: non poteva partire).
--
-- Usa solo {nome} e {vehicle_name}: alarm-send-message non conosce il link di
-- firma ne' il numero di contratto, e un token non risolto blocca l'invio.
-- L'invio automatico resta spento: si accende da Centralina Pro > Allarmi.
INSERT INTO system_messages (message_key, label, description, message_body, is_enabled, is_automatic, include_header, handled_events)
VALUES (
  'pro_promemoria_firma_prima_ritiro',
  'Promemoria Firma prima del Ritiro',
  'Al cliente quando il ritiro e'' vicino e il contratto non e'' firmato (allarme "Contratto non firmato 30 minuti dal ritiro"). Token: {nome}, {vehicle_name}',
  E'Gentile *{nome}*,\n\nil ritiro del veicolo *{vehicle_name}* è previsto a breve, ma il contratto di noleggio non risulta ancora firmato.\n\nLa invitiamo a completare la firma digitale dal link che Le abbiamo inviato su WhatsApp: richiede meno di un minuto. Senza contratto firmato non è possibile procedere alla consegna del veicolo.\n\nSe non trova più il link, risponda a questo messaggio e Le invieremo un nuovo collegamento.\n\nCordiali Saluti,\n*DR7*',
  true,
  false,
  false,
  '{}'::text[]
)
ON CONFLICT (message_key) DO NOTHING;

UPDATE system_alarms SET message_key = 'pro_promemoria_firma_prima_ritiro'
 WHERE id = 'con_contratto_non_firmato_30_minuti_dal_ritiro'
   AND message_key = 'signature_otp_whatsapp';
