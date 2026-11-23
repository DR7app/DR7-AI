-- 23/11/2026 (direzione): il messaggio "Ritiro spazzatura" (tab Immondizia)
-- deve poter partire anche per email, oltre che su WhatsApp.
-- Colonna facoltativa: indirizzi separati da virgola o a capo.
-- Il codice funziona anche prima di questa migrazione (campo email nascosto).
alter table public.system_messages
  add column if not exists recipient_emails text;
