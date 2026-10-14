-- 14/10/2026 — Posizione della firma scelta dallo staff (tab DR7 Trust).
-- {"pagina": 1, "x": 0.12, "y": 0.80}: pagina 1-based, x/y = angolo in alto
-- a sinistra del sigillo in frazione della pagina (origine in alto a sinistra).
-- NULL = posizione automatica di sempre (ultima pagina).
alter table public.signature_requests
    add column if not exists posizione_firma jsonb;

comment on column public.signature_requests.posizione_firma is
    'Posizione del sigillo DR7 Trust scelta dallo staff: {pagina (1-based), x, y} in frazione della pagina, origine in alto a sinistra. NULL = automatica.';
