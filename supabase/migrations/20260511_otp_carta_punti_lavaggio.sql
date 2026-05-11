-- Aggiunge il limitation_code `carta_punti_lavaggio` usato dal flusso
-- Prime Wash quando il metodo di pagamento è "Carta Punti".
--
-- Il gate è ON per default: ogni prenotazione lavaggio pagata con
-- carta punti richiede un OTP della direzione, consumato dopo il
-- salvataggio (vedi CarWashBookingsTab.createBooking).
--
-- Idempotente: ON CONFLICT (id) DO NOTHING.

INSERT INTO public.system_otp_overrides (id, label, reason, used_in, is_required, sort_order) VALUES
    (
        'carta_punti_lavaggio',
        'Pagamento Carta Punti (Lavaggio)',
        'Pagamento con Carta Punti su una prenotazione Prime Wash richiede autorizzazione direzionale per ogni singola operazione. L''OTP viene consumato dopo il salvataggio, quindi la prossima prenotazione Carta Punti richiederà un nuovo OTP.',
        'Prime Wash > Nuova prenotazione > Metodo pagamento = Carta Punti',
        true,
        130
    )
ON CONFLICT (id) DO NOTHING;
