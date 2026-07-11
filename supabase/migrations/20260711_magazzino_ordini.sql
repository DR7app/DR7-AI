-- 2026-07-11: Storico ordini Magazzino (ricambi / materiale vario).
-- Prima il bottone "Invia ordine" mandava il carrello via WhatsApp al
-- fornitore ma NON registrava nulla: nessuna traccia di cosa era stato
-- ordinato, ne' un report mensile. Questa tabella conserva ogni ordine
-- inviato, per lo storico e il report mensile.

create table if not exists public.magazzino_ordini (
    id              uuid primary key default gen_random_uuid(),
    created_at      timestamptz not null default now(),
    fornitore_id    text,
    fornitore_nome  text not null,
    items           jsonb not null default '[]'::jsonb,   -- righe del carrello (veicolo, ricambio, quantita')
    items_count     integer not null default 0,
    note            text,
    message_body    text,                                  -- messaggio WhatsApp effettivamente inviato
    green_message_id text,                                 -- id messaggio Green API (se disponibile)
    sent_via        text not null default 'whatsapp'
);

-- Colonne generate per il raggruppamento mensile del report.
alter table public.magazzino_ordini
    add column if not exists periodo_mese integer generated always as (extract(month from created_at)) stored,
    add column if not exists periodo_anno integer generated always as (extract(year  from created_at)) stored;

create index if not exists idx_magazzino_ordini_created on public.magazzino_ordini (created_at desc);
create index if not exists idx_magazzino_ordini_periodo on public.magazzino_ordini (periodo_anno, periodo_mese);
create index if not exists idx_magazzino_ordini_fornitore on public.magazzino_ordini (fornitore_id);

alter table public.magazzino_ordini enable row level security;

-- Stessa policy delle altre tabelle admin: lettura anon (l'app admin usa anon
-- key + gating applicativo), scrittura autenticata.
drop policy if exists magazzino_ordini_read on public.magazzino_ordini;
create policy magazzino_ordini_read on public.magazzino_ordini for select using (true);

drop policy if exists magazzino_ordini_write on public.magazzino_ordini;
create policy magazzino_ordini_write on public.magazzino_ordini for insert with check (true);

comment on table public.magazzino_ordini is 'Storico ordini ricambi/materiale inviati ai fornitori dal Magazzino (per report mensile).';
