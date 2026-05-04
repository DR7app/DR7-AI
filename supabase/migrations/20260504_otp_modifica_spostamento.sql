-- Aggiunge due limitation_code per modifiche e spostamenti di prenotazioni
-- già PAGATE o CONFERMATE (noleggio + lavaggio/meccanica).
-- Valerio (valerio@dr7.app) e Ilenia (ilenia@dr7.app) bypassano automaticamente
-- (DIREZIONE_EMAILS allowlist server-side).
-- Toggle attivabile dalla tab Gestione OTP. Idempotente.

INSERT INTO public.system_otp_overrides (id, label, reason, used_in, is_required, sort_order) VALUES
    (
        'paid_rental_modify',
        'Modifica / Spostamento Noleggio Pagato o Confermato',
        'Quando attivo, qualsiasi modifica o spostamento di una prenotazione noleggio già pagata (paid/completed/succeeded) o confermata (confirmed/active/in_corso) richiede OTP della direzione. Valerio e Ilenia bypassano automaticamente.',
        'Prenotazioni Noleggio (azioni: Modifica + Spostamento date)',
        true,
        130
    ),
    (
        'paid_wash_modify',
        'Modifica / Spostamento Lavaggio Pagato o Confermato',
        'Quando attivo, qualsiasi modifica o spostamento di una prenotazione Prime Wash (lavaggio o meccanica) già pagata o confermata richiede OTP della direzione. Valerio e Ilenia bypassano automaticamente.',
        'Prime Wash (azioni: Modifica + Spostamento appuntamento)',
        true,
        140
    )
ON CONFLICT (id) DO NOTHING;
