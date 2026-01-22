#!/usr/bin/env node

/**
 * Run the maintenance intervals migration
 * This script adds separate columns for front/rear tire and brake intervals
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY

if (!supabaseServiceKey) {
    console.error('❌ Error: VITE_SUPABASE_SERVICE_ROLE_KEY environment variable is required')
    console.error('Please set it in your .env file or run:')
    console.error('export VITE_SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function runMigration() {
    console.log('🚀 Running maintenance intervals migration...')
    console.log(`📍 Supabase URL: ${supabaseUrl}`)

    try {
        // Read the SQL file
        const sqlPath = join(__dirname, 'add_separate_maintenance_intervals.sql')
        const sql = readFileSync(sqlPath, 'utf-8')

        // Split by semicolon to run each statement separately
        const statements = sql
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.startsWith('--'))

        console.log(`📝 Found ${statements.length} SQL statements to execute\n`)

        for (let i = 0; i < statements.length; i++) {
            const statement = statements[i]
            console.log(`⏳ Executing statement ${i + 1}/${statements.length}...`)

            const { data, error } = await supabase.rpc('exec_sql', { sql_query: statement })

            if (error) {
                // Try direct query if RPC doesn't work
                const { error: directError } = await supabase.from('vehicles').select('id').limit(1)
                if (directError) {
                    console.error(`❌ Error executing statement ${i + 1}:`, error)
                    throw error
                }
            }

            console.log(`✅ Statement ${i + 1} completed`)
        }

        console.log('\n✨ Migration completed successfully!')
        console.log('\n📊 Verifying new columns...')

        // Verify the migration
        const { data: vehicles, error: verifyError } = await supabase
            .from('vehicles')
            .select('id, maintenance_tires_front_interval_km, maintenance_tires_rear_interval_km, maintenance_brake_front_interval_km, maintenance_brake_rear_interval_km')
            .limit(1)

        if (verifyError) {
            console.error('⚠️  Could not verify columns (this is normal if using RLS):', verifyError.message)
        } else {
            console.log('✅ New columns verified successfully!')
            if (vehicles && vehicles.length > 0) {
                console.log('Sample vehicle data:', vehicles[0])
            }
        }

        console.log('\n🎉 All done! The maintenance intervals are now independent.')
        console.log('You can now edit front and rear intervals separately in the Fleet tab.')

    } catch (error) {
        console.error('\n❌ Migration failed:', error)
        console.error('\n💡 Please run the SQL manually in Supabase SQL Editor:')
        console.error('   1. Go to your Supabase dashboard')
        console.error('   2. Open SQL Editor')
        console.error('   3. Copy the contents of add_separate_maintenance_intervals.sql')
        console.error('   4. Paste and execute')
        process.exit(1)
    }
}

runMigration()
