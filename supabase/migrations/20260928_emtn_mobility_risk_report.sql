-- 28/09/2026 (direzione) — EMTN Mobility Risk Report con analisi documentale AI.
--
-- Flusso: l'operatore carica i documenti (emtn_analisi), l'AI propone eventi
-- e report, l'operatore corregge e INVIA (email al cliente + richiesta di
-- approvazione a DR7), la direzione APPROVA e la posizione entra nella lista
-- EMTN consultabile dagli operatori.
--
-- Una POSIZIONE e' la pratica di un cliente (stesso contratto/evento): i
-- documenti successivi la aggiornano invece di creare nuove segnalazioni.
-- Ogni passaggio resta in emtn_posizioni_storico (audit trail).
--
-- Come tutto EMTN: RLS attiva e nessuna policy, si legge e si scrive solo
-- dalle Netlify Functions con la service role.
--
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.emtn_posizioni (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           uuid NOT NULL REFERENCES public.emtn_clients(id) ON DELETE CASCADE,
    stato               text NOT NULL DEFAULT 'DA_VERIFICARE',
    titolo              text NOT NULL DEFAULT '',
    report              text NOT NULL DEFAULT '',
    -- [{ codice, stato, dati: {...}, fonti: [...] }] — vedi src/utils/emtnMobilityRisk.ts
    eventi              jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- Qualificazioni di natura legale/penale: MAI mostrate alla rete.
    informazioni_legali jsonb NOT NULL DEFAULT '[]'::jsonb,
    revisione_legale    boolean NOT NULL DEFAULT false,
    email_cliente       text,
    -- inviata = in attesa di approvazione DR7; pubblicata = nella lista EMTN.
    in_approvazione     boolean NOT NULL DEFAULT false,
    pubblicata          boolean NOT NULL DEFAULT false,
    inviata_at          timestamptz,
    inviata_da          text,
    approvata_at        timestamptz,
    approvata_da        text,
    nota_revisione      text,
    created_by          uuid,
    created_by_email    text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT emtn_posizioni_stato_check CHECK (stato IN (
        'DA_VERIFICARE', 'VERIFICATO', 'CONTESTATO', 'IN_DEFINIZIONE',
        'PARZIALMENTE_REGOLARIZZATO', 'REGOLARIZZATO', 'CHIUSO', 'ANNULLATO'
    ))
);
CREATE INDEX IF NOT EXISTS emtn_posizioni_client_idx ON public.emtn_posizioni (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS emtn_posizioni_approvazione_idx ON public.emtn_posizioni (in_approvazione) WHERE in_approvazione;

CREATE TABLE IF NOT EXISTS public.emtn_analisi (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           uuid NOT NULL REFERENCES public.emtn_clients(id) ON DELETE CASCADE,
    -- valorizzato quando l'analisi aggiorna una posizione esistente
    posizione_id        uuid REFERENCES public.emtn_posizioni(id) ON DELETE SET NULL,
    stato               text NOT NULL DEFAULT 'caricamento',
    -- [{ path, nome, mime, size }] nello storage privato emtn-documents
    documenti           jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- risultato AI grezzo (per l'audit) e normalizzato
    risultato_ai        jsonb,
    risultato           jsonb,
    avvisi              jsonb NOT NULL DEFAULT '[]'::jsonb,
    modello             text,
    errore              text,
    created_by          uuid,
    created_by_email    text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    completed_at        timestamptz,
    CONSTRAINT emtn_analisi_stato_check CHECK (stato IN ('caricamento', 'in_corso', 'pronta', 'errore', 'inviata'))
);
CREATE INDEX IF NOT EXISTS emtn_analisi_client_idx ON public.emtn_analisi (client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.emtn_posizioni_storico (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    posizione_id        uuid NOT NULL REFERENCES public.emtn_posizioni(id) ON DELETE CASCADE,
    analisi_id          uuid REFERENCES public.emtn_analisi(id) ON DELETE SET NULL,
    -- inviata | aggiornata | approvata | rifiutata | email_cliente | email_non_inviata
    azione              text NOT NULL,
    stato_prima         text,
    stato_dopo          text,
    snapshot            jsonb,
    nota                text,
    operatore_id        uuid,
    operatore_email     text,
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS emtn_posizioni_storico_idx ON public.emtn_posizioni_storico (posizione_id, created_at);

ALTER TABLE public.emtn_posizioni ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emtn_analisi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emtn_posizioni_storico ENABLE ROW LEVEL SECURITY;

-- Messaggi di Sistema Pro: email al cliente all'invio, WhatsApp a DR7 per
-- l'approvazione. Testi modificabili dalla direzione; non si sovrascrive
-- una versione gia' modificata.
INSERT INTO public.system_messages (message_key, label, description, message_body, is_enabled, send_email, email_subject, is_automatic)
SELECT 'pro_emtn_segnalazione_cliente',
       'EMTN: Segnalazione al cliente (email)',
       'Email inviata al cliente quando un operatore invia una segnalazione EMTN. Variabili: {nome} {titolo} {report} {stato} {data}',
       E'Gentile {nome},\n\nla informiamo che, sulla base della documentazione relativa al Suo noleggio, DR7 ha registrato la seguente posizione:\n\n{titolo}\n\n{report}\n\nStato: {stato}\n\nLa posizione e'' in revisione e non e'' visibile ad altri operatori fino all''approvazione. Per osservazioni o documenti puo'' rispondere a questa email.\n\nDR7',
       true, true, 'Comunicazione relativa al Suo noleggio DR7', false
WHERE NOT EXISTS (SELECT 1 FROM public.system_messages WHERE message_key = 'pro_emtn_segnalazione_cliente');

INSERT INTO public.system_messages (message_key, label, description, message_body, is_enabled, send_email, is_automatic)
SELECT 'pro_emtn_segnalazione_approvazione',
       'EMTN: Segnalazione da approvare (admin)',
       'WhatsApp al numero admin quando una segnalazione EMTN attende approvazione. Variabili: {nome} {titolo} {stato} {operatore} {email_cliente}',
       E'*EMTN - SEGNALAZIONE DA APPROVARE*\n\n*Cliente:* {nome}\n*Posizione:* {titolo}\n*Stato:* {stato}\n*Inviata da:* {operatore}\n*Email cliente:* {email_cliente}\n\nApprova o rifiuta da EMTN > Da approvare.',
       true, false, false
WHERE NOT EXISTS (SELECT 1 FROM public.system_messages WHERE message_key = 'pro_emtn_segnalazione_approvazione');

-- ── Workflow definitivo (seconda specifica, 28/09/2026) ─────────
-- Stati IN_REVISIONE e RETTIFICATO, esito del motore di coerenza, controlli
-- incrociati con il gestionale, motivi di revisione manuale obbligatoria,
-- dati della pratica e decisione finale EMTN.
ALTER TABLE public.emtn_posizioni DROP CONSTRAINT IF EXISTS emtn_posizioni_stato_check;
ALTER TABLE public.emtn_posizioni ADD CONSTRAINT emtn_posizioni_stato_check CHECK (stato IN (
    'DA_VERIFICARE', 'VERIFICATO', 'CONTESTATO', 'IN_DEFINIZIONE', 'IN_REVISIONE',
    'PARZIALMENTE_REGOLARIZZATO', 'REGOLARIZZATO', 'RETTIFICATO', 'CHIUSO', 'ANNULLATO'
));
ALTER TABLE public.emtn_posizioni
    ADD COLUMN IF NOT EXISTS booking_id uuid,
    ADD COLUMN IF NOT EXISTS pratica jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS documenti jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS incongruenze jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS esito_verifica text,
    ADD COLUMN IF NOT EXISTS controlli_gestionale jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS motivi_revisione jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS decisione text,
    ADD COLUMN IF NOT EXISTS decisione_at timestamptz,
    ADD COLUMN IF NOT EXISTS decisione_da text;
ALTER TABLE public.emtn_analisi
    ADD COLUMN IF NOT EXISTS controlli_gestionale jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS booking_id uuid;

-- Versione pubblicata: quello che la rete vede di una posizione approvata.
-- Una posizione riaperta (nuovi documenti, risposta del cliente) resta
-- mostrata con l'ultima versione approvata finche' la direzione non decide.
ALTER TABLE public.emtn_posizioni ADD COLUMN IF NOT EXISTS pubblicato jsonb;
ALTER TABLE public.emtn_posizioni ADD COLUMN IF NOT EXISTS pubblicata_at timestamptz;

-- Email al cliente con i contenuti richiesti dal workflow (fase 8): EMTN,
-- operatore segnalante, contratto, veicolo, evento, importo, stato, diritti di
-- accesso/rettifica/osservazioni, riferimenti privacy.
UPDATE public.system_messages
SET description = 'Email al cliente quando una segnalazione EMTN viene inviata in approvazione (workflow EMTN, fase 8). Variabili: {nome} {operatore_segnalante} {numero_contratto} {veicolo} {targa} {data_evento} {tipologia} {descrizione} {importo} {stato} {email_contatto}',
    message_body = E'Gentile {nome},\n\nLe scriviamo per conto di EMTN – European Mobility Trust Network.\n\nL''operatore {operatore_segnalante} ha presentato una segnalazione relativa al rapporto di noleggio indicato di seguito:\n\nContratto/pratica: {numero_contratto}\nVeicolo: {veicolo} {targa}\nData dell''evento: {data_evento}\nTipologia: {tipologia}\nImporto: {importo}\nStato della posizione: {stato}\n\nDescrizione:\n{descrizione}\n\nLa segnalazione e'' in verifica e NON e'' visibile ad altri operatori della rete fino alla conclusione della validazione EMTN.\n\nPuo'' in qualsiasi momento:\n- chiedere l''accesso alle informazioni che La riguardano;\n- chiedere la rettifica di informazioni inesatte;\n- presentare osservazioni, contestazioni o documenti (ad esempio ricevute di pagamento o accordi).\n\nPer esercitare questi diritti risponda a questa email o scriva a {email_contatto}, indicando il numero di contratto. Il trattamento avviene ai sensi del Regolamento (UE) 2016/679 (GDPR) per la finalita'' di tutela del credito e prevenzione dei rischi nel noleggio; l''informativa privacy completa Le verra'' fornita su richiesta.\n\nEMTN – European Mobility Trust Network',
    updated_at = now()
WHERE message_key = 'pro_emtn_segnalazione_cliente'
  AND message_body LIKE 'Gentile {nome},%la informiamo che%';
