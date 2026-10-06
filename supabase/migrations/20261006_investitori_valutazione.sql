-- 06/10/2026 (direzione): Amministrazione > Investitori > Valutazione azienda.
--
-- Una sola riga (id = 1): valutazione dell'azienda e costo di un'azione.
-- Servono al gestionale per calcolare in automatico, dato l'importo investito,
-- la quota % (importo / valutazione) e il numero di azioni (importo / costo azione).
-- Stessa riservatezza delle altre tabelle investitori.

create table if not exists public.investitori_valutazione (
  id smallint primary key default 1 check (id = 1),
  valutazione numeric(16,2) check (valutazione is null or valutazione > 0),
  costo_azione numeric(14,4) check (costo_azione is null or costo_azione > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

alter table public.investitori_valutazione enable row level security;

drop policy if exists "Valutazione investitori: solo autorizzati" on public.investitori_valutazione;
create policy "Valutazione investitori: solo autorizzati"
  on public.investitori_valutazione for all to authenticated
  using (public.dr7_puo_vedere_investitori())
  with check (public.dr7_puo_vedere_investitori());

revoke all on public.investitori_valutazione from anon;
