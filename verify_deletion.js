
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

// Manually read .env file
try {
    const envPath = path.resolve(process.cwd(), '.env')
    const envFile = fs.readFileSync(envPath, 'utf8')
    envFile.split('\n').forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/)
        if (match) {
            const key = match[1].trim()
            const value = match[2].trim().replace(/^["']|["']$/g, '') // remove quotes
            process.env[key] = value
        }
    })
} catch (e) {
    console.log('Could not read .env file, assuming env vars are set or will fail.')
}

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Missing env vars')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function testVehicleDeletion() {
    console.log('1. Creating test vehicle...')
    const uniqueSuffix = Date.now().toString().slice(-4)
    const { data: vehicle, error: vError } = await supabase
        .from('vehicles')
        .insert({
            display_name: `Test Deletion Car ${uniqueSuffix}`,
            plate: `DEL${uniqueSuffix}`,
            status: 'available',
            daily_rate: 100,
            category: 'urban',
            metadata: {}
        })
        .select()
        .single()

    if (vError) {
        console.error('Failed to create vehicle:', vError)
        return
    }
    console.log('Created vehicle:', vehicle.id, vehicle.display_name)

    console.log('2. Creating test booking (bookings table)...')
    const { error: bError } = await supabase
        .from('bookings')
        .insert({
            vehicle_name: vehicle.display_name,
            vehicle_plate: vehicle.plate,
            vehicle_id: vehicle.id, // Trying to be complete
            pickup_date: new Date().toISOString(),
            dropoff_date: new Date(Date.now() + 86400000).toISOString(),
            pickup_location: 'test',
            dropoff_location: 'test',
            price_total: 100,
            currency: 'EUR',
            status: 'confirmed',
            payment_status: 'paid',
            customer_name: 'Test User',
            booked_at: new Date().toISOString()
        })

    if (bError) {
        console.error('Failed to create booking:', bError)
    } else {
        console.log('Created booking for vehicle')
    }

    console.log('3. Now we simulate the deletion logic...')

    // LOGIC FROM CODEBASE (SIMULATED):
    // 1. Delete matching bookings by vehicle_name
    const { error: delBookError, count: delBookCount } = await supabase
        .from('bookings')
        .delete()
        .eq('vehicle_name', vehicle.display_name)
        .select('count') // We want to see if it deletes anything

    if (delBookError) console.error('Error deleting bookings:', delBookError)
    else console.log('Deleted bookings count (should be >= 1):', delBookCount)

    // 2. Delete vehicle by ID
    const { error: delVehError } = await supabase
        .from('vehicles')
        .delete()
        .eq('id', vehicle.id)

    if (delVehError) {
        console.error('Error deleting vehicle:', delVehError)
    } else {
        console.log('✅ Vehicle deleted successfully!')
    }

    // Verify
    const { data: check } = await supabase.from('vehicles').select().eq('id', vehicle.id).single()
    if (!check) console.log('✅ Verified: Vehicle is gone.')
    else console.error('❌ Failed: Vehicle still exists.')

    // Verify booking is gone
    const { count: checkBooking } = await supabase
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('vehicle_name', vehicle.display_name)

    if (checkBooking === 0) console.log('✅ Verified: Bookings are gone.')
    else console.error(`❌ Failed: ${checkBooking} bookings still exist.`)
}

testVehicleDeletion()
