-- 23/09/2026 (bis): clienti = Totale Clienti della tab Clienti.
-- 23/09/2026: i numeri del sito (Home e Investitori) letti dalla piattaforma.
-- Contratti firmati, clienti serviti e fatturato: calcolati qui, una sola
-- fonte, restituiti solo come tre totali (nessun dato personale esce).
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
    'clienti_serviti', (
      select count(*) from customers_extended
      where coalesce(metadata->>'role', '') <> 'autista'),
    -- Fatture emesse meno note di credito, escluse quelle scartate dallo SDI.
    'fatturato', (
      select coalesce(round(sum(case when tipo_fattura = 'nota_di_credito' then -importo_totale else importo_totale end), 2), 0)
      from fatture where coalesce(sdi_status,'') <> 'rejected'),
    'aggiornato_al', now()
  )
$$;

revoke all on function public.sito_numeri_pubblici() from public;
grant execute on function public.sito_numeri_pubblici() to anon, authenticated;
