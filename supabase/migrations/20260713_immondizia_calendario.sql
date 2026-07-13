-- 2026-07-13: Calendario immondizia (raccolta differenziata) coordinato con
-- quello consegnato all'operatore. Supporta DUE modi (scelti per riga):
--   - 'weekly': ritiro ricorrente in un giorno della settimana (0=Dom..6=Sab)
--   - 'date'  : ritiro in una data specifica
-- Un cron serale manda il promemoria del ritiro del giorno dopo.

create table if not exists public.immondizia_calendario (
    id            uuid primary key default gen_random_uuid(),
    created_at    timestamptz not null default now(),
    tipo_rifiuto  text not null,              -- es. Organico, Plastica/Lattine, Carta, Vetro, Secco/Indifferenziato, Ingombranti
    mode          text not null default 'weekly' check (mode in ('weekly','date')),
    day_of_week   integer check (day_of_week between 0 and 6),  -- usato se mode='weekly' (0=Domenica)
    pickup_date   date,                         -- usato se mode='date'
    reminder_enabled boolean not null default true,
    active        boolean not null default true,
    note          text
);

create index if not exists idx_immondizia_active on public.immondizia_calendario (active);
create index if not exists idx_immondizia_dow on public.immondizia_calendario (day_of_week);
create index if not exists idx_immondizia_date on public.immondizia_calendario (pickup_date);

alter table public.immondizia_calendario enable row level security;
drop policy if exists immondizia_read on public.immondizia_calendario;
create policy immondizia_read on public.immondizia_calendario for select using (true);
drop policy if exists immondizia_write on public.immondizia_calendario;
create policy immondizia_write on public.immondizia_calendario for all using (true) with check (true);

comment on table public.immondizia_calendario is 'Calendario ritiro immondizia (weekly o date specifiche) + promemoria.';
