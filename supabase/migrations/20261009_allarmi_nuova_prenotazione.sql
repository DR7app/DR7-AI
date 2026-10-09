-- 09/10/2026: allarme "Nuova prenotazione <servizio>" e scelta di chi lo riceve.
-- La direzione crea una prenotazione (es. lavaggio) e il personale di quel
-- reparto deve avere subito la finestra con il suono.

-- Chi riceve la finestra: user_id degli operatori. Vuoto = tutti (come prima).
alter table public.system_alarms add column if not exists riceventi text[] not null default '{}';

-- Un detector (booking_creata, src/utils/allarmi/nuovePrenotazioni.ts), sei righe.
-- Soglia = minuti DOPO la creazione in cui l'allarme resta aperto se nessuno
-- preme Risolto. Spente: si accendono da Centralina Pro > Allarmi.
insert into public.system_alarms
    (id, label, schedule, reason, category, threshold_value, threshold_unit, is_enabled, sort_order,
     group_key, priority, reparto, detector, stato_rilevamento, ripeti_finche_non_risolto, ripeti_ogni_minuti,
     notifica_gestionale, notifica_push, notifica_whatsapp_interna, notifica_email_interna, destinatari,
     sound_key, suono_continuo, messaggio_cliente_auto)
values
    ('pre_nuova_prenotazione_noleggio',  'Nuova prenotazione Noleggio',  'Alla creazione', 'Nuova prenotazione di noleggio creata — reparto Front Office.', 'booking', 1440, 'minutes_after', false, 2480, 'prenotazioni', 'attenzione', 'Front Office', 'booking_creata:noleggio',  'attivo', false, 30, true, false, false, false, '[]'::jsonb, 'classic', true, false),
    ('pre_nuova_prenotazione_lavaggio',  'Nuova prenotazione Lavaggio',  'Alla creazione', 'Nuova prenotazione di lavaggio creata — reparto Lavaggio.',       'booking', 1440, 'minutes_after', false, 2481, 'prenotazioni', 'attenzione', 'Lavaggio',     'booking_creata:lavaggio',  'attivo', false, 30, true, false, false, false, '[]'::jsonb, 'classic', true, false),
    ('pre_nuova_prenotazione_meccanica', 'Nuova prenotazione Meccanica', 'Alla creazione', 'Nuova prenotazione di meccanica creata — reparto Officina.',      'booking', 1440, 'minutes_after', false, 2482, 'prenotazioni', 'attenzione', 'Officina',     'booking_creata:meccanica', 'attivo', false, 30, true, false, false, false, '[]'::jsonb, 'classic', true, false),
    ('pre_nuova_prenotazione_mare',      'Nuova prenotazione Mare',      'Alla creazione', 'Nuova prenotazione Noleggio Mare creata.',                         'booking', 1440, 'minutes_after', false, 2483, 'prenotazioni', 'attenzione', 'Front Office', 'booking_creata:mare',      'attivo', false, 30, true, false, false, false, '[]'::jsonb, 'classic', true, false),
    ('pre_nuova_prenotazione_aria',      'Nuova prenotazione Aria',      'Alla creazione', 'Nuova prenotazione Aria (elicottero) creata.',                     'booking', 1440, 'minutes_after', false, 2484, 'prenotazioni', 'attenzione', 'Front Office', 'booking_creata:aria',      'attivo', false, 30, true, false, false, false, '[]'::jsonb, 'classic', true, false),
    ('pre_nuova_prenotazione_soggiorni', 'Nuova prenotazione Soggiorni', 'Alla creazione', 'Nuova prenotazione Soggiorni creata.',                             'booking', 1440, 'minutes_after', false, 2485, 'prenotazioni', 'attenzione', 'Front Office', 'booking_creata:soggiorni', 'attivo', false, 30, true, false, false, false, '[]'::jsonb, 'classic', true, false)
on conflict (id) do nothing;
