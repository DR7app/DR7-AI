-- Drop the legacy CHECK constraint on vehicles.category.
--
-- Storia: la constraint vincolava category a {SUPERCAR, URBAN, UTILITAIRE}.
-- Da aprile 2026 le categorie sono gestite da Centralina Pro
-- (centralina_pro_config.config.categories), quindi l'operatore puo'
-- creare ID arbitrari (es. "exotic", "furgone", "luxury", ecc.) e la
-- constraint blocca qualunque salvataggio dal form Veicoli con il
-- classico errore Postgres 23514 check_violation:
--   new row for relation "vehicles" violates check constraint
--   "vehicles_category_check"
--
-- Soluzione: rimuovere la constraint. La sorgente di verita\' resta
-- Centralina Pro, validata client-side dal form (Select limita le
-- scelte alle categorie note). Manteniamo NOT NULL e l'indice perche\'
-- continuano a essere utili.
ALTER TABLE vehicles
DROP CONSTRAINT IF EXISTS vehicles_category_check;

COMMENT ON COLUMN vehicles.category IS
  'Vehicle category id. Source of truth: centralina_pro_config.config.categories.';
