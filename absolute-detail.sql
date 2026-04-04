-- Step 1: Add the price_unit column
ALTER TABLE car_wash_services ADD COLUMN IF NOT EXISTS price_unit text;

-- Step 2: Insert the new service
INSERT INTO car_wash_services (
  name, name_en, price, price_unit, category, main_tab,
  display_order, is_active, duration, description, description_en,
  features, features_en
) VALUES (
  'Absolute Detail',
  'Absolute Detail',
  500,
  'custom',
  'urban',
  'lavaggio',
  8,
  true,
  'Su preventivo',
  'Servizio di detailing completo e personalizzato per veicoli che richiedono trattamenti premium su misura.',
  'Complete and customized detailing service for vehicles requiring bespoke premium treatments.',
  '["Trattamento completo su misura", "Prodotti professionali premium", "Consulenza personalizzata", "Prezzo su preventivo"]',
  '["Fully customized treatment", "Premium professional products", "Personalized consultation", "Price on quote"]'
);
