-- CAP esteri (es. "SW1A 1AA", "1012 AB") superavano varchar(5) e bloccavano il salvataggio cliente
alter table public.customers_extended
  alter column cap type varchar(20),
  alter column codice_postale type varchar(20);
