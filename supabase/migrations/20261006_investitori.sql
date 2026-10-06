-- 06/10/2026 (direzione): Amministrazione > Investitori.
--
-- Chi ha investito in DR7 e quanto. Un investitore puo' versare piu' volte:
-- l'anagrafica sta in `investitori`, ogni versamento in `investitori_versamenti`,
-- il totale investito e' la somma dei versamenti (mai un campo da tenere allineato).
--
-- Dato riservato: legge e scrive solo la direzione (dr7_is_direzione() copre
-- anche superadmin e developer) o l'operatore a cui e' stata spuntata la tab
-- `investitori` (o '*'). Stessa regola di hasPermission('investitori') nel gestionale.

create table if not exists public.investitori (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tipo text not null default 'persona' check (tipo in ('persona', 'societa')),
  codice_fiscale text,
  email text,
  telefono text,
  quota_percentuale numeric(7,4) check (quota_percentuale is null or (quota_percentuale >= 0 and quota_percentuale <= 100)),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table if not exists public.investitori_versamenti (
  id uuid primary key default gen_random_uuid(),
  investitore_id uuid not null references public.investitori(id) on delete cascade,
  importo numeric(14,2) not null check (importo > 0),
  data_versamento date not null default current_date,
  strumento text,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create index if not exists investitori_versamenti_investitore_idx
  on public.investitori_versamenti (investitore_id, data_versamento desc);

create or replace function public.dr7_puo_vedere_investitori()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.dr7_is_direzione() or exists (
    select 1 from public.admins a
     where a.user_id = auth.uid()
       and a.archived_at is null
       and (a.permissions @> '["investitori"]'::jsonb or a.permissions @> '["*"]'::jsonb)
  );
$$;

revoke all on function public.dr7_puo_vedere_investitori() from public;
grant execute on function public.dr7_puo_vedere_investitori() to authenticated;

alter table public.investitori enable row level security;
alter table public.investitori_versamenti enable row level security;

drop policy if exists "Investitori: solo autorizzati" on public.investitori;
create policy "Investitori: solo autorizzati"
  on public.investitori for all to authenticated
  using (public.dr7_puo_vedere_investitori())
  with check (public.dr7_puo_vedere_investitori());

drop policy if exists "Versamenti investitori: solo autorizzati" on public.investitori_versamenti;
create policy "Versamenti investitori: solo autorizzati"
  on public.investitori_versamenti for all to authenticated
  using (public.dr7_puo_vedere_investitori())
  with check (public.dr7_puo_vedere_investitori());

revoke all on public.investitori from anon;
revoke all on public.investitori_versamenti from anon;
