-- Verify RICCARDO PILIA is in customers_extended
SELECT id, nome, cognome, email, telefono, source, created_at
FROM customers_extended
WHERE LOWER(email) = 'r.p.system.srl@gmail.com';

-- Also check how many customers were created by the backfill
SELECT 
  source,
  COUNT(*) as count
FROM customers_extended
WHERE source IN ('booking_auto_created', 'backfill_manual', 'backfill_auto')
GROUP BY source
ORDER BY source;
