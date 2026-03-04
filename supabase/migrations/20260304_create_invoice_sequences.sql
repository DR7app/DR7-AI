-- Atomic invoice numbering to prevent duplicate invoice numbers (SDI error 00404)
-- Replaces the race-prone query-then-increment pattern

CREATE TABLE IF NOT EXISTS invoice_sequences (
  year INTEGER PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 0
);

-- Atomic next-number function: INSERT on first call per year, UPDATE+RETURN on subsequent calls
CREATE OR REPLACE FUNCTION next_invoice_number(p_year INTEGER)
RETURNS INTEGER AS $$
DECLARE
  v_next INTEGER;
BEGIN
  INSERT INTO invoice_sequences (year, last_number)
  VALUES (p_year, 1)
  ON CONFLICT (year)
  DO UPDATE SET last_number = invoice_sequences.last_number + 1
  RETURNING last_number INTO v_next;
  RETURN v_next;
END;
$$ LANGUAGE plpgsql;

-- Seed the sequence with the current max invoice number for 2026
-- This ensures the counter starts from the right place
DO $$
DECLARE
  max_num INTEGER := 0;
  parsed INTEGER;
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT numero_fattura FROM fatture
    WHERE numero_fattura LIKE 'DR7-2026-%'
       OR numero_fattura LIKE '%/2026'
  LOOP
    -- Try DR7-YYYY-NNNN format
    IF rec.numero_fattura ~ 'DR7-\d+-(\d+)' THEN
      parsed := (regexp_match(rec.numero_fattura, 'DR7-\d+-(\d+)'))[1]::INTEGER;
      IF parsed > max_num THEN max_num := parsed; END IF;
    -- Try legacy NN/YYYY format
    ELSIF rec.numero_fattura ~ '^\d+/' THEN
      parsed := (regexp_match(rec.numero_fattura, '^(\d+)/'))[1]::INTEGER;
      IF parsed > max_num THEN max_num := parsed; END IF;
    END IF;
  END LOOP;

  -- Only seed if there are existing invoices
  IF max_num > 0 THEN
    INSERT INTO invoice_sequences (year, last_number)
    VALUES (2026, max_num)
    ON CONFLICT (year)
    DO UPDATE SET last_number = GREATEST(invoice_sequences.last_number, max_num);
  END IF;
END $$;
