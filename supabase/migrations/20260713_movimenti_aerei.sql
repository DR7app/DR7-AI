-- 2026-07-13: Conteggio movimenti aerei sul piazzale DR7 (sezione Noleggio Aria).
-- Ogni movimento = un decollo o un atterraggio registrato dall'operatore.
create table if not exists public.movimenti_aerei (
    id           uuid primary key default gen_random_uuid(),
    created_at   timestamptz not null default now(),
    movement_at  timestamptz not null default now(),   -- quando è avvenuto il movimento
    tipo         text not null default 'decollo' check (tipo in ('decollo','atterraggio')),
    aeromobile   text,                                   -- es. Airbus H125, Bell 505
    nota         text
);

create index if not exists idx_movimenti_aerei_at on public.movimenti_aerei (movement_at desc);

alter table public.movimenti_aerei enable row level security;
drop policy if exists movimenti_aerei_read on public.movimenti_aerei;
create policy movimenti_aerei_read on public.movimenti_aerei for select using (true);
drop policy if exists movimenti_aerei_write on public.movimenti_aerei;
create policy movimenti_aerei_write on public.movimenti_aerei for all using (true) with check (true);

comment on table public.movimenti_aerei is 'Movimenti aerei (decolli/atterraggi) sul piazzale DR7 — conteggio Noleggio Aria.';
