-- ============================================
-- Avviso variazione prezzo DR7 Club
-- ============================================
-- Il rinnovo dell'abbonamento addebita il prezzo di listino del momento e non
-- piu' quello congelato all'iscrizione: chi paghera' di piu' va avvisato prima.
--
-- Il testo vive qui, in Messaggi di Sistema Pro, e non dentro il codice: e' una
-- comunicazione contrattuale e la direzione deve poterla riscrivere senza un
-- rilascio.
--
-- Lo manda `Sito/netlify/functions/process-club-renewals.js` (avviso automatico
-- 15 giorni prima del rinnovo, una volta sola per ogni nuovo prezzo) e la
-- sezione DR7 Club di Centralina Pro, per l'invio a tutti gli abbonati.
--
-- Variabili: {prezzo_vecchio}, {prezzo_nuovo}, {periodo} (/mese o /anno),
-- {data_rinnovo}, {piano}, {nome}.
--
-- is_automatic = false: non e' agganciato a un evento delle prenotazioni, parte
-- dal cron degli abbonamenti e dal pulsante in Centralina.

INSERT INTO system_messages (message_key, label, description, message_body, is_automatic, is_enabled)
VALUES (
    'pro_club_price_change',
    'DR7 Club — Variazione prezzo',
    'Avviso al socio prima che il rinnovo venga addebitato al nuovo prezzo. Inviato dal cron rinnovi (15 giorni prima) e a mano da Centralina Pro > DR7 Club.',
    'Gentile Cliente, la informiamo che dal prossimo rinnovo il costo del suo abbonamento DR7 Club passerà da {prezzo_vecchio} a {prezzo_nuovo}{periodo}.

Potrà continuare normalmente con il nuovo prezzo oppure annullare l''abbonamento senza alcuna penale prima del rinnovo.

In caso di cancellazione, l''accesso al DR7 Club terminerà alla scadenza del periodo già pagato e verranno meno i relativi privilegi e benefici maturati secondo le Condizioni del Club. La cancellazione è definitiva e non sarà possibile riattivare successivamente l''adesione.',
    false,
    true
)
ON CONFLICT (message_key) DO NOTHING;
