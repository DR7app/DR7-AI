-- Aggiunge due limitation_code per il confirm delle prenotazioni:
-- noleggio e lavaggio. Toggle attivabile dalla tab Gestione OTP.
-- Idempotente: ON CONFLICT (id) DO NOTHING.

INSERT INTO public.system_otp_overrides (id, label, reason, used_in, is_required, sort_order) VALUES
    (
        'prenotazione_noleggio_conferma',
        'Conferma Prenotazione Noleggio',
        'Quando attivo, l''admin deve passare per OTP della direzione prima di marcare una prenotazione noleggio come confermata.',
        'Prenotazioni Noleggio (azione: Conferma)',
        false,
        110
    ),
    (
        'prenotazione_lavaggio_conferma',
        'Conferma Prenotazione Lavaggio',
        'Quando attivo, l''admin deve passare per OTP della direzione prima di marcare una prenotazione Prime Wash come confermata.',
        'Prime Wash (azione: Conferma)',
        false,
        120
    )
ON CONFLICT (id) DO NOTHING;
