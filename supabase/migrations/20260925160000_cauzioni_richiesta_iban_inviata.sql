-- Richiesta IBAN: quando e' partita per questa cauzione.
-- 25/09/2026: la cauzione pagata col link Nexi veniva segnata Incassata ma la
-- Richiesta IBAN non partiva (solo il tasto "Segna incassata" la mandava).
-- La colonna permette (1) di mandarla una volta sola qualunque sia la strada
-- che incassa, (2) al cron di recuperare le cauzioni rimaste senza richiesta.
alter table public.cauzioni
  add column if not exists richiesta_iban_inviata_at timestamptz;

-- Le cauzioni gia' incassate prima di oggi non vanno ripescate dal cron:
-- quelle col tasto hanno gia' avuto il messaggio, le vecchie non interessano.
update public.cauzioni
   set richiesta_iban_inviata_at = coalesce(data_incasso, updated_at, now())
 where data_incasso is not null
   and richiesta_iban_inviata_at is null;
