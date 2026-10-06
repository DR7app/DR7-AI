-- 06/10/2026 (direzione): sulla pagina /investitori, sotto "Patrimonio netto",
-- il numero di investitori e il capitale investito, sempre aggiornati.
-- sito_numeri_pubblici() li aggiunge come due TOTALI (nessun nome, nessun
-- importo del singolo): investitori con almeno un versamento e somma dei
-- versamenti di Amministrazione > Investitori. Il resto della funzione e'
-- identico a 20260923230000_sito_numeri_base_storica + valore_flotta.
create or replace function public.sito_numeri_pubblici()
 returns json
 language sql
 stable security definer
 set search_path to 'public'
as $function$
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
    -- + i contratti prima della piattaforma (contratti_storici).
    'contratti_firmati', (
      select count(distinct coalesce(c.booking_id::text, c.id::text)) from contracts c
      where c.signed_pdf_url is not null
        and coalesce(c.status,'') not in ('cancelled','canceled')
        and (c.booking_id is null or c.booking_id in (select id from valide)))
      + coalesce((select valore from sito_contatori where chiave = 'contratti_storici'), 0),
    -- Stesso numero di "Totale Clienti" nella tab Clienti del gestionale:
    -- tutta l'anagrafica tranne gli autisti (CustomersTab li toglie).
    -- + i "Clienti WhatsApp" scritti a mano nella tab Clienti.
    'clienti_serviti', (
      select count(*) from customers_extended
      where coalesce(metadata->>'role', '') <> 'autista')
      + coalesce((select valore from sito_contatori where chiave = 'clienti_whatsapp'), 0),
    -- Fatture emesse meno note di credito, escluse quelle scartate dallo SDI.
    -- + il fatturato prima della piattaforma (fatturato_storico).
    'fatturato', (
      select coalesce(round(sum(case when tipo_fattura = 'nota_di_credito' then -importo_totale else importo_totale end), 2), 0)
      from fatture where coalesce(sdi_status,'') <> 'rejected')
      + coalesce((select valore from sito_contatori where chiave = 'fatturato_storico'), 0),
    -- Valore del parco auto: somma di metadata.valore_veicolo (euro interi,
    -- scritto nella tab Veicoli) sui veicoli attivi, niente dismessi ne' prove.
    'valore_flotta', (
      select coalesce(sum((metadata->>'valore_veicolo')::numeric), 0) from vehicles
      where status <> 'retired'
        and upper(replace(coalesce(plate,''),' ','')) not like 'TEST%'
        and lower(trim(coalesce(display_name,''))) <> 'test'
        and coalesce(metadata->>'valore_veicolo','') ~ '^[0-9]+(\.[0-9]+)?$'),
    -- Investitori (06/10/2026): solo i due totali.
    'totale_investitori', (
      select count(distinct investitore_id) from investitori_versamenti),
    'capitale_investito', (
      select coalesce(round(sum(importo), 2), 0) from investitori_versamenti),
    'aggiornato_al', now()
  )
$function$;
