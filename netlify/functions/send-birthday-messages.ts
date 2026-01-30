import { Handler, schedule } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;

// Birthday message template - {nome} will be replaced with customer's first name
const BIRTHDAY_MESSAGE = `Ciao {nome} 👋🏻

mancano esattamente 10 giorni a una data speciale: il tuo compleanno.🥳

Non siamo qui per anticipare gli auguri, ma per fare qualcosa di più sincero e raro: riconoscere il tuo valore, prima ancora di celebrarlo.

In qualità di nostro cliente, ci fa piacere riservarti un pensiero autentico, all'altezza del tuo stile.🎁

Per questo, abbiamo predisposto per te un credito personale del valore di €100 utilizzabile per un noleggio DR7 e un buono sconto del valore di €10 per un lavaggio auto DR7.

È un invito, discreto ma reale, a concederti un momento diverso.

Non un semplice regalo, ma un'occasione per guidare qualcosa che ti rappresenti: potente, elegante, inconfondibile.

Ti basterà rispondere a questo messaggio per attivare il tuo credito. Saremo felici di accompagnarti nella scelta.👇🏻

Con stima e attenzione,

Dubai Rent 7.0 – S.p.A.
Ogni compleanno merita uno stile all'altezza.`;

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
      .select('id, nome, cognome, telefono, data_nascita, email')
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

        // Personalize message
        const personalizedMessage = BIRTHDAY_MESSAGE.replace('{nome}', firstName);

        // Clean phone number
        let cleanPhone = customer.telefono.replace(/[\s\-\+]/g, '');
        if (cleanPhone.startsWith('0')) {
          cleanPhone = '39' + cleanPhone.substring(1);
        }
        if (!cleanPhone.startsWith('39') && cleanPhone.length === 10) {
          cleanPhone = '39' + cleanPhone;
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

        console.log(`[Birthday Auto] ✅ Sent to ${customer.nome} ${customer.cognome} (${cleanPhone})`);

        // Record as sent
        await supabase
          .from('birthday_messages')
          .insert({
            customer_id: customer.id,
            year: currentYear,
            message_text: personalizedMessage,
            sent_via: 'green_api_auto'
          });

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
