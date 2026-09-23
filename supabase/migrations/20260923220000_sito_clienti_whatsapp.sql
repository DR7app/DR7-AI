-- 23/09/2026: "Clienti WhatsApp" = numero scritto a mano nella tab Clienti.
-- Il sito mostra Totale Clienti (anagrafica, sale da solo) + questo numero.
create table if not exists public.sito_contatori (
  chiave text primary key,
  valore integer not null default 0 check (valore >= 0),
  aggiornato_il timestamptz not null default now(),
  aggiornato_da uuid
);
alter table public.sito_contatori enable row level security;

drop policy if exists sito_contatori_lettura on public.sito_contatori;
create policy sito_contatori_lettura on public.sito_contatori
  for select to authenticated
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()));

drop policy if exists sito_contatori_scrittura on public.sito_contatori;
create policy sito_contatori_scrittura on public.sito_contatori
  for all to authenticated
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));

insert into public.sito_contatori (chiave, valore) values ('clienti_whatsapp', 2000)
  on conflict (chiave) do nothing;

create or replace function public.sito_numeri_pubblici()
returns json
language sql
stable
security definer
set search_path = public
as $$
  with valide as (
    select b.* from bookings b
    where b.status not in ('cancelled','canceled','annullata')
      and coalesce(b.service_type,'') <> 'uscita_straordinaria'
      and coalesce(b.booking_details->>'internal','false') <> 'true'
      and coalesce(b.booking_details->>'createdBy','') <> 'automatic_system'
      and upper(replace(coalesce(b.vehicle_plate,''),' ','')) not like 'TEST%'
      and lower(coalesce(b.vehicle_name,'')) <> 'test'
      and lower(trim(coalesce(b.customer_name,''))) not in ('ophelia red','valerio saja','admin dr7','oph grd')
      and lower(coalesce(b.customer_email,'')) not in ('admin@dr7.app','valesaja91@icloud.com')
  )
  select json_build_object(
    -- Un contratto per prenotazione, firmato, mai annullato, niente prove.
    'contratti_firmati', (
      select count(distinct coalesce(c.booking_id::text, c.id::text)) from contracts c
      where c.signed_pdf_url is not null
        and coalesce(c.status,'') not in ('cancelled','canceled')
        and (c.booking_id is null or c.booking_id in (select id from valide))),
    -- Stesso numero di "Totale Clienti" nella tab Clienti del gestionale:
    -- tutta l'anagrafica tranne gli autisti (CustomersTab li toglie).
    -- + i "Clienti WhatsApp" scritti a mano nella tab Clienti.
    'clienti_serviti', (
      select count(*) from customers_extended
      where coalesce(metadata->>'role', '') <> 'autista')
      + coalesce((select valore from sito_contatori where chiave = 'clienti_whatsapp'), 0),
    -- Fatture emesse meno note di credito, escluse quelle scartate dallo SDI.
    'fatturato', (
      select coalesce(round(sum(case when tipo_fattura = 'nota_di_credito' then -importo_totale else importo_totale end), 2), 0)
      from fatture where coalesce(sdi_status,'') <> 'rejected'),
    'aggiornato_al', now()
  )
$$;

revoke all on function public.sito_numeri_pubblici() from public;
grant execute on function public.sito_numeri_pubblici() to anon, authenticated;
