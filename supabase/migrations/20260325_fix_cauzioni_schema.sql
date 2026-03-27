-- ============================================
-- FIX CAUZIONI SCHEMA
-- Adds missing FK constraints, columns, and stato values
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. Add missing columns if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cauzioni' AND column_name = 'data_incasso') THEN
        ALTER TABLE cauzioni ADD COLUMN data_incasso TIMESTAMP WITH TIME ZONE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cauzioni' AND column_name = 'nexi_transaction_id') THEN
        ALTER TABLE cauzioni ADD COLUMN nexi_transaction_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cauzioni' AND column_name = 'nexi_order_id') THEN
        ALTER TABLE cauzioni ADD COLUMN nexi_order_id TEXT;
    END IF;
END $$;

-- 2. Update CHECK constraint to include all stato values used by the UI
-- Drop old constraint first (name may vary)
DO $$
BEGIN
    -- Try dropping by common constraint names
    ALTER TABLE cauzioni DROP CONSTRAINT IF EXISTS cauzioni_stato_check;
    ALTER TABLE cauzioni DROP CONSTRAINT IF EXISTS cauzioni_stato_check1;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

ALTER TABLE cauzioni ADD CONSTRAINT cauzioni_stato_check
    CHECK (stato IN ('Attiva', 'In scadenza', 'Restituita', 'Sbloccata', 'Incassata', 'Bloccata', 'Danno'));

-- 3. Add FK constraints if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'cauzioni_cliente_id_fkey' AND table_name = 'cauzioni'
    ) THEN
        ALTER TABLE cauzioni ADD CONSTRAINT cauzioni_cliente_id_fkey
            FOREIGN KEY (cliente_id) REFERENCES customers_extended(id) ON DELETE SET NULL;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not add cliente_id FK: %', SQLERRM;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'cauzioni_veicolo_id_fkey' AND table_name = 'cauzioni'
    ) THEN
        ALTER TABLE cauzioni ADD CONSTRAINT cauzioni_veicolo_id_fkey
            FOREIGN KEY (veicolo_id) REFERENCES vehicles(id) ON DELETE SET NULL;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not add veicolo_id FK: %', SQLERRM;
END $$;

-- 4. Update the auto_update_cauzione_status trigger to handle new states
CREATE OR REPLACE FUNCTION auto_update_cauzione_status()
RETURNS TRIGGER AS $$
DECLARE
    business_days_until_deadline INTEGER := 0;
    current_check_date DATE;
    day_of_week INTEGER;
    is_holiday BOOLEAN;
BEGIN
    -- Only auto-update if not in terminal state
    IF NEW.stato NOT IN ('Restituita', 'Sbloccata', 'Incassata', 'Bloccata', 'Danno') THEN
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

        IF business_days_until_deadline <= 3 AND business_days_until_deadline >= 0 THEN
            NEW.stato := 'In scadenza';
        ELSIF business_days_until_deadline < 0 THEN
            NEW.stato := 'In scadenza';
        ELSE
            NEW.stato := 'Attiva';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Verify
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'cauzioni' ORDER BY ordinal_position;
