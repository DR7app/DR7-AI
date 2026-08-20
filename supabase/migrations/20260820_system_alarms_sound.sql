-- Suono per allarme.
--
-- Richiesta direzione (20/08/2026): i 13 allarmi suonavano tutti con lo stesso
-- /alarm.mp3, quindi ascoltandolo non si capiva se fosse una riconsegna in
-- ritardo o una revisione in scadenza. Ora ogni riga sceglie il suo suono.
--
-- Valori ammessi: classic (l'mp3 storico), beep, doppio, campanello, sirena, soft.
-- Default 'classic' = nessun cambiamento per chi non tocca niente.
ALTER TABLE public.system_alarms
  ADD COLUMN IF NOT EXISTS sound_key TEXT NOT NULL DEFAULT 'classic';

ALTER TABLE public.system_alarms DROP CONSTRAINT IF EXISTS system_alarms_sound_key_check;
ALTER TABLE public.system_alarms ADD CONSTRAINT system_alarms_sound_key_check
  CHECK (sound_key IN ('classic', 'beep', 'doppio', 'campanello', 'sirena', 'soft'));

COMMENT ON COLUMN public.system_alarms.sound_key IS
  'Suono dell allarme. I pattern sono sintetizzati in src/utils/alarmSounds.ts; classic usa /alarm.mp3.';

-- Verifica
SELECT id, label, sound_key FROM public.system_alarms ORDER BY sort_order;
