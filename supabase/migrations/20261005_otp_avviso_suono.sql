-- 05/10/2026 (direzione): i popup di avviso (avviso_slot_occupato,
-- avviso_ritiro_passato) scelgono il loro suono da Centralina Pro >
-- Gestione OTP. NULL = default del codice (sirena in loop).
ALTER TABLE public.system_otp_overrides
  ADD COLUMN IF NOT EXISTS sound_key text,
  ADD COLUMN IF NOT EXISTS sound_loop boolean;
