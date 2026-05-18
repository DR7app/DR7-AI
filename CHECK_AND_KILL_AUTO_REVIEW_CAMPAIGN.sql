-- 1. Show every marketing campaign that is currently scheduled / pending /
--    sending. If the review-style message is in here, this is what's firing.
SELECT
  id, title, status, recurrence_type, recurrence_interval,
  scheduled_at, recurrence_end_at, last_run_at, cancelled_at,
  total_recipients, sent_count, failed_count,
  LEFT(COALESCE(message_text, ''), 200) AS msg_preview,
  created_at
FROM public.marketing_campaigns
WHERE status IN ('scheduled', 'pending', 'sending')
   OR (status = 'scheduled' AND cancelled_at IS NULL)
ORDER BY created_at DESC
LIMIT 20;

-- 2. Hard-kill ALL active scheduled/pending/sending marketing campaigns.
--    Comment out the line below if you only want to inspect first.
UPDATE public.marketing_campaigns
SET status = 'cancelled', cancelled_at = NOW()
WHERE status IN ('scheduled', 'pending', 'sending')
  AND cancelled_at IS NULL;
