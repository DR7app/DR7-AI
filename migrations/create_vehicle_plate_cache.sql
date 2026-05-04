-- Cache for openapi.com targa lookups.
-- Goal: every plate paid for once, returned for free thereafter.
-- The Netlify function `lookup-targa.ts` checks this table FIRST. On a hit it
-- bumps last_seen_at + lookup_count and returns immediately. On a miss it
-- calls openapi.com once and INSERTs the result here.
--
-- Plate is stored uppercase, no spaces/hyphens (same normalization the
-- function applies to the input).

create table if not exists public.vehicle_plate_cache (
  plate         text primary key,
  brand         text,
  model         text,
  make_model    text,
  description   text,
  year          text,
  fuel          text,
  power_cv      text,
  displacement  text,
  doors         text,
  source        text not null default 'openapi',
  lookup_count  integer not null default 1,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

comment on table public.vehicle_plate_cache is
  'Local cache of plate lookups. First lookup pays openapi.com, subsequent lookups are free.';

create index if not exists vehicle_plate_cache_last_seen_at_idx
  on public.vehicle_plate_cache (last_seen_at desc);

-- Service role only — the Netlify function uses SUPABASE_SERVICE_ROLE_KEY,
-- which bypasses RLS. Enabling RLS here just denies anon/authenticated.
alter table public.vehicle_plate_cache enable row level security;

-- Atomic counter increment + last_seen bump on cache hit. Called fire-and-forget
-- by lookup-targa.ts; the response is already returned to the operator before
-- this runs.
create or replace function public.increment_plate_lookup_count(p_plate text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.vehicle_plate_cache
     set lookup_count = lookup_count + 1,
         last_seen_at = now()
   where plate = p_plate;
$$;

grant execute on function public.increment_plate_lookup_count(text) to service_role;
