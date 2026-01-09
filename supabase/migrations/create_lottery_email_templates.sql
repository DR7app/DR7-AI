-- Create lottery email templates table
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

-- Create index on is_active for faster lookups
CREATE INDEX idx_lottery_email_templates_active ON lottery_email_templates(is_active) WHERE is_active = true;

-- Insert default template (current postponement email)
INSERT INTO lottery_email_templates (
  template_name,
  subject,
  html_content,
  text_content,
  is_active
) VALUES (
  'Default Postponement Email',
  '🎟️ Importante: Estrazione Lotteria DR7 Rinviata al 24 Gennaio 2026 - ULTIMI BIGLIETTI',
  '<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #FFD700 0%, #FFA500 100%); color: #000; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .highlight { background: #FFD700; color: #000; padding: 15px; border-radius: 5px; text-align: center; font-weight: bold; font-size: 18px; margin: 20px 0; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
        .button { display: inline-block; background: #FFD700; color: #000; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; margin: 15px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1 style="margin: 0;">🎟️ DR7 EMPIRE LOTTERIA</h1>
            <p style="margin: 10px 0 0 0; font-size: 16px;">Comunicazione Importante - ULTIMI BIGLIETTI</p>
        </div>
        <div class="content">
            <p>Gentile,</p>
            
            <p>Ti scriviamo per informarti di un importante aggiornamento riguardo alla <strong>Lotteria DR7 Empire. ULTIMI BIGLIETTI.</strong></p>
            
            <div class="highlight">
                📅 L''estrazione è stata RINVIATA al<br>
                <span style="font-size: 24px;">24 GENNAIO 2026</span><br>
                <span style="font-size: 14px; font-weight: normal;">TEMPO MASSIMO COME DA REGOLAMENTO</span>
            </div>
            
            <p><strong>Il tuo biglietto rimane valido!</strong></p>
            
            <p>Tutti i biglietti acquistati parteciperanno regolarmente all''estrazione nella nuova data. Non è necessaria alcuna azione da parte tua.</p>
            
            <p><strong>Cosa significa per te:</strong></p>
            <ul>
                <li>✅ Il tuo biglietto è confermato e valido</li>
                <li>✅ Hai più tempo per acquistare biglietti aggiuntivi</li>
                <li>✅ L''estrazione si terrà il 24 gennaio 2026</li>
                <li>✅ I premi rimangono invariati</li>
            </ul>
            
            <p>Ci scusiamo per l''inconveniente e ti ringraziamo per la comprensione.</p>
            
            <p style="text-align: center; margin-top: 30px;">
                <a href="https://dr7empire.com" class="button">Visita DR7 Empire</a>
            </p>
            
            <p style="margin-top: 30px;">Per qualsiasi domanda, non esitare a contattarci.</p>
            
            <p><strong>Buona fortuna! 🍀</strong></p>
            
            <p style="margin-top: 20px;">
                Cordiali saluti,<br>
                <strong>Il Team DR7 Empire</strong>
            </p>
        </div>
        <div class="footer">
            <p>DR7 Empire - Luxury Car Rental & Services</p>
            <p>Questa è una comunicazione ufficiale riguardante la tua partecipazione alla Lotteria DR7.</p>
        </div>
    </div>
</body>
</html>',
  'Gentile,

Ti scriviamo per informarti di un importante aggiornamento riguardo alla Lotteria DR7 Empire. ULTIMI BIGLIETTI.

📅 L''ESTRAZIONE È STATA RINVIATA AL 24 GENNAIO 2026
TEMPO MASSIMO COME DA REGOLAMENTO

Il tuo biglietto rimane valido!

Tutti i biglietti acquistati parteciperanno regolarmente all''estrazione nella nuova data. Non è necessaria alcuna azione da parte tua.

Cosa significa per te:
✅ Il tuo biglietto è confermato e valido
✅ Hai più tempo per acquistare biglietti aggiuntivi
✅ L''estrazione si terrà il 24 gennaio 2026
✅ I premi rimangono invariati

Ci scusiamo per l''inconveniente e ti ringraziamo per la comprensione.

Per qualsiasi domanda, non esitare a contattarci.

Buona fortuna! 🍀

Cordiali saluti,
Il Team DR7 Empire

---
DR7 Empire - Luxury Car Rental & Services
Questa è una comunicazione ufficiale riguardante la tua partecipazione alla Lotteria DR7.',
  true
);
