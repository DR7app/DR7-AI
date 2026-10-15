-- 15/10/2026: invio del contratto programmato rispetto al ritiro
-- (Centralina Pro > Contratto & Modifiche > Invio contratto).
--
-- Quando l'anticipo scelto non e' "Subito", signature-init non manda il link
-- ma scrive qui l'istante d'invio. Il cron contratti-programmati-cron lo
-- manda a quell'ora. Una riga per prenotazione: un nuovo salvataggio sposta
-- l'orario invece di accodare un secondo invio.
--
-- Tabella a parte (non booking_details) perche' il salvataggio della
-- prenotazione riscrive booking_details per intero e cancellerebbe la
-- programmazione.

create table if not exists public.contratti_invio_programmato (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  invia_dopo timestamptz not null,
  resign boolean not null default false,
  stato text not null default 'programmato'
    check (stato in ('programmato', 'inviato', 'annullato', 'errore')),
  tentativi integer not null default 0,
  ultimo_errore text,
  creato_at timestamptz not null default now(),
  aggiornato_at timestamptz not null default now()
);

create index if not exists contratti_invio_programmato_da_inviare_idx
  on public.contratti_invio_programmato (invia_dopo)
  where stato = 'programmato';

-- Solo il service role (Netlify functions) legge e scrive.
alter table public.contratti_invio_programmato enable row level security;
