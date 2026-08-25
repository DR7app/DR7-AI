-- ============================================================
-- Via l'OTP sulle dimensioni del Calendario Noleggio (25/08/2026)
--
-- Direzione: cambiare larghezza colonne e altezza righe e' un'operazione di
-- tutti i giorni e si annulla con "Reset auto". Chiedere un codice a ogni
-- ritocco non proteggeva niente: rallentava e basta.
--
-- La riga viene TOLTA dal catalogo OTP invece di essere messa a
-- is_required = false: il gate non esiste piu' nel codice, quindi una riga
-- attiva in Gestione OTP prometterebbe un controllo che nessuno applica.
--
-- Le dimensioni salvate NON si toccano: restano in app_settings
-- (calendar_noleggio_layout e calendar_noleggio_layout__<service_type>).
-- ============================================================

DELETE FROM public.system_otp_overrides
WHERE id = 'calendario_noleggio_layout';

-- Verifica: deve restituire zero righe.
SELECT id, label, is_required
FROM public.system_otp_overrides
WHERE id = 'calendario_noleggio_layout';
