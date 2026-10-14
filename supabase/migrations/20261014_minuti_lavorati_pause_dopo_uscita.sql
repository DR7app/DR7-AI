-- 2026-10-14: le pause timbrate dopo l'uscita non si scalano piu'.
-- L'editor "I miei orari" pre-inserisce tutte le fasce del contratto: uscito
-- alle 18:00, le pause 18:30 e 19:30 venivano tolte dalle ore lavorate.
-- Ogni pausa ora conta solo per la parte che cade prima dell'uscita.
CREATE OR REPLACE FUNCTION public.operatore_minuti_lavorati(p_operatore_id uuid, p_data date)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
    minuti INTEGER := 0;
    entrata_ts TIMESTAMPTZ;
    uscita_ts TIMESTAMPTZ;
    pausa_minuti INTEGER := 0;
    pausa_inizio_ts TIMESTAMPTZ;
    pausa_fine_ts TIMESTAMPTZ;
    rec RECORD;
BEGIN
    SELECT timestamp INTO entrata_ts FROM public.timesheet_entries
    WHERE operatore_id = p_operatore_id AND data = p_data AND tipo = 'entrata'
    ORDER BY timestamp ASC LIMIT 1;

    SELECT timestamp INTO uscita_ts FROM public.timesheet_entries
    WHERE operatore_id = p_operatore_id AND data = p_data AND tipo = 'uscita'
    ORDER BY timestamp DESC LIMIT 1;

    IF entrata_ts IS NULL THEN RETURN 0; END IF;

    -- Uscita: se mancante e siamo oggi, considera NOW
    IF uscita_ts IS NULL THEN
        IF p_data = (NOW() AT TIME ZONE 'Europe/Rome')::date THEN
            uscita_ts := NOW();
        ELSE
            -- Giorno passato senza uscita: ignoriamo, restituiamo 0
            RETURN 0;
        END IF;
    END IF;

    -- Pause: somma intervalli pausa_inizio→pausa_fine accoppiati nell'ordine,
    -- tagliati all'uscita.
    pausa_inizio_ts := NULL;
    FOR rec IN (
        SELECT tipo, timestamp
        FROM public.timesheet_entries
        WHERE operatore_id = p_operatore_id AND data = p_data AND tipo IN ('pausa_inizio', 'pausa_fine')
        ORDER BY timestamp ASC
    ) LOOP
        IF rec.tipo = 'pausa_inizio' AND pausa_inizio_ts IS NULL THEN
            pausa_inizio_ts := rec.timestamp;
        ELSIF rec.tipo = 'pausa_fine' AND pausa_inizio_ts IS NOT NULL THEN
            pausa_fine_ts := LEAST(rec.timestamp, uscita_ts);
            IF pausa_fine_ts > pausa_inizio_ts THEN
                pausa_minuti := pausa_minuti + EXTRACT(EPOCH FROM (pausa_fine_ts - pausa_inizio_ts))::INTEGER / 60;
            END IF;
            pausa_inizio_ts := NULL;
        END IF;
    END LOOP;

    -- Pausa aperta (mancante uscita): chiudi a NOW se siamo nel giorno corrente
    IF pausa_inizio_ts IS NOT NULL AND p_data = (NOW() AT TIME ZONE 'Europe/Rome')::date AND uscita_ts > pausa_inizio_ts THEN
        pausa_minuti := pausa_minuti + EXTRACT(EPOCH FROM (uscita_ts - pausa_inizio_ts))::INTEGER / 60;
    END IF;

    minuti := EXTRACT(EPOCH FROM (uscita_ts - entrata_ts))::INTEGER / 60 - pausa_minuti;
    RETURN GREATEST(0, minuti);
END;
$function$;
