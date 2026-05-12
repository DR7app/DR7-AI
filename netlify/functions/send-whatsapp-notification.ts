import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { getMessageTemplate, resolveKeyForContext } from './utils/messageTemplates';

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
const NOTIFICATION_PHONE = process.env.NOTIFICATION_PHONE || "393457905205";
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// ── Optional email channel (Messaggi Pro toggle "Invia anche via email") ──
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function wrapAsEmailHtml(plainText: string): string {
  const withBreaks = escapeHtml(plainText).replace(/\n/g, '<br>');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1d1d1f;">
<div style="max-width:600px;margin:24px auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
<div style="font-size:14px;line-height:1.6;">${withBreaks}</div>
<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e5ea;font-size:12px;color:#6e6e73;">DR7 Empire &mdash; Cagliari</div>
</div>
</body></html>`;
}

async function sendEmailViaResend(to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY missing' };
  const fromAddress = process.env.RESEND_FROM || 'DR7 Empire <noreply@dr7.app>';
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromAddress, to: [to], subject, html }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      return { ok: false, error: `Resend ${resp.status}: ${errText}` };
    }
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown error' };
  }
}

/**
 * Sends WhatsApp notification using Green API
 * Used for admin panel notifications
 */
const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ message: 'Method Not Allowed' }),
    };
  }

  const body = JSON.parse(event.body || '{}');
  const { booking, type, customPhone, skipHeader, templateKey, templateVars } = body;
  // Accept both 'message' and 'customMessage' for flexibility
  const customMessage = body.customMessage || body.message;
  // Optional override: caller can force a specific Pro template key (used by
  // process-scheduled-system-messages-cron and triggerSystemMessageEvent for
  // custom pro_custom_* templates that wouldn't be picked by service_type).
  const explicitMessageKey: string | undefined = body.messageKey;

  // Check if Green API is configured
  if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
    console.error('Green API not configured. Set GREEN_API_INSTANCE_ID and GREEN_API_TOKEN in environment variables.');
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Green API not configured' }),
    };
  }

  let message = '';
  let targetPhone = customPhone || NOTIFICATION_PHONE;
  // Track the resolved Pro key so we can look up the email toggle after WhatsApp send.
  let usedTemplateKey: string | null = null;

  // Template key support: load template from system_messages and apply variables
  if (templateKey && !customMessage) {
    try {
      const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

      // Route legacy key → Pro key (Messaggi di Sistema Pro is the only source)
      const resolvedKey = await resolveKeyForContext(templateKey);
      if (resolvedKey === null) {
        console.log(`[send-whatsapp] No Pro template mapped for "${templateKey}" — skipping send`);
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: `No Pro template mapped for "${templateKey}" — skipped`,
            success: true,
            skipped: true,
            reason: 'pro_template_unavailable',
          }),
        };
      }

      const { data: tpl } = await sb
        .from('system_messages')
        .select('message_body, include_header, is_enabled')
        .eq('message_key', resolvedKey)
        .maybeSingle();

      usedTemplateKey = resolvedKey;

      if (tpl && tpl.is_enabled === false) {
        console.log(`[send-whatsapp] Template "${resolvedKey}" is disabled — skipping send`);
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: `Template "${resolvedKey}" is disabled — notification skipped`,
            success: true,
            skipped: true,
            reason: 'template_disabled'
          }),
        };
      }

      if (tpl?.message_body) {
        let rendered = tpl.message_body;

        // CUSTOM VARIABLES — pre-load all enabled rows from
        // system_message_variables and merge into templateVars (caller-provided
        // vars win on collision). Cosi' {address_main} / {promo_ferragosto} /
        // etc. definiti dall'admin si sostituiscono automaticamente in OGNI
        // template senza dover toccare i singoli body.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let mergedVars: Record<string, any> = {};
        try {
          const { data: customVars } = await sb
            .from('system_message_variables')
            .select('key, value, is_enabled')
            .eq('is_enabled', true);
          if (Array.isArray(customVars)) {
            for (const row of customVars) {
              const k = String((row as { key?: unknown }).key || '').trim();
              const v = String((row as { value?: unknown }).value ?? '');
              if (k) mergedVars[k] = v;
            }
          }
        } catch (e) {
          console.error('[send-whatsapp-notification] custom vars load failed (non-fatal):', e instanceof Error ? e.message : String(e));
        }
        // Caller-provided vars overlay the custom ones
        if (templateVars && typeof templateVars === 'object') {
          mergedVars = { ...mergedVars, ...templateVars };
        }
        if (Object.keys(mergedVars).length > 0) {
          // Normalise each key: strip optional leading/trailing braces and any
          // surrounding whitespace, then substitute EVERY wrapped form the
          // template may contain:
          //   {name}  {{name}}  { name }  (name)  ( name )  *{name}*
          // We support BOTH curly braces AND parentheses because admins
          // naturally write "(nome)" in Italian copy. Also handles callers
          // that pass bare keys (`'name'`) OR wrapped keys (`'{name}'`).
          //
          // Aliases: caller passes `customer_name` but Italian template
          // says `{nome}` (or vice versa) — we expand each var to its
          // common synonyms so neither side has to know the other's
          // convention. Prevents silent "Salve (nome)," leaks.
          const ALIASES: Record<string, string[]> = {
            customer_name: ['nome', 'cliente', 'fullName', 'full_name', 'firstName'],
            nome:          ['customer_name', 'cliente', 'fullName', 'full_name', 'firstName'],
            firstName:     ['nome', 'customer_name', 'cliente'],
            full_name:     ['customer_name', 'nome', 'cliente', 'fullName'],
            email:         ['customer_email'],
            customer_email:['email'],
            phone:         ['telefono', 'customer_phone'],
            customer_phone:['telefono', 'phone'],
            booking_id:    ['ref', 'reference', 'codice'],
          };
          const escRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const replaceFor = (key: string, value: string) => {
            // Se la variabile e' VUOTA e occupa una riga da sola (con bullet
            // "•", "-", "*", bold "*...*" o whitespace), elimina la riga
            // intera + il prefisso bullet. Cosi' "• {km_illimitati}" sparisce
            // pulito quando il booking non ha km illimitati.
            if (value === '') {
              rendered = rendered.replace(new RegExp(`^[ \\t]*[•\\-\\*]?[ \\t]*\\*?\\{\\{?\\s*${escRx(key)}\\s*\\}?\\}\\*?[ \\t]*\\n?`, 'gm'), '');
              rendered = rendered.replace(new RegExp(`^[ \\t]*[•\\-\\*]?[ \\t]*\\(\\s*${escRx(key)}\\s*\\)[ \\t]*\\n?`, 'gm'), '');
            }
            // {key}, {{key}}, ${key}, % key %  → all curly variants
            rendered = rendered.replace(new RegExp(`\\{\\{?\\s*${escRx(key)}\\s*\\}?\\}`, 'g'), value);
            // (key), ( key ) → parens variant (Italian admin templates)
            rendered = rendered.replace(new RegExp(`\\(\\s*${escRx(key)}\\s*\\)`, 'g'), value);
          };
          for (const [rawKey, val] of Object.entries(mergedVars)) {
            const cleanKey = String(rawKey).replace(/^\s*\{+\s*|\s*\}+\s*$/g, '').trim();
            if (!cleanKey) continue;
            const value = String(val ?? '');
            replaceFor(cleanKey, value);
            for (const alias of ALIASES[cleanKey] || []) replaceFor(alias, value);
          }
          // Cleanup finale: collapse 3+ newlines into 2 (preserva paragraph
          // breaks legittimi, rimuove gli extra introdotti da vars vuote)
          rendered = rendered.replace(/\n{3,}/g, '\n\n').trim();
        }
        // OPT-IN wrapper: only attach header/footer when this specific
        // template's include_header is explicitly TRUE (no implicit default).
        if (tpl.include_header === true && !skipHeader) {
          const { data: wrapRows } = await sb
            .from('system_messages')
            .select('message_key, message_body, is_enabled')
            .in('message_key', ['pro_wrapper_header', 'pro_wrapper_footer']);
          const hdr = wrapRows?.find((w: any) => w.message_key === 'pro_wrapper_header' && w.is_enabled !== false)?.message_body || '';
          const ftr = wrapRows?.find((w: any) => w.message_key === 'pro_wrapper_footer' && w.is_enabled !== false)?.message_body || '';
          rendered = [hdr, rendered, ftr].filter(Boolean).join('\n\n');
        }
        message = rendered;
      }
    } catch (e) {
      console.warn('[send-whatsapp] Template key lookup failed:', e);
    }
  }

  // Clean phone number - Green API format: 393457905205 (no + or spaces)
  targetPhone = targetPhone.replace(/[\s\-\+\(\)]/g, '');
  // Handle 00 international prefix (e.g., 00393921900763)
  if (targetPhone.startsWith('00')) {
    targetPhone = targetPhone.substring(2);
  }
  // 10-digit local Italian number → always prepend country code 39
  // (covers numbers starting with 39X like 392, 393, 394 mobile prefixes)
  if (targetPhone.length === 10) {
    targetPhone = '39' + targetPhone;
  }

  // Handle custom message (from admin lottery ticket sales, birthdays, etc.)
  if (message) {
    // Already set from templateKey — skip other branches
  } else if (customMessage) {
    message = customMessage;
  }
  // Booking notifications — body comes EXCLUSIVELY from Messaggi di Sistema Pro.
  // Template lookup happens further down in the `if (messageKey)` block.
  // If no Pro template resolves, the send is skipped there (no hardcoded fallback).
  else if (!booking) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'No valid data provided for notification' }),
    };
  }

  // Legacy hardcoded composition removed — body now comes exclusively from Messaggi di Sistema Pro.

  // ── Load message body from Messaggi di Sistema Pro ──
  // Determine the message key based on booking type
  // When customPhone is set, this is a CUSTOMER message — use _customer variant if available
  const isCustomerMessage = !!customPhone;
  let messageKey = '';
  if (explicitMessageKey) {
    // Caller has selected a specific Pro template (es. cron / trigger inline
    // dei Messaggi di Sistema Pro). Bypass derivazione da service_type.
    messageKey = explicitMessageKey;
  } else if (booking) {
    const serviceType = booking.service_type;
    const isEdit = booking.isEdit;
    if (serviceType === 'car_wash') {
      messageKey = isEdit ? 'carwash_modified' : (isCustomerMessage ? 'carwash_new_customer' : 'carwash_new');
    } else if (serviceType === 'mechanical') {
      messageKey = isEdit ? 'mechanical_modified' : (isCustomerMessage ? 'mechanical_new_customer' : 'mechanical_new');
    } else {
      messageKey = isEdit ? 'rental_modified' : (isCustomerMessage ? 'rental_new_customer' : 'rental_new');
    }
  }

  // If a template exists in DB, use it (admin may have edited it).
  // Header/footer wrapper policy: OPT-IN ONLY. Default off. The wrapper
  // is applied only when:
  //   - the template row has include_header === true, OR
  //   - the global global_header_footer row has include_header === true
  // AND the caller hasn't passed skipHeader=true. This way nothing gets
  // a hardcoded auto-wrapper "MESSAGGIO AUTOMATICO GENERATO DA RENTORA"
  // unless the operator explicitly enables it per-template.
  let finalMessage = message;
  let useHeader = false; // OPT-IN: caller / template must explicitly enable

  // For custom messages (no template), check the global include_header flag.
  if (!messageKey && customMessage) {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      const { data: globalSetting } = await supabase
        .from('system_messages')
        .select('include_header')
        .eq('message_key', 'global_header_footer')
        .single();
      useHeader = globalSetting?.include_header === true && !skipHeader;
    } catch { /* keep default off */ }
  }

  if (messageKey) {
    try {
      // Route every legacy key to its Pro equivalent. If the Pro template is
      // missing/disabled/empty, the resolver returns null → we skip the send
      // entirely rather than fall back to any hardcoded text.
      const resolved = await resolveKeyForContext(messageKey);
      if (resolved === null) {
        console.log(`[send-whatsapp] no Pro template mapped for "${messageKey}" — skipping send`);
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: `No Pro template mapped for "${messageKey}" — skipped`,
            success: true,
            skipped: true,
            reason: 'pro_template_unavailable',
          }),
        };
      }
      messageKey = resolved;
      usedTemplateKey = messageKey;

      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      let { data: tpl } = await supabase
        .from('system_messages')
        .select('message_body, include_header, is_enabled')
        .eq('message_key', messageKey)
        .maybeSingle();

      // Fallback: if _customer variant not found, try base key
      if (!tpl && isCustomerMessage && messageKey.endsWith('_customer')) {
        const baseKey = messageKey.replace('_customer', '');
        const { data: baseTpl } = await supabase
          .from('system_messages')
          .select('message_body, include_header, is_enabled')
          .eq('message_key', baseKey)
          .maybeSingle();
        tpl = baseTpl;
      }

      // If template exists and is explicitly disabled → DO NOT SEND
      if (tpl && tpl.is_enabled === false) {
        console.log(`[send-whatsapp] Template "${messageKey}" is disabled in Messaggi di Sistema — skipping send`);
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: `Template "${messageKey}" is disabled — notification skipped`,
            success: true,
            skipped: true,
            reason: 'template_disabled'
          }),
        };
      }

      if (tpl && tpl.message_body) {
        // Use the DB template — it's the source of truth
        finalMessage = tpl.message_body;
        // Opt-in wrapper: only apply when this specific template has
        // include_header === true (and the caller didn't pass skipHeader).
        useHeader = tpl.include_header === true && !skipHeader;

        // Substitute all known variables
        const customerName = booking.customer_name || booking.booking_details?.customer?.fullName || 'Cliente';
        const vars: Record<string, string> = {
          nome: customerName.split(' ')[0],
          customer_name: customerName,
          customer_email: booking.customer_email || booking.booking_details?.customer?.email || '',
          customer_phone: booking.customer_phone || booking.booking_details?.customer?.phone || '',
          booking_id: booking.id.substring(0, 8).toUpperCase(),
          total: (booking.price_total / 100).toFixed(2),
          vehicle_name: booking.vehicle_name || '',
          plate: booking.vehicle_plate || booking.booking_details?.vehicle?.plate || '',
          pickup_location: booking.pickup_location || '',
          // Fallback su pickup_location se dropoff non e' stato modificato:
          // tipicamente il cliente ritira e riconsegna nello stesso posto.
          dropoff_location: booking.dropoff_location || booking.pickup_location || '',
          insurance: await (async () => {
            const insId = booking.booking_details?.insuranceOption || booking.insurance_option || '';
            if (!insId) return 'N/A';
            // Look up insurance name from Centralina Pro config (match by ID or legacy name)
            try {
              const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
              const { data: proRow } = await sb.from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle();
              const insuranceList = proRow?.config?.insurance;
              if (Array.isArray(insuranceList)) {
                // Legacy ID → name mapping for bookings created before Pro UIDs
                const legacyMap: Record<string, string[]> = {
                  RCA: ['RCA', 'rca'],
                  KASKO_BASE: ['Kasko Base', 'Base'],
                  KASKO_BLACK: ['Kasko Black', 'Black'],
                  KASKO_SIGNATURE: ['Kasko Signature', 'Signature'],
                  DR7: ['Kasko DR7', 'DR7'],
                  KASKO_DR7: ['Kasko DR7', 'DR7'],
                };
                const searchNames = legacyMap[insId];
                for (const cat of insuranceList) {
                  const allOpts = [...(cat.all || [])];
                  for (const opts of Object.values(cat.byFascia || {})) allOpts.push(...(opts as any[]));
                  // Match by Pro UID
                  const byId = allOpts.find((o: any) => o.id === insId);
                  if (byId) return byId.name;
                  // Match by legacy name
                  if (searchNames) {
                    const byName = allOpts.find((o: any) => searchNames.some(n => o.name?.includes(n)));
                    if (byName) return byName.name;
                  }
                }
              }
            } catch { /* fallback */ }
            // Final fallback: humanize the ID
            return insId.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
          })(),
          payment_status: (() => {
            const ps = booking.payment_status;
            if (ps === 'paid' || ps === 'succeeded' || ps === 'completed') return 'Pagato';
            if (ps === 'pending' || ps === 'unpaid') return 'Da saldare';
            return ps || 'Da saldare';
          })(),
          service_name: booking.service_name || booking.booking_details?.serviceName || booking.booking_details?.service_name || '',
          notes: booking.booking_details?.notes || '',
        };

        // Italian-language aliases — the Pro templates often use {servizio},
        // {targa}, {pagamento}, {payment_info}, {note}. Without these the
        // placeholders leaked as raw text to the admin/customer.
        vars.servizio = vars.service_name;
        vars.targa = vars.plate;
        vars.nota = vars.notes;
        vars.note = vars.notes;
        vars.pagamento = vars.payment_status;
        vars.payment_info = vars.payment_status;
        vars.totale = vars.total;
        vars.importo = vars.total;
        vars.amount = vars.total;
        vars.cliente = vars.customer_name;
        vars.booking_ref = vars.booking_id;
        vars.bookingRef = vars.booking_id;

        // Link configurabili da Marketing → Social Links
        // (centralina_pro_config.config.marketing). Niente hardcoded
        // fallback: se admin non li ha settati, le variabili restano
        // vuote nel messaggio (segnale chiaro di config mancante).
        try {
          const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
          const { data: cfgRow } = await sb.from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mk = ((cfgRow?.config || {}) as any).marketing || {};
          vars.review_link = mk.google_review_link || process.env.GOOGLE_REVIEW_URL || process.env.GOOGLE_REVIEW_LINK || '';
          vars.website = mk.website_url || process.env.WEBSITE_URL || '';
          vars.sito = vars.website;
          vars.instagram = mk.instagram_url || '';
          vars.facebook = mk.facebook_url || '';
          // Link personalizzati creati dall'admin in Centralina → Marketing.
          // Ogni link diventa una variabile {<slug>} dove slug = lowercase
          // del titolo con underscore (stesso slug mostrato nella UI).
          if (Array.isArray(mk.custom_links)) {
            for (const l of mk.custom_links as Array<{ title?: string; url?: string }>) {
              if (typeof l?.title !== 'string' || typeof l?.url !== 'string') continue;
              const slug = l.title.toLowerCase().trim()
                .replace(/[^a-z0-9\s\-_]/g, '')
                .replace(/[\s\-]+/g, '_')
                .replace(/_+/g, '_')
                .replace(/^_|_$/g, '')
                .substring(0, 30);
              if (slug) vars[slug] = l.url;
            }
          }
        } catch {
          vars.review_link = process.env.GOOGLE_REVIEW_URL || process.env.GOOGLE_REVIEW_LINK || '';
          vars.website = process.env.WEBSITE_URL || '';
          vars.sito = vars.website;
          vars.instagram = '';
          vars.facebook = '';
        }

        // Format dates if available
        if (booking.pickup_date) {
          const pd = new Date(booking.pickup_date);
          vars.pickup_date = pd.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' });
          vars.pickup_time = pd.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' });
        }
        if (booking.dropoff_date) {
          const dd = new Date(booking.dropoff_date);
          vars.dropoff_date = dd.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' });
          vars.dropoff_time = dd.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' });
        }
        if (booking.appointment_date) {
          const ad = new Date(booking.appointment_date);
          vars.date = ad.toLocaleDateString('it-IT', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/Rome' });
          vars.time = ad.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' });
        }

        // Cauzione (deposit) for template
        const depAmount = Number(booking.deposit_amount ?? booking.booking_details?.deposit ?? 0);
        const depOption = booking.booking_details?.depositOption;
        const depStatus = booking.booking_details?.deposit_status;
        if (depOption === 'no_deposit') {
          const surcharge = Number(booking.booking_details?.noDepositSurcharge ?? 0);
          vars.deposit = `Senza cauzione (+30% = €${surcharge.toFixed(2)})`;
        } else if (depAmount > 0) {
          const statusLbl = depStatus === 'incassata' ? 'Pagata' : 'Da saldare';
          vars.deposit = `€${depAmount.toFixed(2)} - ${statusLbl}`;
        } else {
          vars.deposit = '€0';
        }

        // KM info for template — same logic as contract
        const tplUnlimitedKm = booking.booking_details?.unlimited_km;
        const tplKmLimit = booking.booking_details?.km_limit;
        const tplKmPackage = booking.booking_details?.kmPackage;
        const pkgUnlimited =
          tplKmPackage?.type === 'unlimited'
          || tplKmPackage?.distance === 'unlimited'
          || Number(tplKmPackage?.includedKm) >= 9999;
        const isUnlim = tplUnlimitedKm === true || tplKmLimit === 'Illimitati' || Number(tplKmLimit) >= 9999 || pkgUnlimited;
        if (isUnlim) {
          vars.km_info = 'Illimitati';
        } else if (tplKmLimit && tplKmLimit !== '0') {
          const isNum = !isNaN(Number(tplKmLimit)) && !String(tplKmLimit).toLowerCase().includes('km');
          vars.km_info = isNum ? `${tplKmLimit} Km` : String(tplKmLimit);
        } else if (tplKmPackage?.includedKm && Number(tplKmPackage.includedKm) > 0) {
          vars.km_info = `${tplKmPackage.includedKm} Km`;
        } else {
          vars.km_info = booking.booking_details?.total_km ? `${booking.booking_details.total_km} Km` : 'Illimitati';
        }
        // Variabile dedicata "km illimitati" — formato coerente con le altre
        // voci del preventivo ("Lavaggio Finale = 9,90", "No cauzione = 49,00").
        // Vuoto se km limitati (line-strip rimuove anche il bullet "•" davanti).
        const unlimKmCost = Number(
            booking.booking_details?.unlimited_km_total
            ?? booking.booking_details?.extras?.unlimited_km_total
            ?? booking.booking_details?.kmPackage?.cost
            ?? 0
        );
        const fmtEur = (n: number) => n.toFixed(2).replace('.', ',');
        if (isUnlim) {
            vars.km_illimitati = unlimKmCost > 0
                ? `Km Illimitati = ${fmtEur(unlimKmCost)}`
                : 'Km Illimitati = Incluso';
        } else {
            vars.km_illimitati = '';
        }
        vars.unlimited_km = vars.km_illimitati;
        // Solo l'importo grezzo (senza label), per template che vogliono
        // mostrare label e prezzo su righe separate.
        vars.km_illimitati_importo = (isUnlim && unlimKmCost > 0)
            ? fmtEur(unlimKmCost)
            : '';

        // KM package details (type + cost) for template
        if (tplKmPackage) {
          const kmType = tplKmPackage.type === 'unlimited' ? 'Illimitati' : (tplKmPackage.distance || `${tplKmPackage.includedKm || 100} Km`);
          const kmCost = Number(tplKmPackage.cost || 0);
          vars.km_package = kmCost > 0 ? `${kmType} (€${kmCost.toFixed(2)})` : `${kmType} inclusi`;
        } else {
          vars.km_package = vars.km_info;
        }

        // Replace all {variable} placeholders
        for (const [k, v] of Object.entries(vars)) {
          finalMessage = finalMessage.replace(new RegExp(`\\{${k}\\}`, 'g'), v || '');
        }
      }
    } catch (e) {
      console.warn('[send-whatsapp] Template fetch failed:', e);
    }
  }

  // Hard gate: never send an empty body (used to rely on hardcoded composition above).
  if (!finalMessage || !finalMessage.trim()) {
    console.log('[send-whatsapp] empty finalMessage — skipping send (no Pro template matched)');
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'No Pro template resolved — skipped',
        success: true,
        skipped: true,
        reason: 'empty_body_no_template',
      }),
    };
  }

  // Wrap with Messaggi di Sistema Pro header/footer if enabled.
  // NO HARDCODED FALLBACK: if the pro_wrapper_* rows are missing or disabled,
  // the message goes out without a wrapper.
  let wrappedMessage = finalMessage;
  if (useHeader) {
    try {
      const supabaseWrap = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      const { data: wrappers } = await supabaseWrap
        .from('system_messages')
        .select('message_key, message_body, is_enabled')
        .in('message_key', ['pro_wrapper_header', 'pro_wrapper_footer']);
      const headerTpl = wrappers?.find((w: any) => w.message_key === 'pro_wrapper_header' && w.is_enabled !== false);
      const footerTpl = wrappers?.find((w: any) => w.message_key === 'pro_wrapper_footer' && w.is_enabled !== false);
      const header = headerTpl?.message_body || '';
      const footer = footerTpl?.message_body || '';
      wrappedMessage = [header, finalMessage, footer].filter(Boolean).join('\n\n');
    } catch {
      wrappedMessage = finalMessage;
    }
  }

  try {
    // Send via Green API
    const greenApiUrl = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`;

    const response = await fetch(greenApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chatId: `${targetPhone}@c.us`,
        message: wrappedMessage,
      }),
    });

    const result = await response.json();

    if (!response.ok || result.error) {
      console.error('Green API error:', result);
      throw new Error(result.error || 'Green API error');
    }

    console.log('✅ WhatsApp notification sent via Green API:', result.idMessage);

    // Log to sent_messages_log — fire and forget, never blocks the response
    if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      const fullMessage = wrappedMessage;
      const customerName = booking?.customer_name || booking?.booking_details?.customer?.fullName || body.customerName || 'N/A';
      const templateLabel = body.type || (customMessage ? 'Messaggio Manuale' : booking?.service_type || 'Notifica');
      createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        .from('sent_messages_log')
        .insert({ customer_name: customerName, customer_phone: targetPhone, message_text: fullMessage, template_label: templateLabel, status: 'sent' })
        .then(() => {})
        .catch((e: unknown) => console.error('Log failed:', e));
    }

    // ── Optional email channel ──
    // If the template has send_email=true in Messaggi di Sistema Pro and
    // we have a recipient email, dispatch the same body via Resend.
    // Non-blocking: failures don't affect the WhatsApp success response.
    if (usedTemplateKey && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      try {
        const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        const { data: emailMeta } = await sb
          .from('system_messages')
          .select('send_email, email_subject, label')
          .eq('message_key', usedTemplateKey)
          .maybeSingle();
        if (emailMeta?.send_email) {
          const recipientEmail =
            body.customerEmail ||
            body.customer_email ||
            booking?.customer_email ||
            booking?.booking_details?.customer?.email ||
            null;
          if (recipientEmail && typeof recipientEmail === 'string' && recipientEmail.includes('@')) {
            const subject = (emailMeta.email_subject?.trim?.()) || emailMeta.label || 'DR7 Empire';
            const html = wrapAsEmailHtml(wrappedMessage);
            const sent = await sendEmailViaResend(recipientEmail, subject, html);
            if (sent.ok) {
              console.log(`[send-whatsapp] Email also sent to ${recipientEmail} (subject: "${subject}")`);
            } else {
              console.error(`[send-whatsapp] Email send failed (non-blocking): ${sent.error}`);
            }
          } else {
            console.log(`[send-whatsapp] Template "${usedTemplateKey}" has send_email=true but no recipient email available`);
          }
        }
      } catch (emailErr) {
        console.error('[send-whatsapp] Email channel failed (non-blocking):', emailErr);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'WhatsApp notification sent via Green API',
        success: true,
        messageId: result.idMessage
      }),
    };
  } catch (error: any) {
    console.error('Error sending WhatsApp notification:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Error sending WhatsApp notification', error: error.message }),
    };
  }
};

export { handler };
