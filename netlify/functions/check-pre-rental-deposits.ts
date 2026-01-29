import { Handler, schedule } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN
const NOTIFICATION_PHONE = process.env.NOTIFICATION_PHONE || "393457905205"

interface Booking {
    id: string
    rental_start_date: string
    rental_start_time: string
    customer_name: string
    customer_email: string
    vehicle_name: string
    booking_details: any
}

async function sendWhatsAppAlert(message: string): Promise<boolean> {
    if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
        console.error('Green API not configured')
        return false
    }

    try {
        const greenApiUrl = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`

        const response = await fetch(greenApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chatId: `${NOTIFICATION_PHONE}@c.us`,
                message: message,
            }),
        })

        const result = await response.json()

        if (!response.ok || result.error) {
            console.error('Green API error:', result)
            return false
        }

        console.log('✅ WhatsApp alert sent:', result.idMessage)
        return true
    } catch (error) {
        console.error('Error sending WhatsApp:', error)
        return false
    }
}

const scheduledHandler: Handler = async (event) => {
    console.log('🔍 Checking for pre-rental deposits...')

    // Check if Green API is configured
    if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
        console.log('⚠️ Green API not configured, skipping deposit check')
        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Green API not configured, skipping' })
        }
    }

    try {
        // Calculate time window: 10 minutes from now
        const now = new Date()
        const tenMinutesFromNow = new Date(now.getTime() + 10 * 60 * 1000)

        // Query bookings starting today
        const { data: upcomingBookings, error } = await supabase
            .from('bookings')
            .select('*')
            .gte('rental_start_date', now.toISOString().split('T')[0])
            .lte('rental_start_date', tenMinutesFromNow.toISOString().split('T')[0])
            .neq('status', 'cancelled')

        if (error) {
            console.error('❌ Error fetching bookings:', error)
            return {
                statusCode: 500,
                body: JSON.stringify({ error: error.message })
            }
        }

        if (!upcomingBookings || upcomingBookings.length === 0) {
            console.log('✅ No upcoming bookings in the next 10 minutes')
            return {
                statusCode: 200,
                body: JSON.stringify({ message: 'No upcoming bookings' })
            }
        }

        // Filter bookings that:
        // 1. Start in exactly 10-15 minutes
        // 2. Don't have a deposit paid
        const bookingsWithoutDeposit: Booking[] = []

        for (const booking of upcomingBookings) {
            const startDateTime = new Date(booking.rental_start_date + 'T' + (booking.rental_start_time || '09:00'))
            const minutesUntilStart = (startDateTime.getTime() - now.getTime()) / (1000 * 60)

            // Check if between 10 and 15 minutes (to avoid duplicate alerts)
            if (minutesUntilStart >= 10 && minutesUntilStart <= 15) {
                // Check if deposit is missing or not paid
                const depositAmount = booking.booking_details?.cauzione || booking.booking_details?.deposit || 0
                const depositPaid = booking.booking_details?.cauzione_pagata || booking.booking_details?.deposit_paid || false

                if (depositAmount > 0 && !depositPaid) {
                    bookingsWithoutDeposit.push(booking)
                }
            }
        }

        if (bookingsWithoutDeposit.length === 0) {
            console.log('✅ All upcoming bookings have deposits paid')
            return {
                statusCode: 200,
                body: JSON.stringify({ message: 'All deposits paid' })
            }
        }

        // Build WhatsApp message
        let message = `🚨 *ALLARME CAUZIONE PRE-NOLEGGIO*\n\n`
        message += `${bookingsWithoutDeposit.length} noleggio/i iniziano tra 10 minuti *SENZA CAUZIONE PAGATA*:\n\n`

        for (const b of bookingsWithoutDeposit) {
            const startTime = new Date(b.rental_start_date + 'T' + (b.rental_start_time || '09:00'))
            message += `⚠️ *${b.vehicle_name}*\n`
            message += `   Cliente: ${b.customer_name}\n`
            message += `   Orario: ${startTime.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}\n\n`
        }

        message += `*Verificare immediatamente le cauzioni!*`

        // Send WhatsApp alert
        const sent = await sendWhatsAppAlert(message)

        if (!sent) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'Failed to send WhatsApp alert' })
            }
        }

        console.log(`✅ Alarm sent for ${bookingsWithoutDeposit.length} booking(s) without deposit`)

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Alarm sent via WhatsApp',
                count: bookingsWithoutDeposit.length,
                bookings: bookingsWithoutDeposit.map(b => ({
                    id: b.id,
                    customer: b.customer_name,
                    vehicle: b.vehicle_name,
                    start: b.rental_start_date + ' ' + b.rental_start_time
                }))
            })
        }

    } catch (error: any) {
        console.error('❌ Error in check-pre-rental-deposits:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        }
    }
}

// Run every 5 minutes to catch the 10-minute window
export const handler = schedule('*/5 * * * *', scheduledHandler)
