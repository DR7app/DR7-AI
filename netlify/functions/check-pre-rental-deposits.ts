import { Handler, schedule } from '@netlify/functions'

/**
 * DISABLED - This function is not needed
 * The CRM already has built-in alarm system with audio/visual alerts
 * Keeping file to prevent build errors from missing scheduled function
 */
const scheduledHandler: Handler = async (event) => {
    // Do nothing - alarm handled by CRM frontend
    return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Deposit check handled by CRM alarm system' })
    }
}

// Keep schedule to prevent errors, but function does nothing
export const handler = schedule('0 0 * * *', scheduledHandler) // Once per day at midnight (basically never triggers anything useful)
