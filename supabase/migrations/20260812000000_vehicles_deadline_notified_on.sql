-- Roadmap #44 — lock giornaliero per gli avvisi di scadenza veicolo.
--
-- Senza questa colonna il cron `vehicle-deadlines-cron` non ha modo di
-- ricordare di aver gia' avvisato per un veicolo: allo staff arriverebbe lo
-- stesso messaggio ogni giorno finche' la scadenza non viene sistemata.
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS deadline_notified_on DATE;

COMMENT ON COLUMN public.vehicles.deadline_notified_on IS
  'Ultimo giorno (Europe/Rome) in cui e'' stato inviato l''avviso di scadenza per questo veicolo. Serve al cron vehicle-deadlines-cron per non ripetere l''avviso piu'' volte nella stessa giornata.';
