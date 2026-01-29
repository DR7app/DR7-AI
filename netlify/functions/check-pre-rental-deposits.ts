import { Handler, schedule } from '@netlify/functions'
import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const resend = new Resend(process.env.RESEND_API_KEY)

interface Booking {
    id: string
    rental_start_date: string
    rental_start_time: string
    customer_name: string
    customer_email: string
    vehicle_name: string
    booking_details: any
}

function getAlarmEmailHTML(bookings: Booking[]): string {
    const bookingRows = bookings.map(b => `
        <tr style="border-bottom: 1px solid #333;">
            <td style="padding: 12px; color: #ffffff;">${new Date(b.rental_start_date + 'T' + b.rental_start_time).toLocaleString('it-IT')}</td>
            <td style="padding: 12px; color: #ffffff;">${b.customer_name}</td>
            <td style="padding: 12px; color: #ffffff;">${b.vehicle_name}</td>
            <td style="padding: 12px; color: #d4af37; font-weight: bold;">⚠️ NON PAGATA</td>
        </tr>
    `).join('')

    return `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 800px; margin: 0 auto; background-color: #000000; color: #ffffff; padding: 40px 20px;">
      <div style="text-align: center; margin-bottom: 30px;">
        <img src="https://dr7-empire-admin.netlify.app/DR7logo1.png" alt="DR7 Empire" style="height: 60px;" />
      </div>

      <h1 style="color: #ff4444; font-size: 24px; margin-bottom: 20px; text-align: center;">🚨 ALLARME CAUZIONE PRE-NOLEGGIO</h1>

      <p style="font-size: 16px; line-height: 1.6; color: #cccccc; margin-bottom: 20px;">
        I seguenti noleggi iniziano tra <strong style="color: #d4af37;">10 minuti</strong> ma la cauzione <strong style="color: #ff4444;">NON risulta presente/pagata</strong>:
      </p>

      <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background-color: #111;">
        <thead>
          <tr style="background-color: #222; border-bottom: 2px solid #d4af37;">
            <th style="padding: 12px; text-align: left; color: #d4af37;">Orario Inizio</th>
            <th style="padding: 12px; text-align: left; color: #d4af37;">Cliente</th>
            <th style="padding: 12px; text-align: left; color: #d4af37;">Veicolo</th>
            <th style="padding: 12px; text-align: left; color: #d4af37;">Stato Cauzione</th>
          </tr>
        </thead>
        <tbody>
          ${bookingRows}
        </tbody>
      </table>

      <div style="background-color: #1a0000; border-left: 4px solid #ff4444; padding: 20px; margin: 30px 0;">
        <p style="font-size: 16px; color: #ffffff; margin: 0;">
          <strong>⚠️ AZIONE RICHIESTA:</strong> Verificare immediatamente lo stato delle cauzioni prima della consegna del veicolo.
        </p>
      </div>

      <div style="border-top: 1px solid #333; padding-top: 20px; margin-top: 30px; text-align: center;">
        <p style="font-size: 14px; color: #999999; margin: 0;">
          Sistema Automatico Allarmi Cauzione – DR7 Empire Admin
        </p>
      </div>
    </div>
    `
}

const scheduledHandler: Handler = async (event) => {
    console.log('🔍 Checking for pre-rental deposits...')

    // Check if Resend is configured
    if (!process.env.RESEND_API_KEY) {
        console.log('⚠️ RESEND_API_KEY not configured, skipping deposit check')
        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Resend not configured, skipping' })
        }
    }

    try {
        // Calculate time window: 10 minutes from now
        const now = new Date()
        const tenMinutesFromNow = new Date(now.getTime() + 10 * 60 * 1000)

        // Query bookings starting in the next 10-15 minutes
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

        // Send alarm email to admin using Resend
        const adminEmail = process.env.ADMIN_EMAIL || 'info@dr7.app'

        const { error: emailError } = await resend.emails.send({
            from: 'DR7 Empire Allarmi <info@dr7.app>',
            to: adminEmail,
            subject: `🚨 ALLARME CAUZIONE: ${bookingsWithoutDeposit.length} noleggio/i senza cauzione`,
            html: getAlarmEmailHTML(bookingsWithoutDeposit),
        })

        if (emailError) {
            console.error('❌ Error sending email:', emailError)
            return {
                statusCode: 500,
                body: JSON.stringify({ error: emailError.message })
            }
        }

        console.log(`✅ Alarm sent for ${bookingsWithoutDeposit.length} booking(s) without deposit`)

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Alarm sent',
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
