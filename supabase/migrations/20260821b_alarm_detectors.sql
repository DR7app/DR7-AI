-- ============================================================
-- Allarmi: collega le voci del catalogo alle rilevazioni scritte.
--
-- 2026-08-21, secondo passo. La migration precedente ha creato il catalogo
-- (307 righe) con tutte le voci "in attesa": visibili e configurabili, ma
-- mute, perche' la rilevazione e' codice. Qui si accende cio' che il codice
-- sa davvero riconoscere con i dati che il gestionale ha OGGI
-- (src/utils/alarmDetectors.ts).
--
-- Perche' non tutte: alcune voci chiedono dati che non esistono ancora in
-- nessuna tabella (foto e video di pre-consegna, battistrada, CID/CAI,
-- pedaggi, ricambi ordinati). Accenderle vorrebbe dire promettere una
-- sorveglianza che non c'e'. Restano in attesa e il gestionale lo dichiara.
--
-- Doppioni voluti: "Ritiro tra 60 / 30 / 10 minuti" sono tre righe con la
-- STESSA rilevazione e anticipi diversi — e' l'escalation chiesta dalla
-- direzione. Doppioni NON voluti (due etichette per lo stesso identico
-- controllo, es. "Bonifico atteso" e "Bonifico non verificato") ne accendono
-- una sola: l'altra resta in attesa, per non far suonare due volte lo stesso
-- fatto.
-- ============================================================

UPDATE public.system_alarms AS s
SET detector = v.det, stato_rilevamento = 'attivo'
FROM (VALUES
  -- 1. Ritiro / uscita veicolo
  ('rit_ritiro_cliente_arrivo',                       'pickup_lead'),
  ('rit_ritiro_tra_60_minuti',                        'pickup_lead'),
  ('rit_ritiro_tra_30_minuti',                        'pickup_lead'),
  ('rit_ritiro_tra_10_minuti',                        'pickup_lead'),
  ('rit_orario_ritiro_raggiunto',                     'pickup_overdue'),
  ('rit_cliente_non_ancora_arrivato',                 'pickup_overdue'),
  ('rit_veicolo_ancora_associato_noleggio_precedente','pickup_vehicle_busy'),
  ('rit_veicolo_precedente_non_ancora_riconsegnato',  'pickup_prev_not_returned'),
  ('rit_lavaggio_veicolo_non_completato',             'pickup_wash_pending'),
  ('rit_indirizzo_consegna_mancante',                 'pickup_missing:indirizzo'),
  ('rit_autista_consegna_non_assegnato',              'pickup_missing:autista'),
  ('rit_operatore_consegna_non_assegnato',            'pickup_missing:operatore'),

  -- 2. Contratto
  ('con_contratto_non_generato',                      'contract_missing'),
  ('con_contratto_generato_non_inviato',              'contract_not_sent'),
  ('con_contratto_aperto_non_firmato',                'contract_unsigned'),
  ('con_contratto_non_firmato_60_minuti_dal_ritiro',  'contract_unsigned'),
  ('con_contratto_non_firmato_30_minuti_dal_ritiro',  'contract_unsigned'),
  ('con_contratto_non_firmato_10_minuti_dal_ritiro',  'contract_unsigned'),
  ('con_orario_ritiro_raggiunto_contratto_non_firmato','contract_unsigned'),
  ('con_firma_secondo_conducente_mancante',           'contract_second_signature_missing'),
  ('con_contratto_modificato_dopo_firma',             'contract_changed_after_sign'),

  -- 3. Documenti cliente
  ('doc_carta_d_identita_mancante',                   'doc_missing:identita'),
  ('doc_patente_mancante',                            'doc_missing:patente'),
  ('doc_codice_fiscale_mancante',                     'customer_missing:codice_fiscale'),
  ('doc_email_mancante',                              'customer_missing:email'),
  ('doc_numero_telefonico_mancante',                  'customer_missing:telefono'),
  ('doc_indirizzo_residenza_mancante',                'customer_missing:indirizzo'),

  -- 4. Pagamenti
  ('pag_noleggio_non_pagato',                         'payment_open:totale'),
  ('pag_noleggio_parzialmente_pagato',                'payment_open:parziale'),
  ('pag_orario_ritiro_raggiunto_pagamento_non_completo','payment_open'),
  ('pag_link_pagamento_non_inviato',                  'payment_link:mancante'),
  ('pag_link_pagamento_inviato_non_pagato',           'payment_link:inviato'),
  ('pag_link_pagamento_scaduto',                      'payment_link:scaduto'),
  ('pag_pagamento_fallito',                           'payment_failed:fallito'),
  ('pag_pagamento_rifiutato',                         'payment_failed:rifiutato'),
  ('pag_bonifico_atteso',                             'payment_bonifico_pending'),

  -- 5. Cauzione
  ('cau_cauzione_richiesta_non_incassata',            'deposit_uncollected'),
  ('cau_ritiro_tra_60_minuti_cauzione_mancante',      'deposit_uncollected'),
  ('cau_ritiro_tra_10_minuti_cauzione_mancante',      'deposit_uncollected'),
  ('cau_orario_ritiro_raggiunto_cauzione_mancante',   'deposit_uncollected'),
  ('cau_scadenza_restituzione_cauzione_vicina',       'deposit_return_due:vicina'),
  ('cau_termine_restituzione_cauzione_raggiunto',     'deposit_return_due:raggiunta'),
  ('cau_termine_restituzione_cauzione_superato',      'deposit_return_due:superata'),
  ('cau_cauzione_restituire',                         'deposit_action_due:restituire'),
  ('cau_cauzione_sbloccare',                          'deposit_action_due:sbloccare'),

  -- 6. Riconsegna
  ('ric_riconsegna_prevista_tra_60_minuti',           'return_lead'),
  ('ric_riconsegna_prevista_tra_30_minuti',           'return_lead'),
  ('ric_orario_riconsegna_raggiunto',                 'return_overdue'),
  ('ric_cliente_ritardo_30_minuti',                   'return_overdue'),
  ('ric_cliente_ritardo_60_minuti',                   'return_overdue'),
  ('ric_riconsegna_gravemente_ritardo',               'return_overdue'),
  ('ric_nuovo_cliente_attende_stesso_veicolo',        'return_blocks_next'),
  ('ric_contratto_scaduto_veicolo_ancora_fuori',      'return_contract_expired'),
  ('ric_veicolo_riconsegnato_pratica_ancora_aperta',  'return_practice_open'),

  -- 9. Lavaggi clienti  (i 10 minuti li copre gia' l'allarme storico car_wash)
  ('lav_lavaggio_tra_60_minuti',                      'wash_lead'),
  ('lav_lavaggio_tra_30_minuti',                      'wash_lead'),
  ('lav_cliente_lavaggio_ritardo',                    'wash_late'),
  ('lav_lavaggio_non_pagato',                         'wash_unpaid'),

  -- 13. Scadenze veicolo  (le tre "in scadenza" sono gia' gli allarmi storici)
  ('sca_assicurazione_scaduta',                       'vehicle_expired:insurance_expiry'),
  ('sca_bollo_scaduto',                               'vehicle_expired:tax_expiry'),
  ('sca_revisione_veicolo_scaduta',                   'vehicle_expired:inspection_expiry'),
  ('sca_leasing_rata_scadenza',                       'vehicle_expiry:leasing_expiry'),

  -- 15. Chilometraggio
  ('km_chilometraggio_veicolo_non_aggiornato',        'vehicle_km_stale'),

  -- 16. Prenotazioni / calendario
  ('pre_prenotazione_senza_veicolo_assegnato',        'booking_no_vehicle'),
  ('pre_sovrapposizione_prenotazioni',                'booking_overlap'),
  ('pre_tempo_insufficiente_tra_due_noleggi',         'booking_gap_short'),
  ('pre_tempo_insufficiente_lavaggio_tra_due_noleggi','booking_gap_short'),
  ('pre_prenotazione_senza_pagamento',                'booking_missing:pagamento'),
  ('pre_prenotazione_senza_contratto',                'booking_missing:contratto'),
  ('pre_prenotazione_senza_cauzione',                 'booking_missing:cauzione'),
  ('pre_prenotazione_senza_documenti',                'booking_missing:documenti'),
  ('pre_prenotazione_imminente_pratica_incompleta',   'booking_missing:tutto'),
  ('pre_veicolo_segnato_indisponibile_presente_prenotazione','booking_vehicle_unavailable:indisponibile'),
  ('pre_veicolo_officina_presente_prenotazione',      'booking_vehicle_unavailable:officina'),

  -- 17. Fatturazione
  ('fat_fattura_generare',                            'invoice_missing')
) AS v(id, det)
WHERE s.id = v.id;

-- ── Soglie che l'etichetta non poteva dire ────────────────────
-- Il catalogo ha dedotto l'anticipo dal testo ("tra 60 minuti" -> 60). Dove il
-- testo non lo diceva, il valore di partenza va scelto: sono tutti comunque
-- modificabili dal gestionale.
UPDATE public.system_alarms SET threshold_value = 180, threshold_unit = 'minutes_after'
  WHERE id = 'ric_riconsegna_gravemente_ritardo';
UPDATE public.system_alarms SET threshold_value = 180, threshold_unit = 'minutes_before'
  WHERE id = 'pre_tempo_insufficiente_lavaggio_tra_due_noleggi';
UPDATE public.system_alarms SET threshold_value = 60, threshold_unit = 'minutes_before'
  WHERE id = 'pre_prenotazione_imminente_pratica_incompleta';
UPDATE public.system_alarms SET threshold_value = 30, threshold_unit = 'days'
  WHERE id = 'km_chilometraggio_veicolo_non_aggiornato';
UPDATE public.system_alarms SET threshold_value = 0, threshold_unit = 'days'
  WHERE id IN ('cau_cauzione_restituire', 'cau_cauzione_sbloccare');

-- ── Priorita' che meritano di essere alzate ───────────────────
-- Dedotte dal testo, ma queste tre bloccano una consegna: vanno viste subito.
UPDATE public.system_alarms SET priority = 'bloccante'
  WHERE id IN ('con_orario_ritiro_raggiunto_contratto_non_firmato',
               'pag_orario_ritiro_raggiunto_pagamento_non_completo',
               'pre_sovrapposizione_prenotazioni');

-- Verifica
SELECT stato_rilevamento, count(*) FROM public.system_alarms GROUP BY 1 ORDER BY 1;
SELECT group_key, count(*) FILTER (WHERE stato_rilevamento = 'attivo') AS con_rilevazione, count(*) AS totale
FROM public.system_alarms GROUP BY group_key ORDER BY group_key;
