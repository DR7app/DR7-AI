-- ============================================================================
-- GADGET IN OMAGGIO (26/10/2026, direzione)
--
-- Bottone "Gadget" sulle prenotazioni di ogni servizio (ReservationsTab):
-- WhatsApp al cliente con il template qui sotto, una sola volta per persona
-- (telefono o email, come la richiesta di recensione). L'invio si registra
-- in bookings.booking_details.gadget_omaggio. Testo modificabile in
-- Messaggi di Sistema Pro > Marketing > "Gadget in Omaggio".
-- ============================================================================

INSERT INTO public.system_messages
  (message_key, label, description, message_body, is_automatic, is_enabled, include_header,
   target_service_type, handled_events)
SELECT 'pro_marketing_gadget_omaggio',
       'Gadget in Omaggio',
       'WhatsApp al cliente dal bottone "Gadget" della prenotazione (ogni servizio), una sola volta per cliente — token: {nome}',
       E'Buongiorno {nome}\n\nTroverà in auto alcuni gadget DR7 in omaggio.\n\nUn piccolo pensiero per lei!\n\nDR7',
       false, true, false, 'all', ARRAY['gadget_omaggio']::text[]
WHERE NOT EXISTS (SELECT 1 FROM public.system_messages WHERE message_key = 'pro_marketing_gadget_omaggio');
