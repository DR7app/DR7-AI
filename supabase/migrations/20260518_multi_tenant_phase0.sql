-- =====================================================================
-- Multi-Brand / Multi-Sede — Phase 0: Foundation (data labeling only)
-- =====================================================================
-- Created: 2026-05-18
--
-- WHAT THIS DOES:
--   1. Creates `brands` and `sedi` tables.
--   2. Seeds the default `dr7_empire` brand and its `cagliari` sede.
--   3. Adds `brand_id` (and where relevant `sede_id`) columns to every
--      tenant-scoped table, with default = 'dr7_empire' / 'cagliari' so
--      future inserts that forget the field are still valid.
--   4. Backfills every existing row with the DR7 defaults.
--   5. Adds FK constraints so rogue values can't be inserted.
--
-- WHAT THIS DOES NOT DO:
--   - It does NOT add RLS policies. That comes in Phase 1.
--   - It does NOT change any application code. DR7 continues working
--     identically (defaults make the new columns transparent).
--   - It does NOT touch audit-log / derived tables (signature_audit_trail,
--     credit_transactions, etc.). Those inherit isolation via FK on
--     booking_id / customer_id and don't need direct labeling yet.
--
-- IDEMPOTENT: every statement uses IF NOT EXISTS / IF EXISTS, so re-running
-- this migration is a no-op.
--
-- ROLLBACK: this is reversible. If anything goes wrong, run:
--   ALTER TABLE <table> DROP COLUMN IF EXISTS brand_id;
--   ALTER TABLE <table> DROP COLUMN IF EXISTS sede_id;
--   DROP TABLE IF EXISTS sedi;
--   DROP TABLE IF EXISTS brands;
-- =====================================================================

-- ─── 1. BRANDS TABLE ───────────────────────────────────────────────────
create table if not exists public.brands (
  id              text primary key,
  name            text not null,
  slug            text unique,
  owner_email     text,
  subdomain       text unique,
  -- JSONB bucket for per-brand settings (logo URL, default lang,
  -- WhatsApp number, primary color, etc.). Schema-less by design so
  -- each brand can keep its own keys without migrations.
  settings        jsonb not null default '{}'::jsonb,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.brands is 'Multi-tenant root: each row = one rental company on the platform';

-- Seed DR7 Empire as the first brand (default tenant)
insert into public.brands (id, name, slug, owner_email, subdomain, settings, is_active)
values (
  'dr7_empire',
  'DR7 Empire',
  'dr7-empire',
  'dubai.rent7.0srl@gmail.com',
  'admin',
  jsonb_build_object(
    'is_platform_owner', true,
    'lang', 'it',
    'currency', 'EUR'
  ),
  true
)
on conflict (id) do nothing;


-- ─── 2. SEDI TABLE ─────────────────────────────────────────────────────
create table if not exists public.sedi (
  id              text primary key,
  brand_id        text not null references public.brands(id) on update cascade,
  name            text not null,
  address         text,
  city            text,
  phone           text,
  is_primary      boolean not null default false,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.sedi is 'Physical branch/location within a brand. A brand always has at least one (primary) sede.';

create index if not exists sedi_brand_id_idx on public.sedi(brand_id);

-- Seed DR7 Cagliari as the primary sede of DR7 Empire
insert into public.sedi (id, brand_id, name, address, city, phone, is_primary, is_active)
values (
  'cagliari',
  'dr7_empire',
  'DR7 Cagliari',
  'Viale Marconi 229',
  'Cagliari',
  '+39 345 7905205',
  true,
  true
)
on conflict (id) do nothing;


-- ─── 3. HELPER: add brand_id + (optional) sede_id to a table ───────────
-- We inline the same pattern for each table instead of a stored function
-- so the migration stays easy to audit / partial-apply / partial-rollback.

-- Macro: for each table T,
--   - add brand_id  text not null default 'dr7_empire' (FK → brands)
--   - add sede_id   text not null default 'cagliari'  (FK → sedi)  [where applicable]
--   - backfill existing rows
--   - create index on (brand_id, sede_id)


-- ─── 4. TABLES THAT GET brand_id + sede_id ─────────────────────────────
-- These are physically located: a booking happens at a sede, a vehicle
-- is parked at a sede, a fattura is issued by a sede, etc.

-- bookings
alter table public.bookings  add column if not exists brand_id text not null default 'dr7_empire' references public.brands(id) on update cascade;
alter table public.bookings  add column if not exists sede_id  text not null default 'cagliari'  references public.sedi(id)   on update cascade;
create index if not exists bookings_brand_sede_idx on public.bookings(brand_id, sede_id);

-- vehicles
alter table public.vehicles  add column if not exists brand_id text not null default 'dr7_empire' references public.brands(id) on update cascade;
alter table public.vehicles  add column if not exists sede_id  text not null default 'cagliari'  references public.sedi(id)   on update cascade;
create index if not exists vehicles_brand_sede_idx on public.vehicles(brand_id, sede_id);

-- fatture
alter table public.fatture   add column if not exists brand_id text not null default 'dr7_empire' references public.brands(id) on update cascade;
alter table public.fatture   add column if not exists sede_id  text not null default 'cagliari'  references public.sedi(id)   on update cascade;
create index if not exists fatture_brand_sede_idx on public.fatture(brand_id, sede_id);

-- preventivi
alter table public.preventivi add column if not exists brand_id text not null default 'dr7_empire' references public.brands(id) on update cascade;
alter table public.preventivi add column if not exists sede_id  text not null default 'cagliari'  references public.sedi(id)   on update cascade;
create index if not exists preventivi_brand_sede_idx on public.preventivi(brand_id, sede_id);

-- contracts
alter table public.contracts add column if not exists brand_id text not null default 'dr7_empire' references public.brands(id) on update cascade;
alter table public.contracts add column if not exists sede_id  text not null default 'cagliari'  references public.sedi(id)   on update cascade;
create index if not exists contracts_brand_sede_idx on public.contracts(brand_id, sede_id);

-- admins (sede nullable: direzione/platform-owner can be brand-wide)
alter table public.admins    add column if not exists brand_id text not null default 'dr7_empire' references public.brands(id) on update cascade;
alter table public.admins    add column if not exists sede_id  text references public.sedi(id) on update cascade;
update public.admins set sede_id = 'cagliari' where sede_id is null;
create index if not exists admins_brand_sede_idx on public.admins(brand_id, sede_id);


-- ─── 5. TABLES THAT GET ONLY brand_id (sede irrelevant) ───────────────
-- Customers, wallets, configs, templates, codes: these don't belong to
-- one physical sede — they float at the brand level.

alter table public.customers          add column if not exists brand_id text not null default 'dr7_empire' references public.brands(id) on update cascade;
alter table public.customers_extended add column if not exists brand_id text not null default 'dr7_empire' references public.brands(id) on update cascade;
alter table public.wallets            add column if not exists brand_id text not null default 'dr7_empire' references public.brands(id) on update cascade;

-- centralina_pro_config (brand-wide config; if a brand ever needs per-sede
-- overrides we'll add a `sede_id` later as nullable so brand-level config
-- = sede_id null).
alter table public.centralina_pro_config add column if not exists brand_id text not null default 'dr7_empire' references public.brands(id) on update cascade;

alter table public.system_messages     add column if not exists brand_id text not null default 'dr7_empire' references public.brands(id) on update cascade;
alter table public.system_otp_overrides add column if not exists brand_id text not null default 'dr7_empire' references public.brands(id) on update cascade;
alter table public.payment_method_config add column if not exists brand_id text not null default 'dr7_empire' references public.brands(id) on update cascade;
alter table public.discount_codes      add column if not exists brand_id text not null default 'dr7_empire' references public.brands(id) on update cascade;
alter table public.fornitori           add column if not exists brand_id text not null default 'dr7_empire' references public.brands(id) on update cascade;
alter table public.car_wash_services   add column if not exists brand_id text not null default 'dr7_empire' references public.brands(id) on update cascade;
alter table public.gift_cards          add column if not exists brand_id text not null default 'dr7_empire' references public.brands(id) on update cascade;
alter table public.birthday_messages   add column if not exists brand_id text not null default 'dr7_empire' references public.brands(id) on update cascade;
alter table public.marketing_campaigns add column if not exists brand_id text not null default 'dr7_empire' references public.brands(id) on update cascade;

-- Brand-level indexes
create index if not exists customers_brand_idx           on public.customers(brand_id);
create index if not exists customers_extended_brand_idx  on public.customers_extended(brand_id);
create index if not exists wallets_brand_idx             on public.wallets(brand_id);
create index if not exists system_messages_brand_idx     on public.system_messages(brand_id);
create index if not exists discount_codes_brand_idx      on public.discount_codes(brand_id);
create index if not exists fornitori_brand_idx           on public.fornitori(brand_id);


-- ─── 6. UPDATED_AT TRIGGER for brands + sedi ───────────────────────────
create or replace function public.set_updated_at_now()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists brands_set_updated_at on public.brands;
create trigger brands_set_updated_at
  before update on public.brands
  for each row execute function public.set_updated_at_now();

drop trigger if exists sedi_set_updated_at on public.sedi;
create trigger sedi_set_updated_at
  before update on public.sedi
  for each row execute function public.set_updated_at_now();


-- ─── 7. VERIFICATION QUERIES (read-only — run these to confirm) ────────
-- Uncomment and run after the migration to confirm everything looks right:
--
-- select id, name, is_active from public.brands;
-- -- expect: 1 row, dr7_empire / DR7 Empire / true
--
-- select id, brand_id, name, is_primary from public.sedi;
-- -- expect: 1 row, cagliari / dr7_empire / DR7 Cagliari / true
--
-- select brand_id, count(*) from public.bookings group by brand_id;
-- -- expect: every row has brand_id = 'dr7_empire'
--
-- select brand_id, sede_id, count(*) from public.vehicles group by brand_id, sede_id;
-- -- expect: every row has brand_id='dr7_empire', sede_id='cagliari'
--
-- select brand_id, count(*) from public.customers_extended group by brand_id;
-- select brand_id, count(*) from public.fatture group by brand_id;
-- select brand_id, count(*) from public.preventivi group by brand_id;
