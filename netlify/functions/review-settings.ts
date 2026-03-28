import { getCorsOrigin } from './cors-headers'
import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const getHeaders = (origin?: string) => ({
  'Access-Control-Allow-Origin': getCorsOrigin(origin),
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
});

const handler: Handler = async (event) => {
  const headers = getHeaders(event.headers.origin);
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const queryType = event.queryStringParameters?.type;

  // ─── GET ───────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    try {
      // GET templates
      if (queryType === 'templates') {
        const { data: templates, error } = await supabase
          .from('review_templates')
          .select('*')
          .order('template_key', { ascending: true });

        if (error) {
          console.error('[review-settings] Error fetching templates:', error);
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Errore nel caricamento dei template' }),
          };
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, templates: templates || [] }),
        };
      }

      // GET settings (single row)
      const { data: settings, error } = await supabase
        .from('review_settings')
        .select('*')
        .limit(1)
        .single();

      if (error) {
        console.error('[review-settings] Error fetching settings:', error);
        // If no row exists, return defaults
        if (error.code === 'PGRST116') {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              settings: {
                auto_enabled_rental: false,
                auto_enabled_wash: false,
                rental_auto_channel: 'EMAIL_AND_WHATSAPP',
                wash_auto_channel: 'WHATSAPP_ONLY',
                wash_delay_minutes: 60,
                require_manual_for_yellow: true,
              },
            }),
          };
        }
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Errore nel caricamento delle impostazioni' }),
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, settings }),
      };
    } catch (error: any) {
      console.error('[review-settings] GET error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: error.message }),
      };
    }
  }

  // ─── POST ──────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}');

      // POST: Update template
      if (body.action === 'update_template' || body.template_key) {
        const templateKey = body.templateKey || body.template_key;
        const subject = body.subject;
        const templateBody = body.body;

        if (!templateKey || !templateBody) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'template_key e body sono obbligatori' }),
          };
        }

        // Upsert by template_key (e.g. 'RENTAL_EMAIL')
        const updateData: Record<string, any> = {
          body: templateBody,
          updated_at: new Date().toISOString(),
        };
        if (subject !== undefined) {
          updateData.subject = subject;
        }

        const { data: existing } = await supabase
          .from('review_templates')
          .select('id')
          .eq('template_key', templateKey)
          .single();

        let result;
        if (existing) {
          result = await supabase
            .from('review_templates')
            .update(updateData)
            .eq('template_key', templateKey)
            .select()
            .single();
        } else {
          result = await supabase
            .from('review_templates')
            .insert({
              template_key: templateKey,
              subject: subject || null,
              body: templateBody,
            })
            .select()
            .single();
        }

        if (result.error) {
          console.error('[review-settings] Template update error:', result.error);
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Errore nell\'aggiornamento del template' }),
          };
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, template: result.data }),
        };
      }

      // POST: Update settings
      const {
        auto_enabled_rental,
        auto_enabled_wash,
        rental_auto_channel,
        wash_auto_channel,
        wash_delay_minutes,
        require_manual_for_yellow,
      } = body;

      const settingsUpdate: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };

      if (auto_enabled_rental !== undefined) settingsUpdate.auto_enabled_rental = auto_enabled_rental;
      if (auto_enabled_wash !== undefined) settingsUpdate.auto_enabled_wash = auto_enabled_wash;
      if (rental_auto_channel !== undefined) settingsUpdate.rental_auto_channel = rental_auto_channel;
      if (wash_auto_channel !== undefined) settingsUpdate.wash_auto_channel = wash_auto_channel;
      if (wash_delay_minutes !== undefined) settingsUpdate.wash_delay_minutes = wash_delay_minutes;
      if (require_manual_for_yellow !== undefined) settingsUpdate.require_manual_for_yellow = require_manual_for_yellow;

      // Check if settings row exists
      const { data: existingSettings } = await supabase
        .from('review_settings')
        .select('id')
        .limit(1)
        .single();

      let settingsResult;
      if (existingSettings) {
        settingsResult = await supabase
          .from('review_settings')
          .update(settingsUpdate)
          .eq('id', existingSettings.id)
          .select()
          .single();
      } else {
        settingsResult = await supabase
          .from('review_settings')
          .insert({
            auto_enabled_rental: auto_enabled_rental ?? false,
            auto_enabled_wash: auto_enabled_wash ?? false,
            rental_auto_channel: rental_auto_channel ?? 'EMAIL_AND_WHATSAPP',
            wash_auto_channel: wash_auto_channel ?? 'WHATSAPP_ONLY',
            wash_delay_minutes: wash_delay_minutes ?? 60,
            require_manual_for_yellow: require_manual_for_yellow ?? true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .select()
          .single();
      }

      if (settingsResult.error) {
        console.error('[review-settings] Settings update error:', settingsResult.error);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Errore nell\'aggiornamento delle impostazioni' }),
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, settings: settingsResult.data }),
      };
    } catch (error: any) {
      console.error('[review-settings] POST error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: error.message }),
      };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
};

export { handler };
