-- 06/10/2026 (direzione): numero di azioni possedute da ogni investitore.
-- Facoltativo: null = non indicato.
alter table public.investitori
  add column if not exists numero_azioni numeric(18,0)
  check (numero_azioni is null or numero_azioni >= 0);
