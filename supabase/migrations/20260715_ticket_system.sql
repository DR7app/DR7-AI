-- ============================================
-- SISTEMA TICKET (Apertura Ticket)
-- ============================================
-- I collaboratori aprono un ticket (autorizzazione/assistenza) che viene
-- inviato via WhatsApp al referente scelto. Un unico sistema con destinatari
-- configurabili dall'admin (niente due sistemi separati).

-- 1) DESTINATARI (referenti) — gestibili dal pannello admin
create table if not exists ticket_recipients (
    id uuid primary key default gen_random_uuid(),
    nome text not null,
    reparto text not null,
    whatsapp text not null,
    attivo boolean not null default true,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- 2) TICKET
create sequence if not exists ticket_number_seq;

create table if not exists tickets (
    id uuid primary key default gen_random_uuid(),
    -- Numero progressivo tipo "2026-0157" (anno Rome + contatore globale)
    numero text not null unique default (
        to_char(now() at time zone 'Europe/Rome', 'YYYY') || '-' ||
        lpad(nextval('ticket_number_seq')::text, 4, '0')
    ),
    reparto text not null,
    recipient_id uuid references ticket_recipients(id) on delete set null,
    recipient_nome text,
    recipient_whatsapp text,
    oggetto text,
    descrizione text not null,
    priorita text not null default 'media' check (priorita in ('bassa','media','alta','urgente')),
    telefono_riferimento text,
    allegati jsonb not null default '[]'::jsonb,
    richiedente_nome text,
    richiedente_email text,
    stato text not null default 'inviato',
    whatsapp_sent boolean default false,
    whatsapp_sent_at timestamptz,
    created_at timestamptz default now()
);

create index if not exists idx_tickets_created on tickets(created_at desc);
create index if not exists idx_tickets_recipient on tickets(recipient_id);

-- 3) RLS — l'app admin usa il ruolo authenticated
alter table ticket_recipients enable row level security;
alter table tickets enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='ticket_recipients' and policyname='ticket_recipients_all_auth') then
    create policy ticket_recipients_all_auth on ticket_recipients for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='ticket_recipients' and policyname='ticket_recipients_all_service') then
    create policy ticket_recipients_all_service on ticket_recipients for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='tickets' and policyname='tickets_all_auth') then
    create policy tickets_all_auth on tickets for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='tickets' and policyname='tickets_all_service') then
    create policy tickets_all_service on tickets for all to service_role using (true) with check (true);
  end if;
end $$;

-- 4) STORAGE bucket per gli allegati
insert into storage.buckets (id, name, public)
values ('ticket-attachments', 'ticket-attachments', true)
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='ticket_attach_read') then
    create policy ticket_attach_read on storage.objects for select using (bucket_id = 'ticket-attachments');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='ticket_attach_insert') then
    create policy ticket_attach_insert on storage.objects for insert to authenticated with check (bucket_id = 'ticket-attachments');
  end if;
end $$;

-- 5) Seed iniziale: direzione (Valerio + Ilenia) — l'admin puo' aggiungere altri
insert into ticket_recipients (nome, reparto, whatsapp)
select 'Valerio', 'Direzione', '393472817258'
where not exists (select 1 from ticket_recipients where whatsapp = '393472817258');
insert into ticket_recipients (nome, reparto, whatsapp)
select 'Ilenia', 'Direzione', '393517646703'
where not exists (select 1 from ticket_recipients where whatsapp = '393517646703');
