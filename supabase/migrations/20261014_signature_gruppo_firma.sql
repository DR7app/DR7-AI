-- 14/10/2026 — Documento libero inviato a piu' firmatari dalla tab DR7 Trust.
-- Stesso gruppo_firma = UN documento: le firme si accumulano sullo stesso PDF
-- e la copia firmata parte a tutti solo quando hanno firmato tutti.
-- NULL = firmatario singolo (o invii precedenti).
alter table public.signature_requests
    add column if not exists gruppo_firma uuid;

create index if not exists signature_requests_gruppo_firma_idx
    on public.signature_requests (gruppo_firma)
    where gruppo_firma is not null;
