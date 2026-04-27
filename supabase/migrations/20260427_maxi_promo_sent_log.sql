-- Maxi Promo Gap dedup log: ensures the same (vehicle, gap_date) is sent
-- at most once. The cron checks here before firing.
create table if not exists public.maxi_promo_sent_log (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null,
  gap_date date not null,
  recipient text not null,
  template_key text,
  sent_at timestamptz not null default now(),
  unique (vehicle_id, gap_date, recipient)
);

create index if not exists idx_maxi_promo_sent_log_vehicle_date
  on public.maxi_promo_sent_log (vehicle_id, gap_date);

alter table public.maxi_promo_sent_log enable row level security;

-- Only the service role inserts into this table. No client policies.
