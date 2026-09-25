-- 25/09/2026: il link di firma appartiene al primo dispositivo che lo apre.
-- La pagina di firma (DR7 Trust) genera un identificativo casuale e lo tiene
-- nel browser; al primo accesso si scrive qui, dopo ogni altro dispositivo
-- viene respinto (niente contratto, niente OTP, niente firma). Per un altro
-- dispositivo lo staff rimanda il link: signature-init crea un token nuovo.
alter table public.signature_requests
  add column if not exists device_id text,
  add column if not exists device_bound_at timestamptz;
