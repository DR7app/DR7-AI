-- 2026-08-25: l'aeromobile di un movimento si sceglie dalla tendina degli
-- elicotteri del catalogo Noleggio Aria, non si scrive piu' a mano.
-- Oltre al nome (che resta, come copia storica per i mezzi poi cancellati dal
-- catalogo) si salva l'id del mezzo: cosi' se in Elicotteri lo si RINOMINA,
-- lo storico dei movimenti mostra subito il nome nuovo.
-- Nessun dato esistente cambia: i movimenti gia' registrati restano col loro
-- nome testuale e id nullo.
alter table public.movimenti_aerei
    add column if not exists aeromobile_catalog_id uuid references public.noleggio_catalog(id) on delete set null;

create index if not exists idx_movimenti_aerei_catalog on public.movimenti_aerei (aeromobile_catalog_id);

comment on column public.movimenti_aerei.aeromobile_catalog_id is
    'Elicottero scelto dal catalogo Noleggio Aria; il nome vivo del catalogo vince su movimenti_aerei.aeromobile.';
