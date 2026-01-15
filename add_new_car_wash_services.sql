-- Add three new car wash services
-- Services: LAVAGGIO SCOOTER, LAVAGGIO SOLO ESTERNO, LAVAGGIO SOLO INTERNO
-- Date: 2026-01-15

INSERT INTO car_wash_services (
  id,
  name,
  name_en,
  price,
  duration,
  description,
  description_en,
  features,
  features_en,
  is_active,
  display_order
) VALUES
(
  'scooter-wash',
  'LAVAGGIO SCOOTER',
  'SCOOTER WASH',
  10,
  '15 min',
  'Lavaggio rapido ed efficace per il tuo scooter.',
  'Quick and effective wash for your scooter.',
  '["Lavaggio esterno completo", "Pulizia sella", "Pulizia cerchi e pneumatici", "Asciugatura"]'::jsonb,
  '["Complete exterior wash", "Seat cleaning", "Wheel and tire cleaning", "Drying"]'::jsonb,
  true,
  1
),
(
  'exterior-only',
  'LAVAGGIO SOLO ESTERNO',
  'EXTERIOR ONLY',
  15,
  '15 min',
  'Lavaggio esterno rapido per una carrozzeria brillante.',
  'Quick exterior wash for a shiny body.',
  '["Lavaggio carrozzeria completo", "Schiuma colorata profumata", "Pulizia cerchi e vetri esterni", "Asciugatura"]'::jsonb,
  '["Complete body wash", "Scented colored foam", "Wheel and exterior glass cleaning", "Drying"]'::jsonb,
  true,
  2
),
(
  'interior-only',
  'LAVAGGIO SOLO INTERNO',
  'INTERIOR ONLY',
  20,
  '30 min',
  'Pulizia approfondita degli interni per un abitacolo fresco.',
  'Deep interior cleaning for a fresh cabin.',
  '["Aspirazione completa interni", "Pulizia cruscotto e consolle", "Pulizia vetri interni", "Pulizia sedili e tappetini"]'::jsonb,
  '["Complete interior vacuuming", "Dashboard and console cleaning", "Interior glass cleaning", "Seat and mat cleaning"]'::jsonb,
  true,
  3
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  name_en = EXCLUDED.name_en,
  price = EXCLUDED.price,
  duration = EXCLUDED.duration,
  description = EXCLUDED.description,
  description_en = EXCLUDED.description_en,
  features = EXCLUDED.features,
  features_en = EXCLUDED.features_en,
  is_active = EXCLUDED.is_active,
  display_order = EXCLUDED.display_order;

-- Update display_order for existing services to maintain proper ordering
UPDATE car_wash_services SET display_order = 4 WHERE id = 'full-clean';
UPDATE car_wash_services SET display_order = 5 WHERE id = 'top-shine';
UPDATE car_wash_services SET display_order = 6 WHERE id = 'vip';
UPDATE car_wash_services SET display_order = 7 WHERE id = 'dr7-luxury';
