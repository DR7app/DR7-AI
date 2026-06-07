-- Multi-card cascade for addebiti.
-- pending_addebiti.cascade_contract_ids holds an ORDERED list of Nexi
-- contract ids to try in cascade: the charger (process-pending-addebiti)
-- runs the full -10% ladder on the first card, then the next, until one
-- accepts. NULL / absent = single card (use contract_id).
alter table public.pending_addebiti
  add column if not exists cascade_contract_ids jsonb;

comment on column public.pending_addebiti.cascade_contract_ids is
  'Ordered Nexi contract ids to try in cascade (first card that accepts wins). Null = single card (contract_id).';
