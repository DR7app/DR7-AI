-- 28/09/2026 - EMTN, storico della rete per le copie vendute.
--
-- Ogni copia del gestionale ha il suo database. Quando si prepara una copia
-- per un acquirente, lo script scripts/emtn-rete/importa-storico.ts ci carica
-- lo storico danni/penali/importi da saldare di DR7, ANONIMO:
--   - niente nome, email, telefono, targa, veicolo, prenotazione, operatore;
--   - il codice fiscale non c'e' in chiaro: solo la sua impronta HMAC-SHA256
--     con la chiave EMTN_RETE_CHIAVE di quella copia.
-- Chi usa la copia vede queste righe SOLO digitando un codice fiscale
-- (emtn-search). Nessuna schermata ne' funzione le elenca, e il browser non
-- le puo' leggere: RLS attiva senza policy, solo la service role.

create table if not exists public.emtn_storico_rete (
    id uuid primary key default gen_random_uuid(),
    cf_impronta text not null,
    tipo text not null check (tipo in ('danno', 'penale', 'insoluto')),
    voce text,
    importo numeric(12,2) not null default 0,
    pagato numeric(12,2) not null default 0,
    residuo numeric(12,2) not null default 0,
    stato_pagamento text not null check (stato_pagamento in ('paid', 'partial', 'pending')),
    data_evento date,
    giorni_al_saldo integer,
    lotto text not null,
    importato_at timestamptz not null default now()
);

create index if not exists emtn_storico_rete_cf_idx on public.emtn_storico_rete (cf_impronta);

alter table public.emtn_storico_rete enable row level security;
revoke all on public.emtn_storico_rete from anon, authenticated;
