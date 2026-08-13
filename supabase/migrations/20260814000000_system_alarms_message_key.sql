-- Messaggio collegato a un allarme.
--
-- Quando l'allarme suona (rientro in ritardo, cauzione da versare, lavaggio
-- fra poco, ...) l'operatore deve poter avvisare il cliente senza uscire
-- dalla schermata e senza scrivere il testo a mano. Il testo vive dove vivono
-- tutti gli altri: Messaggi di Sistema Pro (`system_messages`).
--
-- Qui si salva SOLO quale template usare per ciascun allarme. Il template si
-- sceglie da Centralina Pro > Allarmi. Se resta vuoto, l'allarme non mostra
-- il pulsante: meglio nessun bottone che un bottone che manda un messaggio
-- vuoto o sbagliato.
ALTER TABLE public.system_alarms
    ADD COLUMN IF NOT EXISTS message_key TEXT;

COMMENT ON COLUMN public.system_alarms.message_key IS
    'message_key di system_messages da inviare al cliente quando l''allarme suona. NULL = nessun pulsante di invio.';
