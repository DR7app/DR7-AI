-- 18/11/2026: allarme "Servizi extra prenotati".
-- Un cliente ha prenotato dal sito un noleggio con 6 rose e nessuno se n'e'
-- accorto (ne' scheda, ne' calendario, ne' messaggio). Detector
-- servizi_extra_prenotati in src/utils/allarmi/nuovePrenotazioni.ts.
-- Soglia = minuti DOPO la creazione in cui resta aperto se nessuno preme
-- Risolto. ACCESO: richiesto dalla direzione.
insert into public.system_alarms
    (id, label, schedule, reason, category, threshold_value, threshold_unit, is_enabled, sort_order,
     group_key, priority, reparto, detector, stato_rilevamento, ripeti_finche_non_risolto, ripeti_ogni_minuti,
     notifica_gestionale, notifica_push, notifica_whatsapp_interna, notifica_email_interna, destinatari,
     sound_key, suono_continuo, messaggio_cliente_auto)
values
    ('pre_servizi_extra_prenotati', 'Servizi extra prenotati', 'Alla creazione',
     'Il cliente ha prenotato servizi extra (rose, ecc.): preparali prima del ritiro.',
     'booking', 1440, 'minutes_after', true, 2486, 'prenotazioni', 'attenzione', 'Front Office',
     'servizi_extra_prenotati', 'attivo', false, 30, true, false, false, false, '[]'::jsonb, 'classic', true, false)
on conflict (id) do nothing;
