-- 06/10/2026 (direzione): risposta dell'investitore al WhatsApp
-- "Autorizzazione nome sul sito" (pro_investitore_autorizzazione_nome).
-- null = nessuna risposta (non pubblicato), 'autorizzato' = nome nell'elenco
-- azionisti del sito (site_copy.investitori.ir_azionisti, id inv-<uuid>),
-- 'riservato' = non compare. Lo imposta l'admin con i pulsanti della tab.
alter table public.investitori
  add column if not exists pubblicazione_nome text
  check (pubblicazione_nome is null or pubblicazione_nome in ('autorizzato', 'riservato'));
