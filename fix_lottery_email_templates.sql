-- Safe migration: Create lottery email templates table if needed
-- This handles the case where the table or index might already exist

-- Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS lottery_email_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  html_content TEXT NOT NULL,
  text_content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT false
);

-- Create index only if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'idx_lottery_email_templates_active'
  ) THEN
    CREATE INDEX idx_lottery_email_templates_active 
    ON lottery_email_templates(is_active) 
    WHERE is_active = true;
  END IF;
END $$;

-- Insert default template only if no active template exists
INSERT INTO lottery_email_templates (
  template_name,
  subject,
  html_content,
  text_content,
  is_active
)
SELECT 
  'Default Template',
  'Importante: Comunicazione Lotteria DR7 Empire',
  '<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #FFD700 0%, #FFA500 100%); color: #000; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
        p { margin: 10px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1 style="margin: 0;">DR7 EMPIRE LOTTERIA</h1>
        </div>
        <div class="content">
            <p>Gentile Cliente,</p>
            <p>Inserisci qui il contenuto della tua email...</p>
            <p>Cordiali saluti,<br>Il Team DR7 Empire</p>
        </div>
        <div class="footer">
            <p>DR7 Empire - Luxury Car Rental & Services</p>
        </div>
    </div>
</body>
</html>',
  'Gentile Cliente,

Inserisci qui il contenuto della tua email...

Cordiali saluti,
Il Team DR7 Empire

---
DR7 Empire - Luxury Car Rental & Services',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM lottery_email_templates WHERE is_active = true
);

-- Show result
SELECT 
  CASE 
    WHEN COUNT(*) > 0 THEN 'Success! Template ready to use.'
    ELSE 'Table exists but check if you need to add a template.'
  END as status,
  COUNT(*) as total_templates,
  COUNT(*) FILTER (WHERE is_active = true) as active_templates
FROM lottery_email_templates;
