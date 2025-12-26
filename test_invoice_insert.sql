-- Quick test: Check if we can insert a minimal invoice
-- Run this in Supabase SQL Editor to test if the schema works

INSERT INTO fatture (
  numero_fattura,
  data_emissione,
  importo_totale,
  stato
) VALUES (
  'TEST/2025',
  CURRENT_DATE,
  100.00,
  'paid'
) RETURNING *;

-- If this works, delete the test row:
-- DELETE FROM fatture WHERE numero_fattura = 'TEST/2025';
