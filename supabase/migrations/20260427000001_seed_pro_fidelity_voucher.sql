-- Fidelity Card auto-voucher message: fired when a Prime Wash customer
-- crosses 250 punti. Body lives in Messaggi di Sistema Pro so the admin can
-- tweak the wording without a redeploy. The legacy key
-- `fidelity_voucher_whatsapp` is routed to this row by the OLD_TO_PRO map
-- in `netlify/functions/utils/messageTemplates.ts`.
--
-- Placeholders the function passes:
--   {nome}           — first name of the customer
--   {customer_name}  — full name
--   {code}           — voucher code (DR7-XXXX-XXXX)
--   {amount}         — voucher amount, default 25
--   {valid_days}     — validity in days, default 15
--   {points}         — threshold reached, default 250
--
-- ON CONFLICT DO NOTHING — won't overwrite a body the admin has already edited.

INSERT INTO system_messages (message_key, label, description, message_body, is_automatic, is_enabled, trigger_event, target_category, target_status)
VALUES (
  'pro_fidelity_voucher',
  'Buono Fidelity Card',
  'Inviato automaticamente al cliente Prime Wash al raggiungimento di 250 punti — contiene il codice del buono di €25.',
  '🎉 Complimenti {nome}!

Hai raggiunto i {points} punti della tua Fidelity Card Prime Wash.

Ti abbiamo riservato un buono sconto di *€{amount}* utilizzabile su tutto il sito www.dr7empire.com:

*Codice:* {code}
*Validità:* {valid_days} giorni

Inseriscilo al check-out della tua prossima prenotazione per attivare lo sconto.

Con Stima
*DR7*',
  true,
  true,
  'on_fidelity_threshold',
  'all',
  'all'
)
ON CONFLICT (message_key) DO NOTHING;
