-- =============================================================================
-- Scadenza cauzione — FASE 3 (calcolo scadenza) + FASE 4 (template messaggio)
-- Richiede 20260722_cauzione_scadenza_rimborso.sql (config + colonne).
-- =============================================================================

-- ── FASE 3: scadenza = data riconsegna + N giorni di CALENDARIO ─────────────
-- Prima: 14 giorni LAVORATIVI (calculate_business_days_excluding_holidays).
-- Adesso: N giorni di calendario, N da cauzioni_config (default 15), con
-- override manuale che vince sempre (scadenza_forzata_manualmente).
CREATE OR REPLACE FUNCTION auto_calculate_scadenza_cauzione()
RETURNS TRIGGER AS $$
DECLARE
  v_giorni INTEGER;
BEGIN
  -- Override manuale: se l'operatore ha forzato la scadenza, non toccarla piu'.
  IF NEW.scadenza_forzata_manualmente IS TRUE THEN
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;

  IF (TG_OP = 'INSERT' OR NEW.data_restituzione_veicolo IS DISTINCT FROM OLD.data_restituzione_veicolo)
     AND NEW.stato NOT IN ('Restituita', 'Sbloccata', 'Incassata', 'Bloccata', 'Danno') THEN
    SELECT COALESCE(giorni_restituzione_default, 15) INTO v_giorni
      FROM public.cauzioni_config WHERE id = 'main';
    IF v_giorni IS NULL THEN v_giorni := 15; END IF;
    NEW.scadenza_cauzione := NEW.data_restituzione_veicolo + (v_giorni || ' days')::interval;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── FASE 4: template messaggio SCADENZA_CAUZIONE (3 varianti) ────────────────
-- Modellati come gli altri pro_* di Messaggi di Sistema Pro: editabili, on/off,
-- send_hour 8, cron_approved=false (spenti finche' l'admin non li attiva).
-- La riga Banca / Trattenute nel corpo si stampa solo se il valore esiste:
-- questa logica di soppressione condizionale vive nel cron (le {{var}} vuote
-- fanno sparire la riga), non nel testo statico.
INSERT INTO public.system_messages
  (message_key, label, description, message_body, is_automatic, is_enabled, cron_approved, trigger_event, send_hour)
VALUES
  ('pro_scadenza_cauzione_a',
   'Scadenza Cauzione — Bonifico (Variante A)',
   'Avviso a Ilenia/Valerio il giorno della scadenza: caso normale, restituzione via bonifico.',
   E'🔔 Scadenza cauzione – Oggi\n\nÈ in scadenza oggi la restituzione della cauzione.\n\nCliente: {{cliente}}\nContratto: {{numero_contratto}} — {{veicolo}} ({{targa}})\nRiconsegna: {{data_riconsegna}}\n\nIntestatario bonifico: {{intestatario_rimborso}}\nImporto da restituire: € {{importo_da_restituire}}\nIBAN: {{iban_rimborso}}\nBanca: {{banca}}\n\nCauzione incassata: € {{importo_cauzione}}\nTrattenute applicate: € {{importo_trattenuto}}\n\nVerificare la pratica e procedere con il bonifico di restituzione, se dovuto.',
   true, true, false, 'on_scadenza_cauzione', 8),
  ('pro_scadenza_cauzione_b',
   'Scadenza Cauzione — IBAN mancante (Variante B)',
   'Avviso il giorno della scadenza quando manca un IBAN valido: impossibile procedere al bonifico.',
   E'🔔⚠️ Scadenza cauzione – Oggi\nIBAN MANCANTE — impossibile procedere al bonifico\n\nCliente: {{cliente}}\nContratto: {{numero_contratto}} — {{veicolo}} ({{targa}})\nImporto da restituire: € {{importo_da_restituire}}\n\nInserire l''IBAN e l''intestatario nella scheda cauzione, poi procedere con il bonifico.',
   true, true, false, 'on_scadenza_cauzione', 8),
  ('pro_scadenza_cauzione_c',
   'Scadenza Cauzione — Pre-autorizzazione (Variante C)',
   'Avviso il giorno della scadenza quando la cauzione e in pre-autorizzazione su carta: nessun bonifico, solo svincolo.',
   E'🔔 Scadenza cauzione – Oggi\nCauzione in PRE-AUTORIZZAZIONE su carta — nessun bonifico da eseguire.\n\nCliente: {{cliente}}\nContratto: {{numero_contratto}} — {{veicolo}} ({{targa}})\nImporto bloccato: € {{importo_cauzione}}\n\nProcedere allo svincolo della pre-autorizzazione, se dovuto.',
   true, true, false, 'on_scadenza_cauzione', 8)
ON CONFLICT (message_key) DO NOTHING;
