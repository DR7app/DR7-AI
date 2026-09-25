-- 25/09/2026 — Firma: il contratto si apre solo dopo il codice inviato al
-- recapito registrato, e il cambio di dispositivo lo autorizza lo staff.
--
-- Solo aggiunte (colonne nullable). Chi scrive:
-- - signature-sicurezza (gestionale): azione 'autorizza_cambio' → rebind_authorized_*
-- - dr7trust.com signature-verify-otp: consuma l'autorizzazione quando il nuovo
--   dispositivo verifica il codice (le rimette a NULL e lega il nuovo dispositivo).

alter table public.signature_requests
  add column if not exists rebind_authorized_at timestamptz,
  add column if not exists rebind_authorized_by text;

comment on column public.signature_requests.rebind_authorized_at is
  'Cambio dispositivo autorizzato dallo staff: per 30 minuti un nuovo dispositivo puo'' legarsi al link dopo il codice inviato al recapito registrato. NULL dopo l''uso.';
comment on column public.signature_requests.rebind_authorized_by is
  'Email dello staff che ha autorizzato il cambio dispositivo in corso.';
