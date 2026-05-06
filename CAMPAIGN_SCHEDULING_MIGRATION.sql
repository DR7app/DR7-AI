-- =====================================================================
-- Marketing Campaign Scheduling
-- Adds scheduled-send + recurrence support to marketing_campaigns.
--
-- Apply once in Supabase SQL Editor (idempotent).
-- =====================================================================

-- New columns
ALTER TABLE public.marketing_campaigns
  ADD COLUMN IF NOT EXISTS scheduled_at         timestamptz,
  ADD COLUMN IF NOT EXISTS recurrence_type      text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS recurrence_interval  integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS recurrence_end_at    timestamptz,
  ADD COLUMN IF NOT EXISTS parent_campaign_id   uuid REFERENCES public.marketing_campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS audience_filters     jsonb,
  ADD COLUMN IF NOT EXISTS last_run_at          timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at         timestamptz;

-- Constrain recurrence_type to known values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'marketing_campaigns'
      AND constraint_name = 'marketing_campaigns_recurrence_type_check'
  ) THEN
    ALTER TABLE public.marketing_campaigns
      ADD CONSTRAINT marketing_campaigns_recurrence_type_check
      CHECK (recurrence_type IN ('none','daily','weekly','monthly'));
  END IF;
END $$;

-- Sanity: interval >= 1 when set
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'marketing_campaigns'
      AND constraint_name = 'marketing_campaigns_recurrence_interval_check'
  ) THEN
    ALTER TABLE public.marketing_campaigns
      ADD CONSTRAINT marketing_campaigns_recurrence_interval_check
      CHECK (recurrence_interval >= 1);
  END IF;
END $$;

-- Cron lookup uses (status, scheduled_at). Partial index keeps it tiny.
CREATE INDEX IF NOT EXISTS marketing_campaigns_scheduled_due_idx
  ON public.marketing_campaigns (scheduled_at)
  WHERE status = 'scheduled' AND cancelled_at IS NULL;

-- History view: list a recurring template's children chronologically.
CREATE INDEX IF NOT EXISTS marketing_campaigns_parent_idx
  ON public.marketing_campaigns (parent_campaign_id, created_at DESC)
  WHERE parent_campaign_id IS NOT NULL;
