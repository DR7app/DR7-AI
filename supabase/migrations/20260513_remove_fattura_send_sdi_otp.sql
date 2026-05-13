-- Rimuove l'OTP gate per l'invio fattura a SDI su richiesta direzione 2026-05-13.
-- L'invio al SDI non richiede piu' autorizzazione direzionale.
--
-- Idempotente: cancella la riga se esiste, no-op se gia' rimossa.

DELETE FROM public.system_otp_overrides
 WHERE id = 'fattura.send_sdi';
