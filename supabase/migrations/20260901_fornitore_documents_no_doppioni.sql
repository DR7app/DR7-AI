-- Fatture fornitore in doppio (segnalato su Hydrochem, 01/09/2026).
--
-- L'indice unico esistente copre (fornitore_id, tipo, numero_documento,
-- data_documento). Non bastava per due motivi:
--   1. la stessa fattura Aruba poteva entrare due volte con il numero scritto
--      in modo diverso ("1/26" letto dal JSON, "0001/26" letto dall'XML);
--   2. due anagrafiche dello stesso fornitore (una a mano, una creata dal
--      sync perche' la P.IVA mancava) si prendevano entrambe le stesse fatture.
--
-- L'identita' vera di una fattura scaricata da Aruba e' il suo filename.
-- Qui: si ricollegano le bolle alla copia buona, si eliminano SOLO le copie
-- in piu' che non hanno pagamento registrato, poi si mette l'indice unico.
-- Le copie con un pagamento registrato non vengono toccate: vanno guardate a
-- mano (il pulsante "Elimina i doppioni" nella scheda fornitore le mostra).

DO $$
DECLARE
    v_riassegnate INT := 0;
    v_eliminate   INT := 0;
    v_restanti    INT := 0;
BEGIN
    -- Copia da tenere per ogni filename: prima quella pagata, poi quella con
    -- il file gia' in archivio, poi la piu' vecchia.
    CREATE TEMP TABLE tmp_doppioni ON COMMIT DROP AS
    WITH classificate AS (
        SELECT
            id,
            aruba_filename,
            stato,
            data_pagamento,
            ROW_NUMBER() OVER (
                PARTITION BY aruba_filename
                ORDER BY
                    (stato = 'pagato') DESC,
                    (data_pagamento IS NOT NULL) DESC,
                    (file_url IS NOT NULL) DESC,
                    created_at ASC,
                    id ASC
            ) AS posizione,
            FIRST_VALUE(id) OVER (
                PARTITION BY aruba_filename
                ORDER BY
                    (stato = 'pagato') DESC,
                    (data_pagamento IS NOT NULL) DESC,
                    (file_url IS NOT NULL) DESC,
                    created_at ASC,
                    id ASC
            ) AS id_da_tenere
        FROM public.fornitore_documents
        WHERE aruba_filename IS NOT NULL
    )
    SELECT id, id_da_tenere, stato, data_pagamento
    FROM classificate
    WHERE posizione > 1;

    -- Le bolle agganciate a una copia in piu' passano alla copia buona.
    UPDATE public.fornitore_documents d
    SET fattura_collegata_id = t.id_da_tenere
    FROM tmp_doppioni t
    WHERE d.fattura_collegata_id = t.id;
    GET DIAGNOSTICS v_riassegnate = ROW_COUNT;

    DELETE FROM public.fornitore_documents d
    USING tmp_doppioni t
    WHERE d.id = t.id
      AND t.stato <> 'pagato'
      AND t.data_pagamento IS NULL;
    GET DIAGNOSTICS v_eliminate = ROW_COUNT;

    SELECT count(*) INTO v_restanti FROM tmp_doppioni t
    WHERE t.stato = 'pagato' OR t.data_pagamento IS NOT NULL;

    RAISE NOTICE 'Doppioni fatture fornitore: % bolle riagganciate, % righe eliminate, % lasciate perche hanno un pagamento registrato',
        v_riassegnate, v_eliminate, v_restanti;

    -- L'indice si mette solo se non restano doppioni, altrimenti fallirebbe
    -- e farebbe saltare tutta la migrazione.
    IF v_restanti = 0 THEN
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_fornitore_doc_aruba_filename
            ON public.fornitore_documents(aruba_filename)
            WHERE aruba_filename IS NOT NULL;
    ELSE
        RAISE NOTICE 'Indice unico su aruba_filename non creato: prima vanno sistemate a mano le % copie con pagamento.', v_restanti;
    END IF;
END $$;
