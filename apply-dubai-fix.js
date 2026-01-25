#!/usr/bin/env node
/**
 * DIRECT FIX: Apply Dubai Admin Permissions
 * Run this script to immediately fix the RLS policies
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config()

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing environment variables!')
    console.error('Required: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
})

async function applyFix() {
    console.log('🔧 Starting Dubai admin permissions fix...\n')

    try {
        // Read the SQL file
        const sqlPath = path.join(__dirname, 'fix_dubai_admin_permissions_complete.sql')

        if (!fs.existsSync(sqlPath)) {
            console.error('❌ SQL file not found:', sqlPath)
            process.exit(1)
        }

        const sql = fs.readFileSync(sqlPath, 'utf8')

        console.log('📄 Executing SQL migration...')

        // Split SQL into individual statements and execute them
        const statements = sql
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('SELECT'))

        for (const statement of statements) {
            if (statement.includes('SELECT') && !statement.includes('INSERT') && !statement.includes('CREATE') && !statement.includes('DROP') && !statement.includes('ALTER')) {
                // Skip SELECT-only statements (verification queries)
                continue
            }

            const { error } = await supabase.rpc('exec_sql', { sql: statement + ';' })
            if (error && !error.message.includes('already exists') && !error.message.includes('does not exist')) {
                console.error('⚠️  Error executing statement:', error.message)
                console.error('Statement:', statement.substring(0, 100) + '...')
            }
        }

        console.log('\n✅ SQL migration executed!')

        // Verify the fix
        console.log('\n📋 Verifying fix...')

        const { data: users } = await supabase.auth.admin.listUsers()
        const dubaiUser = users.users.find(u => u.email === 'dubai.rent7.0srl@gmail.com')

        if (!dubaiUser) {
            console.error('❌ Dubai user not found!')
            process.exit(1)
        }

        const { data: adminRecord, error: adminError } = await supabase
            .from('admins')
            .select('role, can_view_financials')
            .eq('user_id', dubaiUser.id)
            .single()

        if (adminError) {
            console.error('❌ Error fetching admin record:', adminError.message)
        } else {
            console.log('✅ Admin record:', adminRecord)
        }

        // Check policies
        const { data: bookingsPolicies } = await supabase
            .from('pg_policies')
            .select('policyname, cmd')
            .eq('tablename', 'bookings')
            .like('policyname', '%Admins%')

        console.log('\n📋 Bookings policies:', bookingsPolicies?.length || 0, 'admin policies found')
        bookingsPolicies?.forEach(p => console.log(`  - ${p.policyname} (${p.cmd})`))

        const { data: customersPolicies } = await supabase
            .from('pg_policies')
            .select('policyname, cmd')
            .eq('tablename', 'customers_extended')
            .like('policyname', '%Admins%')

        console.log('\n👥 Customers policies:', customersPolicies?.length || 0, 'admin policies found')
        customersPolicies?.forEach(p => console.log(`  - ${p.policyname} (${p.cmd})`))

        console.log('\n✅ FIX COMPLETE!')
        console.log('\n📝 Next steps:')
        console.log('1. Log in as dubai.rent7.0srl@gmail.com')
        console.log('2. Try to edit a booking')
        console.log('3. Verify no permission denied error')
        console.log('4. Verify customer data is pre-filled\n')

    } catch (error) {
        console.error('❌ Error:', error.message)
        process.exit(1)
    }
}

applyFix()
