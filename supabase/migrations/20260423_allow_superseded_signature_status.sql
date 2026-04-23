-- ROOT CAUSE: The signature_requests.status CHECK constraint only allows
-- ('pending','otp_sent','otp_verified','signed','expired','cancelled').
-- generate-contract.ts writes status='superseded' to invalidate old signatures
-- after a booking modification — but the write was SILENTLY FAILING the CHECK
-- constraint, leaving the old signatures active. The customer could then click
-- a stale WhatsApp link and sign a pre-modification contract.
--
-- This migration extends the constraint to include 'superseded'.

ALTER TABLE public.signature_requests
  DROP CONSTRAINT IF EXISTS signature_requests_status_check;

ALTER TABLE public.signature_requests
  ADD CONSTRAINT signature_requests_status_check
  CHECK (status IN (
    'pending',
    'otp_sent',
    'otp_verified',
    'signed',
    'expired',
    'cancelled',
    'superseded'
  ));

COMMENT ON CONSTRAINT signature_requests_status_check ON public.signature_requests IS
  'Adds superseded state so generate-contract.ts can invalidate old signatures when a booking is modified and a new contract version is generated.';
