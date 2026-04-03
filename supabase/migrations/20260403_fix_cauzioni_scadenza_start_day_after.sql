-- ============================================
-- FIX: Cauzioni scadenza should start counting from day AFTER vehicle return
-- ============================================
-- The 14 business days countdown should begin the day after the vehicle
-- is returned, not on the return date itself.

-- 1. Recreate the function to start from start_date + 1 day
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
    -- Start counting from the day AFTER the return date
    check_date := start_date + INTERVAL '1 day';

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

-- 2. Recalculate scadenza_cauzione for all non-terminal cauzioni
UPDATE cauzioni
SET scadenza_cauzione = calculate_business_days_excluding_holidays(
    data_restituzione_veicolo,
    14
)
WHERE stato NOT IN ('Restituita', 'Sbloccata', 'Incassata', 'Bloccata', 'Danno');
