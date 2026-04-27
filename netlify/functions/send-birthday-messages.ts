import { Handler, schedule } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { renderTemplate } from './utils/messageTemplates';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;

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
    // Birthday template comes EXCLUSIVELY from Messaggi di Sistema Pro.
    // 'birthday_message' routes to 'pro_marketing_compleanno' via OLD_TO_PRO.
    // If missing/disabled/empty we abort — no hardcoded fallback.
    const probeMessage = await renderTemplate('birthday_message', { nome: '', codice: '' });
    if (!probeMessage) {
      console.warn('[Birthday Auto] Pro template for birthday_message is missing/disabled — aborting run');
      return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'pro_template_unavailable' }) };
    }

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

        // Generate TWO unique codes (Supercar €100 + Lavaggio €10) into the
        // unified discount_codes table — the SAME pipeline review codes use.
        // This way:
        //  - the website's validate-discount-code finds them (it queries
        //    discount_codes only),
        //  - they appear in CodiciScontoTab,
        //  - they are single-use globally, NOT bound to a specific customer
        //    (per product decision: anyone receiving the code can use it once).
        const ensureUnique = async (): Promise<string> => {
          for (let i = 0; i < 5; i++) {
            const candidate = generateDiscountCode()
            const { data: existing } = await supabase
              .from('discount_codes')
              .select('id')
              .eq('code', candidate)
              .maybeSingle()
            if (!existing) return candidate
          }
          return generateDiscountCode() + '-' + Date.now().toString(36).toUpperCase()
        }

        const supercarCode = await ensureUnique()
        const lavaggioCode = await ensureUnique()

        const now = new Date()
        const expires = new Date(now); expires.setDate(expires.getDate() + 30); expires.setHours(23, 59, 59, 999)
        const traceMsg = `Codice compleanno — generato per ${fullName}`

        const { error: codeError } = await supabase
          .from('discount_codes')
          .insert([
            {
              code: supercarCode,
              code_type: 'codice_sconto',
              value_type: 'fixed',
              value_amount: 100,
              scope: ['supercar'],
              minimum_spend: 400,
              single_use: true,
              status: 'active',
              customer_email: null,
              customer_phone: null,
              valid_from: now.toISOString(),
              valid_until: expires.toISOString(),
              message: traceMsg,
              usage_conditions: 'Utilizzabile una sola volta. Valido 30 giorni.',
              qr_url: null,
            },
            {
              code: lavaggioCode,
              code_type: 'codice_sconto',
              value_type: 'fixed',
              value_amount: 10,
              scope: ['lavaggi'],
              minimum_spend: 40,
              single_use: true,
              status: 'active',
              customer_email: null,
              customer_phone: null,
              valid_from: now.toISOString(),
              valid_until: expires.toISOString(),
              message: traceMsg,
              usage_conditions: 'Utilizzabile una sola volta. Valido 30 giorni.',
              qr_url: null,
            },
          ])

        if (codeError) {
          console.error(`[Birthday Auto] Failed to save discount code for ${customer.nome}:`, codeError);
          errors++;
          continue;
        }

        // Use rental code as the single {codice} variable so existing Pro
        // templates that reference {codice} keep working. Also expose the
        // explicit aliases for templates that want to show both codes.
        const discountCode = supercarCode
        console.log(`[Birthday Auto] Generated codes Supercar=${supercarCode}, Lavaggio=${lavaggioCode} for ${fullName}`);

        // Render the Pro template for this customer (no hardcoded fallback)
        const personalizedMessage = await renderTemplate('birthday_message', {
          nome: firstName,
          codice: discountCode,
          codice_supercar: supercarCode,
          codice_noleggio: supercarCode,
          codice_lavaggio: lavaggioCode,
          importo_noleggio: '100',
          importo_supercar: '100',
          importo_lavaggio: '10',
          spesa_min_noleggio: '400',
          spesa_min_supercar: '400',
          spesa_min_lavaggio: '40',
          validita_giorni: '30',
        });
        if (!personalizedMessage) {
          console.warn(`[Birthday Auto] Pro template disappeared mid-run for ${fullName} — skipping`);
          errors++;
          continue;
        }

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
