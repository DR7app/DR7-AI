-- ─────────────────────────────────────────────────────────────────────────
-- TIMESHEET OPERATORI — registro ore lavorate, pause e uscita per operatore.
-- Login operatore via Supabase Auth (email + password); admin cree gli account.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Anagrafica operatori
CREATE TABLE IF NOT EXISTS public.operatori_persone (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE,                          -- FK auth.users — login
    nome TEXT NOT NULL,
    cognome TEXT,
    email TEXT UNIQUE NOT NULL,
    ruolo TEXT,                                    -- "Receptionist", "Operativo", ecc.
    ore_target_giornaliere NUMERIC(4,2) NOT NULL DEFAULT 8.00,
    attivo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operatori_persone_user_id ON public.operatori_persone(user_id);
CREATE INDEX IF NOT EXISTS idx_operatori_persone_email ON public.operatori_persone(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_operatori_persone_attivo ON public.operatori_persone(attivo) WHERE attivo = TRUE;

-- 2. Timestamp eventi (clock-in / break / clock-out)
-- Multi-break: ogni "pausa_inizio" deve avere un "pausa_fine" successivo nello
-- stesso giorno. "entrata" e "uscita" possono apparire una sola volta al giorno.
CREATE TABLE IF NOT EXISTS public.timesheet_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operatore_id UUID NOT NULL REFERENCES public.operatori_persone(id) ON DELETE CASCADE,
    -- Data del giorno (Europe/Rome) — generated dal timestamp
    data DATE GENERATED ALWAYS AS ((timestamp AT TIME ZONE 'Europe/Rome')::date) STORED,
    tipo TEXT NOT NULL CHECK (tipo IN ('entrata', 'pausa_inizio', 'pausa_fine', 'uscita')),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_timesheet_operatore_data ON public.timesheet_entries(operatore_id, data);
CREATE INDEX IF NOT EXISTS idx_timesheet_data ON public.timesheet_entries(data);

-- 3. Note libere per giorno (separato dagli eventi — l'operatore puo' annotare
-- qualcosa che riguarda l'intera giornata, non un evento specifico)
CREATE TABLE IF NOT EXISTS public.timesheet_day_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operatore_id UUID NOT NULL REFERENCES public.operatori_persone(id) ON DELETE CASCADE,
    data DATE NOT NULL,
    nota TEXT NOT NULL,
    stato TEXT,                                       -- 'lavoro', 'smart_working', 'reperibilita', 'ferie', 'malattia', 'permesso'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(operatore_id, data)
);

-- 4. Updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_operatori_persone_updated_at ON public.operatori_persone;
CREATE TRIGGER trg_operatori_persone_updated_at
    BEFORE UPDATE ON public.operatori_persone
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_timesheet_day_notes_updated_at ON public.timesheet_day_notes;
CREATE TRIGGER trg_timesheet_day_notes_updated_at
    BEFORE UPDATE ON public.timesheet_day_notes
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 5. Funzione: stato corrente di un operatore in base agli eventi del giorno
-- Restituisce 'fuori' (mai entrato o gia' uscito), 'lavoro' (in turno), 'pausa'.
CREATE OR REPLACE FUNCTION public.operatore_stato_corrente(p_operatore_id UUID, p_data DATE)
RETURNS TEXT AS $$
DECLARE
    last_event TEXT;
BEGIN
    SELECT tipo INTO last_event
    FROM public.timesheet_entries
    WHERE operatore_id = p_operatore_id AND data = p_data
    ORDER BY timestamp DESC
    LIMIT 1;

    IF last_event IS NULL THEN RETURN 'fuori'; END IF;
    IF last_event = 'entrata' OR last_event = 'pausa_fine' THEN RETURN 'lavoro'; END IF;
    IF last_event = 'pausa_inizio' THEN RETURN 'pausa'; END IF;
    RETURN 'fuori';
END;
$$ LANGUAGE plpgsql STABLE;

-- 6. Funzione: minuti lavorati in un giorno (entrata→uscita meno pause)
CREATE OR REPLACE FUNCTION public.operatore_minuti_lavorati(p_operatore_id UUID, p_data DATE)
RETURNS INTEGER AS $$
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

    -- Pause: somma intervalli pausa_inizio→pausa_fine accoppiati nell'ordine
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
            pausa_fine_ts := rec.timestamp;
            pausa_minuti := pausa_minuti + EXTRACT(EPOCH FROM (pausa_fine_ts - pausa_inizio_ts))::INTEGER / 60;
            pausa_inizio_ts := NULL;
        END IF;
    END LOOP;

    -- Pausa aperta (mancante uscita): chiudi a NOW se siamo nel giorno corrente
    IF pausa_inizio_ts IS NOT NULL AND p_data = (NOW() AT TIME ZONE 'Europe/Rome')::date THEN
        pausa_minuti := pausa_minuti + EXTRACT(EPOCH FROM (NOW() - pausa_inizio_ts))::INTEGER / 60;
    END IF;

    -- Uscita: se mancante e siamo oggi, considera NOW
    IF uscita_ts IS NULL THEN
        IF p_data = (NOW() AT TIME ZONE 'Europe/Rome')::date THEN
            uscita_ts := NOW();
        ELSE
            -- Giorno passato senza uscita: ignoriamo, restituiamo 0
            RETURN 0;
        END IF;
    END IF;

    minuti := EXTRACT(EPOCH FROM (uscita_ts - entrata_ts))::INTEGER / 60 - pausa_minuti;
    RETURN GREATEST(0, minuti);
END;
$$ LANGUAGE plpgsql STABLE;

-- 7. RLS — operatore vede solo i propri eventi; admin vede tutto.
ALTER TABLE public.operatori_persone ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheet_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheet_day_notes ENABLE ROW LEVEL SECURITY;

-- Operatore vede il proprio record
DROP POLICY IF EXISTS "operatori_persone self read" ON public.operatori_persone;
CREATE POLICY "operatori_persone self read" ON public.operatori_persone
    FOR SELECT TO authenticated
    USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.admins WHERE admins.user_id = auth.uid()));

-- Admin scrive
DROP POLICY IF EXISTS "operatori_persone admin write" ON public.operatori_persone;
CREATE POLICY "operatori_persone admin write" ON public.operatori_persone
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.admins WHERE admins.user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.admins WHERE admins.user_id = auth.uid()));

-- Operatore inserisce solo i propri eventi
DROP POLICY IF EXISTS "timesheet_entries self insert" ON public.timesheet_entries;
CREATE POLICY "timesheet_entries self insert" ON public.timesheet_entries
    FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.operatori_persone
        WHERE id = operatore_id AND user_id = auth.uid()
    ));

-- Operatore vede solo i propri eventi (admin tutti)
DROP POLICY IF EXISTS "timesheet_entries self read" ON public.timesheet_entries;
CREATE POLICY "timesheet_entries self read" ON public.timesheet_entries
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.operatori_persone
            WHERE id = operatore_id AND user_id = auth.uid()
        )
        OR EXISTS (SELECT 1 FROM public.admins WHERE admins.user_id = auth.uid())
    );

-- Admin puo' editare/cancellare gli eventi (correzioni)
DROP POLICY IF EXISTS "timesheet_entries admin write" ON public.timesheet_entries;
CREATE POLICY "timesheet_entries admin write" ON public.timesheet_entries
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.admins WHERE admins.user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.admins WHERE admins.user_id = auth.uid()));

-- Note giornaliere: stesso pattern
DROP POLICY IF EXISTS "timesheet_day_notes self all" ON public.timesheet_day_notes;
CREATE POLICY "timesheet_day_notes self all" ON public.timesheet_day_notes
    FOR ALL TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.operatori_persone WHERE id = operatore_id AND user_id = auth.uid())
        OR EXISTS (SELECT 1 FROM public.admins WHERE admins.user_id = auth.uid())
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.operatori_persone WHERE id = operatore_id AND user_id = auth.uid())
        OR EXISTS (SELECT 1 FROM public.admins WHERE admins.user_id = auth.uid())
    );
