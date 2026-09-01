-- ============================================================================
-- Fattura Amministrazione: le fatture in doppio
-- ============================================================================
--
-- COSA SUCCEDEVA
-- La tabella `fatture` tiene insieme quattro documenti diversi agganciati allo
-- stesso `booking_id`: la fattura principale, le fatture di estensione, le
-- penali/danni e le note di credito. `generate-invoice-from-booking` cercava
-- "la fattura di questa prenotazione" con `.single()`, che PostgREST considera
-- fallito sia con zero righe sia con piu' di una; l'errore veniva scartato.
-- Bastava quindi una penale sulla stessa prenotazione perche' il codice
-- concludesse "nessuna fattura esiste" e ne creasse un'altra. Ogni chiamata
-- successiva (callback Nexi ripetuto, cron di riconciliazione, "segna pagato"
-- premuto di nuovo) ne aggiungeva una: i doppioni si moltiplicavano da soli.
--
-- Le fatture di ESTENSIONE avevano un secondo problema: nascono sempre nuove,
-- senza nulla che le identifichi, quindi ogni ripetizione del callback Nexi ne
-- emetteva una gemella.
--
-- COSA FA QUESTA MIGRAZIONE
--  1. `fattura_dedup_key` + indice unico: l'identita' dell'operazione che ha
--     generato la fattura (l'ordine Nexi, l'indice dell'estensione).
--  2. Rimette il tipo alle penali e ai danni gia' in archivio, che erano
--     indistinguibili da una fattura principale.
--  3. Elimina i doppioni SENZA VALORE FISCALE (bozze mai partite verso SDI).
--     Le fatture gia' trasmesse non si toccano MAI: si annullano con una nota
--     di credito, e la migrazione le elenca invece di cancellarle.
--  4. Indice unico sulla fattura principale di ogni prenotazione, come rete di
--     sicurezza contro le chiamate in parallelo.
-- ============================================================================

-- ─── 1. Colonne ─────────────────────────────────────────────────────────────

-- `extension_index` esiste solo in add_extension_index_to_fatture.sql, fuori da
-- questa cartella: su un database dove quel file non e' mai stato lanciato la
-- colonna manca. Le query che la filtrano fallirebbero, e con loro l'emissione
-- delle fatture.
ALTER TABLE public.fatture
    ADD COLUMN IF NOT EXISTS extension_index integer;

ALTER TABLE public.fatture
    ADD COLUMN IF NOT EXISTS fattura_dedup_key text;

COMMENT ON COLUMN public.fatture.fattura_dedup_key IS
    'Identita'' dell''operazione che ha emesso la fattura (es. nexi:<order_id>, estensione:<bookingId>:<indice>). Unica: impedisce che un callback ripetuto emetta una seconda fattura per lo stesso pagamento.';

CREATE UNIQUE INDEX IF NOT EXISTS ux_fatture_dedup_key
    ON public.fatture (fattura_dedup_key)
    WHERE fattura_dedup_key IS NOT NULL;

-- ─── 2. Il tipo torna alle penali e ai danni ────────────────────────────────
-- Riconoscibili dalle righe: generate-penalty-invoice scrive descrizioni
-- "Penale - <nome>" e "Danno - <nome>". Si toccano SOLO le righe che hanno
-- ancora il tipo generico: una fattura gia' tipizzata resta com'e'.

DO $$
DECLARE
    n_penali integer;
    n_danni  integer;
BEGIN
    WITH marcate AS (
        UPDATE public.fatture f
        SET tipo_fattura = 'penale'
        WHERE (f.tipo_fattura IS NULL OR f.tipo_fattura = 'standard')
          AND jsonb_typeof(f.items::jsonb) = 'array'
          AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(f.items::jsonb) AS voce
              WHERE voce->>'description' ILIKE 'Penale%'
          )
        RETURNING 1
    )
    SELECT count(*) INTO n_penali FROM marcate;

    WITH marcate AS (
        UPDATE public.fatture f
        SET tipo_fattura = 'danno'
        WHERE (f.tipo_fattura IS NULL OR f.tipo_fattura = 'standard')
          AND jsonb_typeof(f.items::jsonb) = 'array'
          AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(f.items::jsonb) AS voce
              WHERE voce->>'description' ILIKE 'Danno%'
          )
        RETURNING 1
    )
    SELECT count(*) INTO n_danni FROM marcate;

    RAISE NOTICE 'Tipo ripristinato: % penali, % danni', n_penali, n_danni;
END $$;

-- ─── 2 bis. Il tipo torna alle fatture di estensione ────────────────────────
-- Nessuno ha mai scritto `fatture.extension_index`: le fatture di estensione
-- erano indistinguibili da una fattura principale, ed e' meta' del motivo per
-- cui una prenotazione ne risultava avere due. Si riconoscono dalle righe, che
-- generate-invoice-from-booking scrive come "Estensione noleggio <auto>".
--
-- Si richiede che TUTTE le righe siano di estensione: la fattura principale che
-- itemizza anche le estensioni (flusso `includeExtensions`) ha almeno una riga
-- di noleggio e deve restare principale.

DO $$
DECLARE
    n integer;
BEGIN
    WITH marcate AS (
        UPDATE public.fatture f
        SET tipo_fattura = 'estensione'
        WHERE (f.tipo_fattura IS NULL OR f.tipo_fattura = 'standard')
          AND f.extension_index IS NULL
          AND jsonb_typeof(f.items::jsonb) = 'array'
          AND jsonb_array_length(f.items::jsonb) > 0
          AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(f.items::jsonb) AS voce
              WHERE coalesce(voce->>'description', '') NOT ILIKE 'Estensione%'
          )
        RETURNING 1
    )
    SELECT count(*) INTO n FROM marcate;
    RAISE NOTICE 'Tipo ripristinato: % fatture di estensione', n;
END $$;

-- ─── 3. Che cos'e' un doppione ──────────────────────────────────────────────
-- Vista di diagnosi: una riga per ogni fattura principale in eccesso su una
-- prenotazione. Resta a disposizione della direzione anche dopo la pulizia.

CREATE OR REPLACE VIEW public.v_fatture_doppie AS
WITH principali AS (
    SELECT
        f.id,
        f.booking_id,
        f.numero_fattura,
        f.data_emissione,
        f.importo_totale,
        f.customer_name,
        f.sdi_status,
        f.aruba_invoice_id,
        f.created_at,
        -- coalesce OBBLIGATORIO: con `sdi_status` nullo — il caso di una bozza
        -- appena creata — `sdi_status IN (...)` vale NULL, non false. E in
        -- `ORDER BY ... DESC` i NULL vengono PRIMA: senza questo coalesce la
        -- bozza piu' recente scavalcava la fattura davvero trasmessa e si
        -- prendeva il posto di riga da tenere, mentre quella con valore fiscale
        -- finiva tra i doppioni.
        coalesce(
            f.aruba_invoice_id IS NOT NULL
                OR f.sdi_status IN ('sending', 'sent', 'delivered', 'accepted'),
            false
        ) AS uscita_sdi
    FROM public.fatture f
    WHERE f.booking_id IS NOT NULL
      AND f.extension_index IS NULL
      AND coalesce(lower(f.tipo_fattura), 'standard')
          NOT IN ('nota_di_credito', 'nota_credito', 'td04', 'penale', 'danno', 'penali', 'danni', 'estensione')
      AND coalesce(lower(f.stato), '') <> 'cancelled'
), ordinate AS (
    SELECT
        p.*,
        -- La riga da tenere: prima quella gia' uscita verso SDI (ha valore
        -- fiscale), poi la piu' vecchia.
        row_number() OVER (
            PARTITION BY p.booking_id
            ORDER BY p.uscita_sdi DESC, p.created_at ASC NULLS LAST, p.id ASC
        ) AS posizione,
        count(*) OVER (PARTITION BY p.booking_id) AS quante
    FROM principali p
)
SELECT
    o.id,
    o.booking_id,
    o.numero_fattura,
    o.data_emissione,
    o.importo_totale,
    o.customer_name,
    o.sdi_status,
    o.uscita_sdi,
    o.created_at,
    o.quante AS fatture_sulla_prenotazione
FROM ordinate o
WHERE o.quante > 1
  AND o.posizione > 1;

COMMENT ON VIEW public.v_fatture_doppie IS
    'Fatture principali in eccesso: una riga per ogni doppione (la riga da tenere non compare). uscita_sdi = true significa che va annullata con una nota di credito, non eliminata.';

-- ─── 4. Pulizia dei doppioni senza valore fiscale ───────────────────────────
-- Si eliminano SOLO le bozze mai trasmesse (nessun id Aruba, stato SDI nullo o
-- 'draft'/'error'), e solo dove esiste gia' una riga da tenere. Tutto il resto
-- viene elencato e lasciato dov'e'.

DO $$
DECLARE
    da_eliminare integer;
    eliminate    integer;
    fiscali      integer;
    r            record;
BEGIN
    SELECT count(*) INTO da_eliminare
    FROM public.v_fatture_doppie d
    WHERE NOT d.uscita_sdi
      AND coalesce(d.sdi_status, 'draft') IN ('draft', 'error');

    SELECT count(*) INTO fiscali
    FROM public.v_fatture_doppie d
    WHERE d.uscita_sdi
       OR coalesce(d.sdi_status, 'draft') NOT IN ('draft', 'error');

    RAISE NOTICE 'Doppioni trovati: % bozze eliminabili, % gia'' verso SDI (da annullare con nota di credito)',
        da_eliminare, fiscali;

    WITH tolte AS (
        DELETE FROM public.fatture f
        USING public.v_fatture_doppie d
        WHERE f.id = d.id
          AND NOT d.uscita_sdi
          AND coalesce(d.sdi_status, 'draft') IN ('draft', 'error')
        RETURNING 1
    )
    SELECT count(*) INTO eliminate FROM tolte;

    RAISE NOTICE 'Doppioni eliminati: %', eliminate;

    FOR r IN SELECT * FROM public.v_fatture_doppie LOOP
        RAISE NOTICE 'RESTA DA SISTEMARE A MANO: % (prenotazione %, cliente %, % EUR, SDI %)',
            r.numero_fattura, r.booking_id, r.customer_name, r.importo_totale, coalesce(r.sdi_status, 'draft');
    END LOOP;
END $$;

-- ─── 5. Rete di sicurezza: una sola fattura principale per prenotazione ─────
-- Il codice non ne crea piu' una seconda; l'indice copre le chiamate che
-- arrivano nello stesso istante (callback Nexi + "segna pagato" + cron).
-- Se restano doppioni fiscali da annullare a mano l'indice non nasce: la
-- migrazione lo dice e va rilanciata dopo le note di credito.

DO $$
BEGIN
    BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS ux_fatture_principale_per_prenotazione
            ON public.fatture (booking_id)
            WHERE booking_id IS NOT NULL
              AND extension_index IS NULL
              AND coalesce(lower(tipo_fattura), 'standard')
                  NOT IN ('nota_di_credito', 'nota_credito', 'td04', 'penale', 'danno', 'penali', 'danni', 'estensione')
              AND coalesce(lower(stato), '') <> 'cancelled';
        RAISE NOTICE 'Indice unico sulla fattura principale: creato.';
    EXCEPTION WHEN unique_violation THEN
        RAISE WARNING 'Indice unico NON creato: restano doppioni da sistemare. Elenco in public.v_fatture_doppie — emetti la nota di credito e rilancia questa migrazione.';
    END;
END $$;

NOTIFY pgrst, 'reload schema';
