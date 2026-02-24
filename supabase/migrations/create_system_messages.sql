-- System Messages table for WhatsApp bot templates
-- Editable from Admin CRM → Marketing → Messaggi di Sistema

CREATE TABLE IF NOT EXISTS system_messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    message_key TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    message_body TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed default messages
INSERT INTO system_messages (message_key, label, description, message_body) VALUES
(
    'supercar_day_before',
    'Supercar — Giorno prima fine noleggio',
    'Messaggio inviato il giorno prima della fine del noleggio ai clienti Supercar',
    E'Buongiorno {nome},\n\nVorrebbe valutare una promo in continuazione super vantaggiosa?\n\nCordiali saluti,\nDR7'
),
(
    'utilitaria_day_before',
    'Utilitaria — Giorno prima fine noleggio',
    'Messaggio inviato il giorno prima della fine del noleggio ai clienti Utilitaria/Urban',
    E'Buongiorno {nome},\n\nLa contattiamo per informarla che, qualora avesse necessità di prolungare il noleggio, restiamo a disposizione per verificarne la disponibilità.\n\nIn caso di estensione, possiamo riservarle uno sconto dedicato sul periodo aggiuntivo.\n\nQualora lo desiderasse, le chiediamo gentilmente di indicarci per quanto tempo intende eventualmente prolungare, così da poter valutare la soluzione più conveniente.\n\nCordiali saluti,\nDR7'
),
(
    'deposit_return_iban',
    'Cauzione — Richiesta IBAN dopo fine noleggio',
    'Messaggio inviato 60 minuti dopo la fine del noleggio ai clienti che hanno lasciato la cauzione',
    E'Buongiorno {nome},\n\nLa ringraziamo per aver scelto i nostri servizi.\n\nAl fine di procedere con la restituzione della cauzione, Le chiediamo cortesemente di comunicarci il Suo IBAN completo e il nominativo dell''intestatario del conto.\n\nIl rimborso verrà effettuato tramite bonifico ordinario entro il quattordicesimo giorno lavorativo, come da condizioni contrattuali.\n\nCordiali saluti,\nDR7'
)
ON CONFLICT (message_key) DO NOTHING;

-- RLS: allow authenticated users to read and update
ALTER TABLE system_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read system_messages" ON system_messages;
CREATE POLICY "Anyone can read system_messages" ON system_messages
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users can update system_messages" ON system_messages;
CREATE POLICY "Authenticated users can update system_messages" ON system_messages
    FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert system_messages" ON system_messages;
CREATE POLICY "Authenticated users can insert system_messages" ON system_messages
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can delete system_messages" ON system_messages;
CREATE POLICY "Authenticated users can delete system_messages" ON system_messages
    FOR DELETE USING (true);
