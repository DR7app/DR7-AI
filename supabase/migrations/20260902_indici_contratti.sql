-- Contratti: gli indici che mancavano all'elenco (02/09/2026)
--
-- La tab Contratti chiede al server una pagina per volta, ordinata per
-- `updated_at` e con lo stato firma preso da `signature_requests`. Su
-- `contracts` pero' non c'e' MAI stato un indice su `updated_at`: ogni
-- pagina ordinava da capo tutte le righe. E le firme si cercano anche per
-- `booking_id`, colonna senza indice: una scansione completa per ogni
-- pagina aperta.
--
-- Nessun indice cambia i dati o i risultati: cambiano solo i tempi.
-- Su tabelle di queste dimensioni la creazione e' immediata.

-- Elenco contratti: ORDER BY updated_at DESC + LIMIT/OFFSET
create index if not exists contracts_updated_at_desc_idx
  on public.contracts (updated_at desc);

-- Filtro periodo Da/A della tab, che guarda created_at
create index if not exists contracts_created_at_desc_idx
  on public.contracts (created_at desc);

-- Stato firma: la ricerca per prenotazione (quella per contract_id ha gia'
-- idx_signature_requests_contract)
create index if not exists signature_requests_booking_id_idx
  on public.signature_requests (booking_id);
