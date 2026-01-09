import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) }
    }

    try {
        const { templateName, subject, htmlContent, textContent } = JSON.parse(event.body || '{}')

        if (!templateName || !subject || !htmlContent || !textContent) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing required fields: templateName, subject, htmlContent, textContent' })
            }
        }

        // Deactivate all existing templates
        await supabase
            .from('lottery_email_templates')
            .update({ is_active: false })
            .eq('is_active', true)

        // Insert new template as active
        const { data, error } = await supabase
            .from('lottery_email_templates')
            .insert([{
                template_name: templateName,
                subject,
                html_content: htmlContent,
                text_content: textContent,
                is_active: true,
                updated_at: new Date().toISOString()
            }])
            .select()
            .single()

        if (error) {
            console.error('[save-lottery-email-template] Error:', error)
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'Failed to save template: ' + error.message })
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: 'Template saved successfully',
                template: data
            })
        }

    } catch (error: any) {
        console.error('[save-lottery-email-template] Error:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: error.message || 'Unknown error occurred'
            })
        }
    }
}
