-- Add 'out_of_office_hours' to system_otp_overrides so admin can toggle
-- whether picking a FUORI ORARIO slot in PreventiviTab/ReservationsTab
-- requires OTP approval.
INSERT INTO public.system_otp_overrides (id, label, reason, used_in, is_required, sort_order)
VALUES (
  'out_of_office_hours',
  'Orario Fuori Apertura',
  'Slot di ritiro o riconsegna fuori dagli orari standard di apertura (Pickup Mon-Ven 10:30-12:30/16:30-18:30, Sab 10:30-16:30; Return Mon-Ven 09:00-11:00/15:00-17:00, Sab 09:00-15:00). Override richiede approvazione direttore.',
  'Preventivo + Prenotazione (selezione orario)',
  true,
  85
)
ON CONFLICT (id) DO NOTHING;
