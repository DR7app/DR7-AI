-- ============================================
-- CAUZIONI (Security Deposits) MANAGEMENT SYSTEM
-- ============================================
-- Migration to create security deposits tracking with automatic deadline calculation
-- and Italian holiday support for business day calculations

-- ============================================
-- 1. HOLIDAYS TABLE (Italian Public Holidays)
-- ============================================

CREATE TABLE IF NOT EXISTS holidays_it (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    holiday_date DATE NOT NULL UNIQUE,
    holiday_name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for fast date lookups
CREATE INDEX IF NOT EXISTS idx_holidays_it_date ON holidays_it(holiday_date);

-- Pre-populate with common Italian holidays for 2026-2027
INSERT INTO holidays_it (holiday_date, holiday_name) VALUES
-- 2026
('2026-01-01', 'Capodanno'),
('2026-01-06', 'Epifania'),
('2026-04-05', 'Pasqua'),
('2026-04-06', 'Lunedì dell''Angelo'),
('2026-04-25', 'Festa della Liberazione'),
('2026-05-01', 'Festa del Lavoro'),
('2026-06-02', 'Festa della Repubblica'),
('2026-08-15', 'Ferragosto'),
('2026-11-01', 'Ognissanti'),
('2026-12-08', 'Immacolata Concezione'),
('2026-12-25', 'Natale'),
('2026-12-26', 'Santo Stefano'),
-- 2027
('2027-01-01', 'Capodanno'),
('2027-01-06', 'Epifania'),
('2027-03-28', 'Pasqua'),
('2027-03-29', 'Lunedì dell''Angelo'),
('2027-04-25', 'Festa della Liberazione'),
('2027-05-01', 'Festa del Lavoro'),
('2027-06-02', 'Festa della Repubblica'),
('2027-08-15', 'Ferragosto'),
('2027-11-01', 'Ognissanti'),
('2027-12-08', 'Immacolata Concezione'),
('2027-12-25', 'Natale'),
('2027-12-26', 'Santo Stefano')
ON CONFLICT (holiday_date) DO NOTHING;

-- ============================================
-- 2. BUSINESS DAY CALCULATION FUNCTION
-- ============================================

CREATE OR REPLACE FUNCTION calculate_business_days_excluding_holidays(
    start_date DATE,
    days_to_add INTEGER
) RETURNS DATE AS $$
DECLARE
    check_date DATE;
    business_days_counted INTEGER := 0;
    day_of_week INTEGER;
    is_holiday BOOLEAN;
BEGIN
    -- Start from the return date itself
    check_date := start_date;
    
    WHILE business_days_counted < days_to_add LOOP
        -- Get day of week (0=Sunday, 6=Saturday)
        day_of_week := EXTRACT(DOW FROM check_date);
        
        -- Check if check_date is a holiday
        SELECT EXISTS(
            SELECT 1 FROM holidays_it WHERE holiday_date = check_date
        ) INTO is_holiday;
        
        -- Count as business day if not weekend and not holiday
        IF day_of_week NOT IN (0, 6) AND NOT is_holiday THEN
            business_days_counted := business_days_counted + 1;
        END IF;
        
        -- Move to next day if we haven't reached the target
        IF business_days_counted < days_to_add THEN
            check_date := check_date + INTERVAL '1 day';
        END IF;
    END LOOP;
    
    RETURN check_date;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================
-- 3. CAUZIONI TABLE (Security Deposits)
-- ============================================

CREATE TABLE IF NOT EXISTS cauzioni (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Foreign Keys
    cliente_id UUID NOT NULL,
    veicolo_id UUID NOT NULL,
    riferimento_contratto_id UUID, -- Optional FK to bookings
    
    -- Core Fields
    data_restituzione_veicolo DATE NOT NULL,
    scadenza_cauzione DATE NOT NULL, -- Auto-calculated: 14 business days after return
    importo NUMERIC(10, 2) NOT NULL CHECK (importo > 0),
    metodo TEXT NOT NULL CHECK (metodo IN ('bonifico', 'carta', 'preautorizzazione')),
    stato TEXT NOT NULL DEFAULT 'Attiva' CHECK (stato IN ('Attiva', 'In scadenza', 'Restituita', 'Sbloccata')),
    
    -- Optional Fields
    note TEXT,
    data_restituzione TIMESTAMP WITH TIME ZONE, -- When deposit was actually returned
    data_sblocco TIMESTAMP WITH TIME ZONE -- When pre-auth was released
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_cauzioni_cliente ON cauzioni(cliente_id);
CREATE INDEX IF NOT EXISTS idx_cauzioni_veicolo ON cauzioni(veicolo_id);
CREATE INDEX IF NOT EXISTS idx_cauzioni_stato ON cauzioni(stato);
CREATE INDEX IF NOT EXISTS idx_cauzioni_scadenza ON cauzioni(scadenza_cauzione);
CREATE INDEX IF NOT EXISTS idx_cauzioni_contratto ON cauzioni(riferimento_contratto_id);

-- ============================================
-- 4. AUTO-CALCULATE SCADENZA ON INSERT/UPDATE
-- ============================================

CREATE OR REPLACE FUNCTION auto_calculate_scadenza_cauzione()
RETURNS TRIGGER AS $$
BEGIN
    -- Only recalculate if data_restituzione_veicolo changed and not in terminal state
    IF (TG_OP = 'INSERT' OR NEW.data_restituzione_veicolo != OLD.data_restituzione_veicolo)
       AND NEW.stato NOT IN ('Restituita', 'Sbloccata') THEN
        NEW.scadenza_cauzione := calculate_business_days_excluding_holidays(
            NEW.data_restituzione_veicolo,
            14
        );
    END IF;
    
    -- Update timestamp
    NEW.updated_at := NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_auto_calculate_scadenza
    BEFORE INSERT OR UPDATE ON cauzioni
    FOR EACH ROW
    EXECUTE FUNCTION auto_calculate_scadenza_cauzione();

-- ============================================
-- 5. AUTO-UPDATE STATUS BASED ON DEADLINE
-- ============================================

CREATE OR REPLACE FUNCTION auto_update_cauzione_status()
RETURNS TRIGGER AS $$
DECLARE
    days_until_deadline INTEGER;
    business_days_until_deadline INTEGER := 0;
    current_check_date DATE;
    day_of_week INTEGER;
    is_holiday BOOLEAN;
BEGIN
    -- Only auto-update if not in terminal state
    IF NEW.stato NOT IN ('Restituita', 'Sbloccata') THEN
        -- Calculate business days between today and deadline
        current_check_date := CURRENT_DATE;
        
        WHILE current_check_date < NEW.scadenza_cauzione LOOP
            day_of_week := EXTRACT(DOW FROM current_check_date);
            
            SELECT EXISTS(
                SELECT 1 FROM holidays_it WHERE holiday_date = current_check_date
            ) INTO is_holiday;
            
            IF day_of_week NOT IN (0, 6) AND NOT is_holiday THEN
                business_days_until_deadline := business_days_until_deadline + 1;
            END IF;
            
            current_check_date := current_check_date + INTERVAL '1 day';
        END LOOP;
        
        -- Set status based on business days remaining
        IF business_days_until_deadline <= 3 AND business_days_until_deadline >= 0 THEN
            NEW.stato := 'In scadenza';
        ELSIF business_days_until_deadline < 0 THEN
            -- Past deadline, keep as "In scadenza" (UI will show as overdue)
            NEW.stato := 'In scadenza';
        ELSE
            NEW.stato := 'Attiva';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_auto_update_status
    BEFORE INSERT OR UPDATE ON cauzioni
    FOR EACH ROW
    EXECUTE FUNCTION auto_update_cauzione_status();

-- ============================================
-- 6. FUNCTION TO MANUALLY UPDATE STATUS
-- ============================================

CREATE OR REPLACE FUNCTION mark_cauzione_restituita(
    cauzione_id UUID,
    return_note TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    UPDATE cauzioni
    SET 
        stato = 'Restituita',
        data_restituzione = NOW(),
        note = COALESCE(return_note, note),
        updated_at = NOW()
    WHERE id = cauzione_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION mark_cauzione_sbloccata(
    cauzione_id UUID,
    release_note TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    UPDATE cauzioni
    SET 
        stato = 'Sbloccata',
        data_sblocco = NOW(),
        note = COALESCE(release_note, note),
        updated_at = NOW()
    WHERE id = cauzione_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 7. RLS POLICIES (Row Level Security)
-- ============================================

-- Enable RLS
ALTER TABLE cauzioni ENABLE ROW LEVEL SECURITY;
ALTER TABLE holidays_it ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read holidays
CREATE POLICY "Allow authenticated users to read holidays"
    ON holidays_it FOR SELECT
    TO authenticated
    USING (true);

-- Allow service role full access to cauzioni
CREATE POLICY "Service role has full access to cauzioni"
    ON cauzioni FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Allow authenticated users to read all cauzioni
CREATE POLICY "Authenticated users can read cauzioni"
    ON cauzioni FOR SELECT
    TO authenticated
    USING (true);

-- Allow authenticated users to insert/update cauzioni
CREATE POLICY "Authenticated users can insert cauzioni"
    ON cauzioni FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Authenticated users can update cauzioni"
    ON cauzioni FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- ============================================
-- 8. HELPER VIEW FOR FRONTEND
-- ============================================

CREATE OR REPLACE VIEW cauzioni_with_details AS
SELECT 
    c.*,
    -- Calculate if overdue (today > scadenza and not terminal)
    CASE 
        WHEN CURRENT_DATE > c.scadenza_cauzione 
             AND c.stato NOT IN ('Restituita', 'Sbloccata')
        THEN true
        ELSE false
    END as is_overdue,
    -- Calculate days until deadline (can be negative if overdue)
    c.scadenza_cauzione - CURRENT_DATE as days_until_deadline
FROM cauzioni c;

-- Grant access to view
GRANT SELECT ON cauzioni_with_details TO authenticated, service_role;

-- ============================================
-- MIGRATION COMPLETE
-- ============================================
-- Next steps:
-- 1. Create frontend components (CauzioniTab.tsx, NuovaCauzioneModal.tsx)
-- 2. Add business day utility functions in TypeScript
-- 3. Integrate with AdminDashboard
