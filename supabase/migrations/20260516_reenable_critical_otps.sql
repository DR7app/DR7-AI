-- ============================================================
-- Riaccende gli OTP critici disattivati il 13 maggio.
--
-- Diagnostica del 16/05: 10 regole erano is_required=false. Risultato:
-- Davide (e chiunque altro) eseguiva azioni sensibili senza OTP.
-- L'utente vuole rimettere il gate sulle azioni critiche.
--
-- Lasciamo OFF:
--   - booking.delete  (richiesta esplicita 12/05: niente OTP per
--                      eliminare un noleggio)
--   - wash.delete     (idem per lavaggio)
-- ============================================================

UPDATE public.system_otp_overrides
SET is_required = true, updated_at = now()
WHERE id IN (
    'paid_rental_modify',
    'paid_wash_modify',
    'out_of_office_hours',
    'slot_unavailable',
    'pickup_in_past',
    'prenotazione_noleggio_conferma',
    'prenotazione_lavaggio_conferma',
    'fattura.send_sdi'
);

-- Verifica:
SELECT id, label, is_required, updated_at
FROM public.system_otp_overrides
WHERE id IN (
    'paid_rental_modify', 'paid_wash_modify', 'out_of_office_hours',
    'slot_unavailable', 'pickup_in_past',
    'prenotazione_noleggio_conferma', 'prenotazione_lavaggio_conferma',
    'fattura.send_sdi', 'booking.delete', 'wash.delete'
)
ORDER BY is_required DESC, id;
