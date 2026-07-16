-- ============================================
-- Template WhatsApp per il contratto RICONDOTTO (estensione)
-- ============================================
-- Prima il testo di accompagnamento del PDF ricondotto era hardcoded in
-- reconductSignedContract. Ora e' un template editabile da Messaggi di Sistema
-- Pro. Variabili: {numero_contratto}/{contratto}, {data_riconsegna}/{data}.

INSERT INTO system_messages (message_key, label, description, message_body, is_automatic, is_enabled)
VALUES (
    'pro_contratto_ricondotto_estensione',
    'Contratto Ricondotto (Estensione)',
    'Testo di accompagnamento inviato via WhatsApp col PDF del contratto ricondotto per estensione (gia firmato, nuove date).',
    'Contratto {numero_contratto} aggiornato per estensione fino al {data_riconsegna} — firma gia valida, nessuna nuova firma richiesta. DR7',
    false,
    true
)
ON CONFLICT (message_key) DO NOTHING;
