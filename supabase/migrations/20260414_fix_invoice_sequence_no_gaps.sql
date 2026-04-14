-- Fix invoice numbering: no gaps, always next consecutive number
-- Finds the actual max from fatture table and returns max+1
-- Falls back to invoice_sequences counter if no fatture exist yet

CREATE OR REPLACE FUNCTION next_invoice_number(p_year INTEGER)
RETURNS INTEGER AS $$
DECLARE
  v_max_from_fatture INTEGER := 0;
  v_max_from_seq INTEGER := 0;
  v_next INTEGER;
  rec RECORD;
BEGIN
  -- Find actual max from fatture table for this year
  FOR rec IN
    SELECT numero_fattura FROM fatture
    WHERE numero_fattura LIKE 'DR7-' || p_year || '-%'
  LOOP
    IF rec.numero_fattura ~ 'DR7-\d+-(\d+)' THEN
      DECLARE parsed INTEGER;
      BEGIN
        parsed := (regexp_match(rec.numero_fattura, 'DR7-\d+-(\d+)'))[1]::INTEGER;
        IF parsed > v_max_from_fatture THEN
          v_max_from_fatture := parsed;
        END IF;
      END;
    END IF;
  END LOOP;

  -- Also check legacy format NN/YYYY
  FOR rec IN
    SELECT numero_fattura FROM fatture
    WHERE numero_fattura LIKE '%/' || p_year
  LOOP
    IF rec.numero_fattura ~ '^\d+/' THEN
      DECLARE parsed INTEGER;
      BEGIN
        parsed := (regexp_match(rec.numero_fattura, '^(\d+)/'))[1]::INTEGER;
        IF parsed > v_max_from_fatture THEN
          v_max_from_fatture := parsed;
        END IF;
      END;
    END IF;
  END LOOP;

  -- Get counter from sequence table
  SELECT last_number INTO v_max_from_seq
  FROM invoice_sequences
  WHERE year = p_year;

  IF v_max_from_seq IS NULL THEN
    v_max_from_seq := 0;
  END IF;

  -- Use the higher of the two (actual fatture vs counter)
  v_next := GREATEST(v_max_from_fatture, v_max_from_seq) + 1;

  -- Update the sequence to stay in sync
  INSERT INTO invoice_sequences (year, last_number)
  VALUES (p_year, v_next)
  ON CONFLICT (year)
  DO UPDATE SET last_number = v_next;

  RETURN v_next;
END;
$$ LANGUAGE plpgsql;
