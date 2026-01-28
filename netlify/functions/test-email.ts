import { Handler } from '@netlify/functions'
import nodemailer from 'nodemailer'

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

        // Check SMTP configuration
        const smtpHost = process.env.SMTP_HOST
        const smtpUser = process.env.SMTP_USER
        const smtpPass = process.env.SMTP_PASSWORD

        console.log('[test-email] SMTP Config:', {
            host: smtpHost || 'NOT SET',
            user: smtpUser ? 'SET' : 'NOT SET',
            pass: smtpPass ? 'SET' : 'NOT SET'
        })

        if (!smtpUser || !smtpPass) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    error: 'SMTP not configured',
                    details: {
                        SMTP_HOST: smtpHost ? '✅ SET' : '❌ NOT SET',
                        SMTP_USER: smtpUser ? '✅ SET' : '❌ NOT SET',
                        SMTP_PASSWORD: smtpPass ? '✅ SET' : '❌ NOT SET'
                    }
                })
            }
        }

        const transporter = nodemailer.createTransport({
            host: smtpHost || 'smtp.secureserver.net',
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: smtpUser,
                pass: smtpPass,
            },
        })

        await transporter.sendMail({
            from: '"DR7 Empire Test" <info@dr7.app>',
            to: email,
            subject: '✅ Test Email - DR7 Empire',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h1 style="color: #D4AF37;">✅ Email Test Successful!</h1>
                    <p>If you're reading this, your SMTP configuration is working correctly.</p>
                    <p><strong>From:</strong> info@dr7.app</p>
                    <p><strong>SMTP Host:</strong> ${smtpHost || 'smtp.secureserver.net'}</p>
                    <p style="color: #666; font-size: 12px; margin-top: 30px;">DR7 Empire - Email Test</p>
                </div>
            `
        })

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: `Test email sent to ${email}`
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
