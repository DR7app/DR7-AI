-- =============================================================================
-- Allarmi Pagamenti / Cauzione / Contratto: rilevazioni collegate (01/10/2026)
--
-- Codice: src/utils/allarmi/pagamentiCauzioniContratti.ts (modulo registrato in
-- src/utils/allarmi/index.ts). Si accende SOLO la rilevazione: `is_enabled`
-- resta quello scelto dalla direzione. La condizione `stato_rilevamento =
-- 'in_attesa'` evita di sovrascrivere una riga gia' collegata a mano.
-- =============================================================================

-- ── Pagamenti ────────────────────────────────────────────────────────────────
UPDATE public.system_alarms SET detector = 'pag_x_addebito_aperto:km', stato_rilevamento = 'attivo'
 WHERE id = 'pag_chilometri_extra_non_pagati' AND stato_rilevamento = 'in_attesa';
UPDATE public.system_alarms SET detector = 'pag_x_addebito_aperto:danni', stato_rilevamento = 'attivo'
 WHERE id = 'pag_danno_addebito_ancora_aperto' AND stato_rilevamento = 'in_attesa';
UPDATE public.system_alarms SET detector = 'pag_x_estensione_non_pagata', stato_rilevamento = 'attivo'
 WHERE id = 'pag_estensione_noleggio_non_pagata' AND stato_rilevamento = 'in_attesa';
UPDATE public.system_alarms SET detector = 'pag_x_saldo_residuo', stato_rilevamento = 'attivo'
 WHERE id = 'pag_saldo_residuo_presente' AND stato_rilevamento = 'in_attesa';
UPDATE public.system_alarms SET detector = 'pag_x_scadenza', stato_rilevamento = 'attivo'
 WHERE id = 'pag_pagamento_scadenza' AND stato_rilevamento = 'in_attesa';

-- ── Cauzione ─────────────────────────────────────────────────────────────────
UPDATE public.system_alarms SET detector = 'cauz_inferiore_richiesta', stato_rilevamento = 'attivo'
 WHERE id = 'cau_cauzione_inferiore_all_importo_richiesto' AND stato_rilevamento = 'in_attesa';
UPDATE public.system_alarms SET detector = 'cauz_formula_senza_non_autorizzata', stato_rilevamento = 'attivo'
 WHERE id = 'cau_formula_senza_cauzione_non_ancora_autorizzata' AND stato_rilevamento = 'in_attesa';
UPDATE public.system_alarms SET detector = 'cauz_garanzia_alternativa', stato_rilevamento = 'attivo'
 WHERE id = 'cau_garanzia_alternativa_verificare' AND stato_rilevamento = 'in_attesa';
UPDATE public.system_alarms SET detector = 'cauz_preauth:fallita', stato_rilevamento = 'attivo'
 WHERE id = 'cau_preautorizzazione_fallita' AND stato_rilevamento = 'in_attesa';
UPDATE public.system_alarms SET detector = 'cauz_preauth:rifiutata', stato_rilevamento = 'attivo'
 WHERE id = 'cau_preautorizzazione_rifiutata' AND stato_rilevamento = 'in_attesa';
UPDATE public.system_alarms SET detector = 'cauz_preauth:non_effettuata', stato_rilevamento = 'attivo'
 WHERE id = 'cau_preautorizzazione_non_effettuata' AND stato_rilevamento = 'in_attesa';
UPDATE public.system_alarms SET detector = 'cauz_storno_da_verificare', stato_rilevamento = 'attivo'
 WHERE id = 'cau_storno_cauzione_verificare' AND stato_rilevamento = 'in_attesa';
UPDATE public.system_alarms SET detector = 'cauz_aperta_dopo_chiusura', stato_rilevamento = 'attivo'
 WHERE id = 'cau_pratica_cauzione_ancora_aperta_dopo_chiusura' AND stato_rilevamento = 'in_attesa';
UPDATE public.system_alarms SET detector = 'cauz_da_trattenere', stato_rilevamento = 'attivo'
 WHERE id = 'cau_cauzione_trattenere_temporaneamente' AND stato_rilevamento = 'in_attesa';

-- ── Contratto ────────────────────────────────────────────────────────────────
UPDATE public.system_alarms SET detector = 'contr_inviato_non_aperto', stato_rilevamento = 'attivo'
 WHERE id = 'con_contratto_inviato_non_aperto' AND stato_rilevamento = 'in_attesa';
UPDATE public.system_alarms SET detector = 'contr_firma_incompleta', stato_rilevamento = 'attivo'
 WHERE id = 'con_firma_cliente_incompleta' AND stato_rilevamento = 'in_attesa';
UPDATE public.system_alarms SET detector = 'contr_dati_mancanti', stato_rilevamento = 'attivo'
 WHERE id = 'con_contratto_dati_mancanti' AND stato_rilevamento = 'in_attesa';
UPDATE public.system_alarms SET detector = 'contr_da_rigenerare', stato_rilevamento = 'attivo'
 WHERE id = 'con_contratto_rigenerare' AND stato_rilevamento = 'in_attesa';

-- ── Restano in attesa: il dato non esiste (misurato in produzione 01/10/2026) ─
-- pag_accessori_non_pagati, pag_extra_non_pagati, pag_secondo_conducente_non_pagato,
-- pag_supplemento_under_25_non_pagato, pag_supplemento_patente_recente_non_pagato,
-- pag_consegna_ritiro_fuori_sede_non_pagati:
--     il pagamento e' registrato solo sul totale (payment_breakdown sempre NULL):
--     nessuno stato pagato/non pagato per singola voce.
-- pag_bonifico_non_verificato, pag_bonifico_istantaneo_controllare:
--     nessun campo di verifica bonifico ne' distinzione bonifico istantaneo
--     (payment_method solo "Bonifico"/"Bonifico bancario"), nessun estratto conto.
-- cau_cauzione_restituita_non_confermata:
--     nessun passo di conferma: riferimento_bonifico e data_restituzione_effettiva
--     non sono mai scritti, mark_cauzione_restituita non aggiorna stato_restituzione.
-- con_allegato_contrattuale_mancante, con_condizioni_specifiche_non_accettate,
-- con_consenso_privacy_mancante:
--     nessuna tabella di allegati ne' accettazione separata; bookings.terms_accepted
--     e' sempre false (mai scritto): le clausole stanno solo nel PDF firmato.
