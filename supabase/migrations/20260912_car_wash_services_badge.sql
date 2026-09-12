-- Etichetta della card del catalogo lavaggio (es. "CLASSICO").
--
-- Si scrive dal tab Catalogo Lavaggio & Meccanica, campo "Etichetta", e il
-- sito la disegna come pastiglia dorata sopra al nome del servizio.
-- Vuota o NULL = nessuna pastiglia, che e' lo stato di partenza di tutti.
--
-- Da eseguire a mano nel SQL editor di Supabase.
alter table public.car_wash_services
  add column if not exists badge text;

comment on column public.car_wash_services.badge is
  'Etichetta mostrata sulla card del sito sopra al nome (es. CLASSICO). NULL = nessuna.';

-- Esempio: l''etichetta chiesta il 12/09/2026 sul Full Clean.
-- update public.car_wash_services set badge = 'CLASSICO' where id = 'urban-full';
