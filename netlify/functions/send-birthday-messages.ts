import { Handler, schedule } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;

// Default birthday message template - {nome} and {codice} will be replaced
const DEFAULT_BIRTHDAY_MESSAGE = `Ciao {nome} 👋🏻

mancano esattamente 10 giorni a una data speciale: il tuo compleanno 🥳

Non vogliamo anticipare gli auguri, ma fare qualcosa di più autentico: riconoscere il tuo valore, prima ancora di celebrarlo.

In qualità di nostro cliente, abbiamo il piacere di riservarti un pensiero dedicato, in linea con il tuo stile 🎁

Per questo ti abbiamo riservato:

Credito personale di €100 utilizzabile per un noleggio DR7

Buono sconto di €10 per un lavaggio auto DR7

CODICE SCONTO: {codice}

Non è solo un regalo, ma un invito a concederti un'esperienza che ti rappresenti: potente, elegante, inconfondibile.

Ti basterà rispondere a questo messaggio per attivare il tuo credito. Saremo lieti di accompagnarti nella scelta 👇🏻

Con stima,
Dubai Rent 7.0 S.p.A.
Ogni compleanno merita uno stile all'altezza.`;

// Generate unique discount code
function generateDiscountCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluded confusing chars: I, O, 0, 1
  let code = 'BDAY-';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  code += '-';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

const birthdayHandler: Handler = async (event) => {
  console.log('[Birthday Auto] Starting automatic birthday message sender...');

  // Check configuration
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[Birthday Auto] Missing Supabase credentials');
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing Supabase config' }) };
  }

  if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
    console.error('[Birthday Auto] Missing Green API credentials');
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing Green API config' }) };
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  try {
    // Source-of-truth order (Pro tab is the canonical editor):
    //  1. system_messages.pro_marketing_compleanno (Messaggi di Sistema Pro)
    //  2. system_messages.birthday_message         (legacy Messaggi di Sistema)
    //  3. app_settings.birthday_message_template   (very old Birthdays-Tab editor)
    //  4. DEFAULT_BIRTHDAY_MESSAGE                 (hardcoded fallback)
    let birthdayMessage = DEFAULT_BIRTHDAY_MESSAGE;
    let templateSource = 'default';

    const { data: proMsg } = await supabase
      .from('system_messages')
      .select('message_body, is_enabled')
      .eq('message_key', 'pro_marketing_compleanno')
      .maybeSingle();

    if (proMsg?.is_enabled && proMsg.message_body) {
      birthdayMessage = proMsg.message_body;
      templateSource = 'pro_marketing_compleanno';
    } else {
      const { data: sysTemplate } = await supabase
        .from('system_messages')
        .select('message_body, is_enabled')
        .eq('message_key', 'birthday_message')
        .maybeSingle();
      if (sysTemplate?.is_enabled && sysTemplate.message_body) {
        birthdayMessage = sysTemplate.message_body;
        templateSource = 'birthday_message';
      } else {
        const { data: settingData } = await supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'birthday_message_template')
          .single();
        if (settingData?.value) {
          birthdayMessage = settingData.value;
          templateSource = 'app_settings (legacy)';
        }
      }
    }
    console.log(`[Birthday Auto] Template source: ${templateSource}`);

    const currentYear = new Date().getFullYear();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Calculate the date 10 days from now
    const targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() + 10);
    const targetMonth = targetDate.getMonth() + 1; // JavaScript months are 0-indexed
    const targetDay = targetDate.getDate();

    console.log(`[Birthday Auto] Looking for birthdays on ${targetDay}/${targetMonth} (10 days from now)`);

    // Get all customers with birthdays
    const { data: customers, error: customersError } = await supabase
      .from('customers_extended')
      .select('id, nome, cognome, telefono, data_nascita, email, status')
      .not('data_nascita', 'is', null)
      .not('telefono', 'is', null);

    if (customersError) {
      console.error('[Birthday Auto] Error fetching customers:', customersError);
      throw customersError;
    }

    console.log(`[Birthday Auto] Found ${customers?.length || 0} customers with birthdays and phone numbers`);

    // Get already sent messages this year
    const { data: sentMessages, error: sentError } = await supabase
      .from('birthday_messages')
      .select('customer_id')
      .eq('year', currentYear);

    if (sentError && sentError.code !== '42P01') {
      console.warn('[Birthday Auto] Error fetching sent messages:', sentError);
    }

    const sentCustomerIds = new Set((sentMessages || []).map(m => m.customer_id));

    // Filter customers whose birthday is exactly 10 days away
    const customersToMessage: typeof customers = [];

    for (const customer of customers || []) {
      if (!customer.data_nascita || !customer.telefono) continue;
      if ((customer as any).status === 'blacklist') continue; // Skip blacklisted customers
      if (sentCustomerIds.has(customer.id)) continue; // Already sent this year

      // Parse birthday
      const birthDate = parseBirthday(customer.data_nascita);
      if (!birthDate) continue;

      // Check if birthday matches target date (month and day)
      if (birthDate.getMonth() + 1 === targetMonth && birthDate.getDate() === targetDay) {
        customersToMessage.push(customer);
      }
    }

    console.log(`[Birthday Auto] Found ${customersToMessage.length} customers with birthday in 10 days`);

    let sent = 0;
    let errors = 0;

    for (const customer of customersToMessage) {
      try {
        // Get first name
        const firstName = customer.nome || customer.cognome || 'Cliente';
        const fullName = `${customer.nome || ''} ${customer.cognome || ''}`.trim() || 'Cliente';

        // Generate unique discount code
        let discountCode = generateDiscountCode();

        // Ensure code is unique (retry if exists)
        let attempts = 0;
        while (attempts < 5) {
          const { data: existingCode } = await supabase
            .from('birthday_discount_codes')
            .select('code')
            .eq('code', discountCode)
            .single();

          if (!existingCode) break;
          discountCode = generateDiscountCode();
          attempts++;
        }

        // Save discount code to database
        const { error: codeError } = await supabase
          .from('birthday_discount_codes')
          .insert({
            code: discountCode,
            customer_id: customer.id,
            customer_name: fullName,
            customer_phone: customer.telefono,
            rental_credit: 100.00,
            car_wash_discount: 10.00,
            sent_via: 'whatsapp_auto'
          });

        if (codeError) {
          console.error(`[Birthday Auto] Failed to save discount code for ${customer.nome}:`, codeError);
          errors++;
          continue;
        }

        console.log(`[Birthday Auto] Generated code ${discountCode} for ${fullName}`);

        // Personalize message with name and code (replace ALL occurrences, not just the first)
        const personalizedMessage = birthdayMessage
          .replace(/\{nome\}/g, firstName)
          .replace(/\{codice\}/g, discountCode);

        // Clean phone number — strip all non-digit chars, normalize Italian prefix
        let cleanPhone = customer.telefono.replace(/[^\d]/g, '');
        if (cleanPhone.startsWith('0')) {
          cleanPhone = '39' + cleanPhone.substring(1);
        }
        if (!cleanPhone.startsWith('39') && cleanPhone.length === 10) {
          cleanPhone = '39' + cleanPhone;
        }
        if (cleanPhone.length < 10) {
          console.log(`[Birthday Auto] Skipping ${customer.nome}: invalid phone ${customer.telefono}`);
          errors++;
          continue;
        }

        // Send via Green API
        const greenApiUrl = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;

        const response = await fetch(greenApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chatId: `${cleanPhone}@c.us`,
            message: personalizedMessage
          })
        });

        const result = await response.json();

        if (!response.ok || result.error) {
          console.error(`[Birthday Auto] Failed to send to ${customer.nome}:`, result);
          errors++;
          continue;
        }

        console.log(`[Birthday Auto] ✅ Sent to ${customer.nome} ${customer.cognome} (${cleanPhone}) with code ${discountCode}`);

        // Record as sent
        await supabase
          .from('birthday_messages')
          .insert({
            customer_id: customer.id,
            year: currentYear,
            message_text: personalizedMessage,
            sent_via: 'green_api_auto'
          });

        // Log to sent_messages_log
        try {
          const fullMessage = personalizedMessage;
          await supabase.from('sent_messages_log').insert({
            customer_name: fullName,
            customer_phone: customer.telefono,
            message_text: fullMessage,
            template_label: 'Birthday Greeting',
            status: 'sent',
          });
        } catch (logErr) {
          console.error('Failed to log message:', logErr);
        }

        sent++;

        // Delay between messages to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (err) {
        console.error(`[Birthday Auto] Error sending to ${customer.nome}:`, err);
        errors++;
      }
    }

    const summary = {
      date: new Date().toISOString(),
      targetBirthday: `${targetDay}/${targetMonth}`,
      customersFound: customersToMessage.length,
      sent,
      errors
    };

    console.log('[Birthday Auto] Completed:', summary);

    return {
      statusCode: 200,
      body: JSON.stringify(summary)
    };

  } catch (error: any) {
    console.error('[Birthday Auto] Fatal error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

function parseBirthday(dateStr: string): Date | null {
  if (!dateStr) return null;

  // Format: DD/MM/YYYY or DD-MM-YYYY
  const ddmmyyyy = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (ddmmyyyy) {
    return new Date(parseInt(ddmmyyyy[3]), parseInt(ddmmyyyy[2]) - 1, parseInt(ddmmyyyy[1]));
  }

  // Format: YYYY-MM-DD (ISO)
  const iso = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));
  }

  return null;
}

// Run every day at 9:00 AM (Rome time = UTC+1, so 8:00 UTC)
export const handler = schedule('0 8 * * *', birthdayHandler);
