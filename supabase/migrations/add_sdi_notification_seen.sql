-- Add notification-acknowledged flag to fatture so admin can dismiss
-- "Scartata"/"Errore" badges from the dashboard once they've reviewed
-- the rejection. The counter on the Amministrazione section + Fattura
-- sub-tab filters out fatture where sdi_notification_seen = true.
--
-- The flag is auto-RESET to false in netlify/functions/_check-sdi-statuses.ts
-- whenever sdi_status transitions back into rejected/scartata/error from a
-- different state, so a re-rejection re-triggers the notification.

ALTER TABLE public.fatture
  ADD COLUMN IF NOT EXISTS sdi_notification_seen BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.fatture.sdi_notification_seen IS
  'TRUE once admin has clicked "Vista" on the SDI rejection notification. Reset to FALSE on each new transition into rejected/scartata/error.';
