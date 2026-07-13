-- 2026-07-13: conserva l'immagine della firma autografa su signature_requests,
-- così l'estensione può RISTAMPARE la firma originale sul contratto con le
-- nuove date (arriva già firmato, senza chiedere una nuova firma).
alter table public.signature_requests
    add column if not exists signature_image   text,
    add column if not exists signature_image_2 text;

comment on column public.signature_requests.signature_image   is 'Base64 data URL firma 1o guidatore (per riconduzione estensione)';
comment on column public.signature_requests.signature_image_2 is 'Base64 data URL firma 2o guidatore (per riconduzione estensione)';
