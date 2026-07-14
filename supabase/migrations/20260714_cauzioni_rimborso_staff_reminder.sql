-- ============================================
-- CAUZIONI: promemoria staff (Valerio/Ilenia) alla scadenza
-- ============================================
-- Il giorno esatto della scadenza di una cauzione bonifico, il cron manda a
-- Valerio e Ilenia un riepilogo WhatsApp con importo/intestatario/IBAN cosi'
-- possono fare il bonifico manuale. Parte SOLO se il template e' is_enabled +
-- cron_approved (toggle ON/OFF in Messaggi di Sistema Pro), come gli altri
-- promemoria — nessun invio di massa non voluto.

-- 1) Colonna anti-doppio-invio: data (Rome) in cui la cauzione e' gia' stata
--    inclusa in un promemoria staff. Il cron esclude chi ha gia' oggi.
ALTER TABLE cauzioni
    ADD COLUMN IF NOT EXISTS rimborso_reminder_sent_on DATE;

COMMENT ON COLUMN cauzioni.rimborso_reminder_sent_on IS 'Data (Rome) ultimo promemoria staff rimborso inviato — evita doppio invio giornaliero';

-- 2) Template toggle in Messaggi di Sistema Pro. cron_approved=false di default:
--    non parte finche' l'admin non lo attiva.
INSERT INTO system_messages (message_key, label, description, message_body, is_automatic, is_enabled, cron_approved, trigger_event, send_hour)
VALUES (
    'pro_cauzioni_rimborso_staff',
    'Promemoria Rimborso Cauzioni (Staff)',
    'Riepilogo giornaliero a Valerio/Ilenia delle cauzioni bonifico in scadenza oggi da restituire manualmente.',
    E'DR7 — Cauzioni da restituire OGGI ({data})\n\nCi sono {count} cauzioni da rimborsare via bonifico (totale € {totale}):\n\n{lista}\n\nEffettua i bonifici e segna "Restituita" nel gestionale.',
    true,
    true,
    false,
    'on_cauzione_rimborso_staff',
    9
)
ON CONFLICT (message_key) DO NOTHING;
