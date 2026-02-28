-- Allow cauzioni.veicolo_id to be NULL so vehicles can be deleted
-- while preserving cauzione records
ALTER TABLE cauzioni ALTER COLUMN veicolo_id DROP NOT NULL;
