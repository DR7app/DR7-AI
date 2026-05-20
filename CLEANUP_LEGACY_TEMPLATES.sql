-- ─────────────────────────────────────────────────────────────────
-- Pulizia Messaggi di Sistema Pro: rimuove i 26 template legacy
-- che cluterano l'admin UI. Dopo il fix di oggi (resolver strict +
-- 3-layer block) NON possono comunque partire — ma occupano spazio
-- nell'UI con label duplicate ("Conferma Noleggio" appariva 2 volte).
--
-- Eseguire UNA delle due strategie:
--   A. DISABLE (sicuro, reversibile) — set is_enabled=false
--   B. DELETE (pulizia definitiva)
--
-- Suggerito: prima A. Se tutto ok per 1-2 giorni, poi B.
-- ─────────────────────────────────────────────────────────────────

-- ════════ STRATEGIA A — DISABLE (reversibile) ════════
-- Decommenta per usare questa strategia:

/*
UPDATE public.system_messages
SET is_enabled = false,
    updated_at = NOW()
WHERE message_key IN (
  -- Noleggio
  'rental_new_customer', 'rental_new', 'rental_new_admin', 'rental_modified',
  'deposit_return_iban',
  -- Lavaggio
  'carwash_new_customer', 'carwash_new', 'carwash_new_admin', 'carwash_modified',
  -- Meccanica
  'mechanical_new_customer', 'mechanical_new', 'mechanical_new_admin', 'mechanical_modified',
  -- Firma & Contratto
  'signature_request_link', 'signature_reminder_whatsapp', 'signature_otp_whatsapp',
  'document_signature_link',
  -- Pagamenti
  'payment_link_customer', 'rental_da_saldare_customer', 'booking_cancelled_whatsapp',
  'payment_received_extension', 'payment_received_extension_admin',
  'payment_received_damages', 'payment_received_damages_admin',
  'booking_confirmed_da_saldare',
  -- Pagato per metodo
  'booking_paid_cash', 'booking_paid_card', 'booking_paid_bank_transfer',
  'booking_paid_paypal', 'booking_paid_wallet',
  -- Preventivi admin
  'admin_new_website_quote', 'admin_no_cauzione_request',
  -- Marketing & wallet
  'review_request_whatsapp', 'birthday_message', 'wallet_bonus_credit',
  'review_discount_code', 'promo_incassi_whatsapp', 'maxi_promo_gap_whatsapp',
  -- Cauzione
  'deposit_request_customer',
  -- No Cauzione / Preventivi
  'no_cauzione_approved', 'no_cauzione_rejected', 'quote_discount_offered',
  -- Fidelity
  'fidelity_voucher_whatsapp',
  -- Website
  'website_booking_cancelled_customer'
);
*/

-- ════════ STRATEGIA B — DELETE (pulizia definitiva) ════════
-- Decommenta per usare questa strategia:

/*
DELETE FROM public.system_messages
WHERE message_key IN (
  'rental_new_customer', 'rental_new', 'rental_new_admin', 'rental_modified',
  'deposit_return_iban',
  'carwash_new_customer', 'carwash_new', 'carwash_new_admin', 'carwash_modified',
  'mechanical_new_customer', 'mechanical_new', 'mechanical_new_admin', 'mechanical_modified',
  'signature_request_link', 'signature_reminder_whatsapp', 'signature_otp_whatsapp',
  'document_signature_link',
  'payment_link_customer', 'rental_da_saldare_customer', 'booking_cancelled_whatsapp',
  'payment_received_extension', 'payment_received_extension_admin',
  'payment_received_damages', 'payment_received_damages_admin',
  'booking_confirmed_da_saldare',
  'booking_paid_cash', 'booking_paid_card', 'booking_paid_bank_transfer',
  'booking_paid_paypal', 'booking_paid_wallet',
  'admin_new_website_quote', 'admin_no_cauzione_request',
  'review_request_whatsapp', 'birthday_message', 'wallet_bonus_credit',
  'review_discount_code', 'promo_incassi_whatsapp', 'maxi_promo_gap_whatsapp',
  'deposit_request_customer',
  'no_cauzione_approved', 'no_cauzione_rejected', 'quote_discount_offered',
  'fidelity_voucher_whatsapp',
  'website_booking_cancelled_customer'
);
*/

-- ════════ VERIFICA PRE/POST ════════
-- Conta quanti legacy ci sono PRIMA / DOPO l'esecuzione.
SELECT
  COUNT(*) FILTER (WHERE message_key IN (
    'rental_new_customer','rental_new','rental_new_admin','rental_modified',
    'deposit_return_iban',
    'carwash_new_customer','carwash_new','carwash_new_admin','carwash_modified',
    'mechanical_new_customer','mechanical_new','mechanical_new_admin','mechanical_modified',
    'signature_request_link','signature_reminder_whatsapp','signature_otp_whatsapp',
    'document_signature_link',
    'payment_link_customer','rental_da_saldare_customer','booking_cancelled_whatsapp',
    'payment_received_extension','payment_received_extension_admin',
    'payment_received_damages','payment_received_damages_admin',
    'booking_confirmed_da_saldare',
    'booking_paid_cash','booking_paid_card','booking_paid_bank_transfer',
    'booking_paid_paypal','booking_paid_wallet',
    'admin_new_website_quote','admin_no_cauzione_request',
    'review_request_whatsapp','birthday_message','wallet_bonus_credit',
    'review_discount_code','promo_incassi_whatsapp','maxi_promo_gap_whatsapp',
    'deposit_request_customer',
    'no_cauzione_approved','no_cauzione_rejected','quote_discount_offered',
    'fidelity_voucher_whatsapp',
    'website_booking_cancelled_customer'
  )) AS legacy_count,
  COUNT(*) AS total_count
FROM public.system_messages;
