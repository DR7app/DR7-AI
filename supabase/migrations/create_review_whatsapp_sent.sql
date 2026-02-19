-- Table to track WhatsApp review messages sent (one per customer, forever)
CREATE TABLE review_whatsapp_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers_extended(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  customer_phone text NOT NULL,
  message_text text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(customer_id)
);

CREATE INDEX idx_review_whatsapp_customer ON review_whatsapp_sent(customer_id);

-- Seed default review WhatsApp template
INSERT INTO app_settings (key, value) VALUES (
  'review_whatsapp_template',
  E'Ciao {nome} 👋🏻\n\nGrazie per aver scelto DR7 Empire!\n\nLa tua opinione è fondamentale per noi. Se ti fa piacere, lasciaci una recensione a 5 stelle raccontando la tua esperienza ⭐\n\nIn segno di gratitudine, inviandoci uno screenshot della recensione riceverai un buono sconto da €100 sul tuo prossimo noleggio e uno da €10 sul tuo prossimo lavaggio 🎁\n\nClicca qui per lasciare la recensione 👇🏻\nhttps://g.page/r/CQwgJt7OYpsfEBM/review\n\nGrazie mille!\nDubai Rent 7.0 S.p.A.'
) ON CONFLICT (key) DO NOTHING;
