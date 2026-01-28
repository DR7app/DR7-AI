import { Handler } from '@netlify/functions'
import { Resend } from 'resend'

export const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    }

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' }
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    try {
        const { email } = JSON.parse(event.body || '{}')

        if (!email) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Email address required' })
            }
        }

        const apiKey = process.env.RESEND_API_KEY

        if (!apiKey) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    error: 'RESEND_API_KEY not configured',
                    instructions: 'Add RESEND_API_KEY to Netlify environment variables'
                })
            }
        }

        const resend = new Resend(apiKey)

        const { data, error } = await resend.emails.send({
            from: 'DR7 Empire <info@dr7.app>',
            to: email,
            subject: '✅ Test Email - DR7 Empire',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h1 style="color: #D4AF37;">✅ Email Test Successful!</h1>
                    <p>If you're reading this, your email configuration is working correctly.</p>
                    <p><strong>From:</strong> info@dr7.app</p>
                    <p><strong>Service:</strong> Resend</p>
                    <p style="color: #666; font-size: 12px; margin-top: 30px;">DR7 Empire - Email Test</p>
                </div>
            `
        })

        if (error) {
            console.error('[test-email] Resend error:', error)
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    error: 'Failed to send email',
                    details: error.message
                })
            }
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: `Test email sent to ${email}`,
                id: data?.id
            })
        }

    } catch (error: any) {
        console.error('[test-email] Error:', error)
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to send email',
                details: error.message
            })
        }
    }
}
