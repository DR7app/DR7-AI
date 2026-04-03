-- Rental Extras & Services Configuration
-- Singleton JSONB table for managing all add-on pricing from admin Revenue dashboard
-- Website reads this table to display extras prices in booking wizard

CREATE TABLE IF NOT EXISTS rental_extras_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

-- Ensure single row (singleton pattern)
CREATE UNIQUE INDEX IF NOT EXISTS rental_extras_config_singleton ON rental_extras_config ((true));

-- Seed with default pricing from user's pricing sheet (26-69 anni, min 5 anni patente)
INSERT INTO rental_extras_config (config) VALUES (
  '{
    "insurance": [
      {
        "id": "rca_inclusa",
        "name": "RCA Compresa",
        "price": 0,
        "price_unit": "included",
        "deposit_required": 10000,
        "is_active": true,
        "display_order": 1,
        "description": "Assicurazione base inclusa nel prezzo. Richiede cauzione di 10.000€"
      },
      {
        "id": "kasko_base",
        "name": "Kasko Base",
        "price": 89,
        "price_unit": "per_day",
        "is_active": true,
        "display_order": 2,
        "description": "Copertura Kasko base"
      },
      {
        "id": "kasko_black",
        "name": "Kasko Black",
        "price": 149,
        "price_unit": "per_day",
        "is_active": true,
        "display_order": 3,
        "description": "Copertura Kasko Black premium"
      },
      {
        "id": "kasko_signature",
        "name": "Kasko Signature",
        "price": 189,
        "price_unit": "per_day",
        "is_active": true,
        "display_order": 4,
        "description": "Copertura Kasko Signature"
      },
      {
        "id": "kasko_dr7",
        "name": "Kasko DR7",
        "price": 289,
        "price_unit": "per_day",
        "is_active": true,
        "display_order": 5,
        "description": "Copertura Kasko DR7 massima protezione"
      }
    ],
    "km_packages": [
      {
        "id": "unlimited_km",
        "name": "KM Illimitati",
        "price": 189,
        "price_unit": "per_day",
        "is_active": true,
        "display_order": 1,
        "description": "Chilometraggio illimitato"
      }
    ],
    "deposit_options": [
      {
        "id": "no_deposit",
        "name": "Senza Cauzione",
        "price": 49,
        "price_unit": "per_day",
        "is_active": true,
        "display_order": 1,
        "description": "Nessuna cauzione richiesta"
      },
      {
        "id": "deposit_2020_plus",
        "name": "Cauzione Auto 2020+",
        "price": 20,
        "price_unit": "per_day",
        "is_active": true,
        "display_order": 2,
        "description": "Supplemento cauzione per veicoli dal 2020 in poi"
      }
    ],
    "driver_extras": [
      {
        "id": "second_driver",
        "name": "Secondo Guidatore",
        "price": 10,
        "price_unit": "per_day",
        "is_active": true,
        "display_order": 1,
        "description": "Guidatore aggiuntivo"
      },
      {
        "id": "final_cleaning",
        "name": "Pulizia Finale",
        "price": 9.90,
        "price_unit": "one_time",
        "is_active": true,
        "display_order": 2,
        "description": "Pulizia finale del veicolo"
      }
    ],
    "delivery": [
      {
        "id": "delivery",
        "name": "Consegna / Ritiro",
        "price": 3,
        "price_unit": "per_km",
        "is_active": true,
        "display_order": 1,
        "description": "Consegna e ritiro a domicilio"
      }
    ],
    "experience": [
      {
        "id": "bouquet_rose",
        "name": "Bouquet Rose",
        "price": 7.90,
        "price_unit": "per_unit",
        "unit_label": "rosa",
        "is_active": true,
        "display_order": 1,
        "description": "Bouquet di rose personalizzato"
      },
      {
        "id": "wedding_decoration",
        "name": "Allestimento Matrimonio",
        "price": 150,
        "price_unit": "one_time",
        "is_active": true,
        "display_order": 2,
        "description": "Decorazione veicolo per matrimonio"
      },
      {
        "id": "chauffeur",
        "name": "Chauffeur",
        "price": 150,
        "price_unit": "per_hour",
        "is_active": true,
        "display_order": 3,
        "description": "Autista professionista"
      },
      {
        "id": "restaurant_booking",
        "name": "Prenotazione Ristorante",
        "price": 10,
        "price_unit": "one_time",
        "is_active": true,
        "display_order": 4,
        "description": "Prenotazione ristorante esclusivo"
      },
      {
        "id": "video_drone",
        "name": "Video Maker + Drone",
        "price": 200,
        "price_unit": "per_hour",
        "is_active": true,
        "display_order": 5,
        "description": "Video professionale con drone"
      },
      {
        "id": "premium_assistance",
        "name": "Assistenza Premium",
        "price": 19.90,
        "price_unit": "per_day",
        "is_active": true,
        "display_order": 6,
        "description": "Assistenza premium dedicata"
      },
      {
        "id": "vehicle_replacement",
        "name": "Sostituzione Veicolo",
        "price": 19.90,
        "price_unit": "per_day",
        "is_active": true,
        "display_order": 7,
        "description": "Veicolo sostitutivo in caso di guasto"
      },
      {
        "id": "vip_chauffeur",
        "name": "VIP Chauffeur",
        "price": 189,
        "price_unit": "per_hour",
        "is_active": true,
        "display_order": 8,
        "description": "Chauffeur VIP con esperienza luxury"
      }
    ],
    "cancellation": [
      {
        "id": "dr7_flex",
        "name": "DR7 FLEX",
        "price": 19.90,
        "price_unit": "per_day",
        "is_active": true,
        "display_order": 1,
        "description": "Cancellazione flessibile - 90% rimborso in credito DR7 Wallet"
      }
    ]
  }'::jsonb
) ON CONFLICT DO NOTHING;

-- RLS
ALTER TABLE rental_extras_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read rental_extras_config"
  ON rental_extras_config FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can update rental_extras_config"
  ON rental_extras_config FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert rental_extras_config"
  ON rental_extras_config FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Service role full access rental_extras_config"
  ON rental_extras_config FOR ALL TO service_role USING (true);

-- Anon can read (website needs to fetch extras pricing)
CREATE POLICY "Anon can read rental_extras_config"
  ON rental_extras_config FOR SELECT TO anon USING (true);
