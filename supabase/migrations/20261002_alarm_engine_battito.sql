-- 02/10/2026: battito del motore allarmi sul server.
--
-- Il giro allarmi gira ogni minuto in netlify/functions/alarm-engine-cron.ts
-- (chiave di servizio) e lascia qui l'ora del suo ultimo giro. Il gestionale
-- lo legge: battito recente e senza errore = il server sta facendo il giro e
-- la scheda si limita a suonare; battito vecchio o con errore = la scheda fa
-- il giro da se', come prima. Scrive solo il service role (nessuna policy di
-- scrittura); leggono gli admin.
create table if not exists public.alarm_engine_battito (
    fonte text primary key,
    ultimo_giro timestamptz not null default now(),
    durata_ms integer,
    aperti integer,
    nuovi integer,
    richiusi integer,
    messaggi integer,
    errore text
);

alter table public.alarm_engine_battito enable row level security;

drop policy if exists "Admins can read alarm_engine_battito" on public.alarm_engine_battito;
create policy "Admins can read alarm_engine_battito" on public.alarm_engine_battito
    for select using (exists (select 1 from public.admins where admins.user_id = auth.uid()));
