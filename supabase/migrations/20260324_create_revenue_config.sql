-- Revenue Management Configuration
-- Single-row JSONB config table for dynamic pricing engine

CREATE TABLE IF NOT EXISTS revenue_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled boolean NOT NULL DEFAULT false,
  mode text NOT NULL DEFAULT 'suggestion' CHECK (mode IN ('suggestion', 'auto_with_approval', 'auto')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

-- Ensure single row
CREATE UNIQUE INDEX IF NOT EXISTS revenue_config_singleton ON revenue_config ((true));

-- Seed with sensible Italian defaults (disabled)
INSERT INTO revenue_config (enabled, mode, config) VALUES (
  false,
  'suggestion',
  '{
    "base_prices": {},
    "min_prices": {},
    "max_prices": {},
    "occupation_coefficients": [
      {"min_pct": 0, "max_pct": 40, "coeff": 0.90, "label": "Bassa occupazione"},
      {"min_pct": 40, "max_pct": 70, "coeff": 1.00, "label": "Occupazione normale"},
      {"min_pct": 70, "max_pct": 90, "coeff": 1.15, "label": "Alta occupazione"},
      {"min_pct": 90, "max_pct": 100, "coeff": 1.30, "label": "Occupazione critica"}
    ],
    "advance_coefficients": [
      {"min_days": 0, "max_days": 2, "coeff": 1.25, "label": "Last minute"},
      {"min_days": 2, "max_days": 7, "coeff": 1.10, "label": "Prenotazione breve"},
      {"min_days": 7, "max_days": 30, "coeff": 1.00, "label": "Anticipo standard"},
      {"min_days": 30, "max_days": 9999, "coeff": 0.95, "label": "Prenotazione anticipata"}
    ],
    "duration_coefficients": [
      {"min_days": 1, "max_days": 3, "coeff": 1.00, "label": "Breve durata"},
      {"min_days": 3, "max_days": 7, "coeff": 0.95, "label": "Settimanale"},
      {"min_days": 7, "max_days": 14, "coeff": 0.90, "label": "Bi-settimanale"},
      {"min_days": 14, "max_days": 30, "coeff": 0.85, "label": "Mensile"},
      {"min_days": 30, "max_days": 9999, "coeff": 0.80, "label": "Lungo termine"}
    ],
    "season_rules": [
      {"name": "Alta Stagione Estiva", "start_date": "06-15", "end_date": "09-15", "coeff": 1.20, "type": "alta"},
      {"name": "Natale & Capodanno", "start_date": "12-20", "end_date": "01-06", "coeff": 1.25, "type": "picco"},
      {"name": "Pasqua", "start_date": "04-01", "end_date": "04-25", "coeff": 1.10, "type": "media"},
      {"name": "Bassa Stagione", "start_date": "01-07", "end_date": "03-31", "coeff": 0.90, "type": "bassa"}
    ]
  }'::jsonb
) ON CONFLICT DO NOTHING;

-- RLS
ALTER TABLE revenue_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read revenue_config"
  ON revenue_config FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can update revenue_config"
  ON revenue_config FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Service role full access revenue_config"
  ON revenue_config FOR ALL TO service_role USING (true);
