-- 29/08/2026 (direzione): il messaggio con cui si manda un CODICE SCONTO dal
-- tab "Codice Sconto" era scritto nel codice (CodiciScontoTab.openSendModal),
-- quindi non modificabile da nessuno. Ora e' un template Pro come tutti gli
-- altri: si cambia da Messaggi di Sistema Pro > Marketing.
--
-- Distinto da "Codice Sconto Recensione" (due codici generati dopo una
-- recensione): qui il codice e' uno solo, creato a mano dall'admin.
--
-- Token: {nome} {codice} {valore} {servizi} {validita} {spesa_minima} {sito}
INSERT INTO system_messages (message_key, label, description, message_body)
VALUES (
  'pro_marketing_invio_codice_sconto',
  'Invio Codice Sconto',
  'WhatsApp con cui si manda un codice sconto al cliente dal tab Codice Sconto. Token: {nome}, {codice}, {valore}, {servizi}, {validita}, {spesa_minima}, {sito}',
  E'Ciao {nome},\n\nEcco il tuo codice sconto DR7 di {valore} su {servizi}:\n\n*{codice}*\n\nValido fino al {validita}.{spesa_minima}\n\nLo puoi usare al check-out su {sito}\n\nGrazie,\n*DR7*'
)
ON CONFLICT (message_key) DO NOTHING;

-- Le colonne di stato sono state aggiunte da migrazioni successive: si
-- valorizzano solo se esistono davvero, cosi' la migrazione gira su qualunque
-- istanza (inclusa la copia demo).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'system_messages' AND column_name = 'is_enabled') THEN
    EXECUTE $sql$UPDATE system_messages SET is_enabled = true
                 WHERE message_key = 'pro_marketing_invio_codice_sconto' AND is_enabled IS DISTINCT FROM true$sql$;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'system_messages' AND column_name = 'is_automatic') THEN
    EXECUTE $sql$UPDATE system_messages SET is_automatic = false
                 WHERE message_key = 'pro_marketing_invio_codice_sconto'$sql$;
  END IF;
END $$;
