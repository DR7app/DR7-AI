import { Handler, schedule } from '@netlify/functions'

/**
 * DEPRECATED — Birthday messages are now handled by send-birthday-messages.ts
 * which sends WhatsApp messages via Green API on schedule (daily at 8:00 UTC).
 * This file is kept as a no-op to avoid deploy errors if previously registered.
 */
const scheduledHandler: Handler = async (event) => {
    console.log('[check-birthdays] No-op — see send-birthday-messages.ts')
    return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Handled by send-birthday-messages.ts' })
    }
}

export const handler = schedule('0 10 * * *', scheduledHandler)
