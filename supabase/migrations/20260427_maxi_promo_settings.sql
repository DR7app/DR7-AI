-- Maxi Promo Gap settings: singleton row that controls how the cron sends.
-- mode='pilot'      → sends only to pilot_phone
-- mode='broadcast'  → sends to every customers_extended row with a phone
-- mode='off'        → cron does nothing
create table if not exists public.maxi_promo_settings (
  id integer primary key default 1,
  mode text not null default 'off' check (mode in ('off', 'pilot', 'broadcast')),
  pilot_phone text,
  updated_at timestamptz not null default now(),
  constraint singleton check (id = 1)
);

insert into public.maxi_promo_settings (id, mode) values (1, 'off')
on conflict (id) do nothing;

alter table public.maxi_promo_settings enable row level security;

-- Service role only writes; admin read via RPC or service-role fetches.
