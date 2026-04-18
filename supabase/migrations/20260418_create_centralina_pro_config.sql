-- ══════════════════════════════════════════════════════════════════
--  centralina_pro_config — singleton config for Centralina Pro
--  Mirrors the rental_config singleton JSONB pattern.
--  One row, id='main'. Admins write it, website + admin read it.
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.centralina_pro_config (
  id          text PRIMARY KEY DEFAULT 'main' CHECK (id = 'main'),
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid NULL
);

-- Seed the singleton row if missing
INSERT INTO public.centralina_pro_config (id, config)
VALUES ('main', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ── Row Level Security ──
ALTER TABLE public.centralina_pro_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "centralina_pro_read_public" ON public.centralina_pro_config;
CREATE POLICY "centralina_pro_read_public"
  ON public.centralina_pro_config
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "centralina_pro_write_auth" ON public.centralina_pro_config;
CREATE POLICY "centralina_pro_write_auth"
  ON public.centralina_pro_config
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "centralina_pro_insert_auth" ON public.centralina_pro_config;
CREATE POLICY "centralina_pro_insert_auth"
  ON public.centralina_pro_config
  FOR INSERT
  TO authenticated
  WITH CHECK (id = 'main');

CREATE OR REPLACE FUNCTION public.bump_centralina_pro_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_centralina_pro_updated_at ON public.centralina_pro_config;
CREATE TRIGGER trg_centralina_pro_updated_at
  BEFORE UPDATE ON public.centralina_pro_config
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_centralina_pro_updated_at();

CREATE INDEX IF NOT EXISTS idx_centralina_pro_config_gin
  ON public.centralina_pro_config
  USING gin (config jsonb_path_ops);
