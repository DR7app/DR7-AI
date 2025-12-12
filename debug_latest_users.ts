
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseServiceKey) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is required')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function main() {
    const { data: { users }, error } = await supabase.auth.admin.listUsers({
        page: 1,
        perPage: 5 // Get last 5 users
    })

    if (error) {
        console.error('Error fetching users:', error)
        return
    }

    console.log('Found users:', users.length)
    users.forEach(u => {
        console.log('------------------------------------------------')
        console.log(`ID: ${u.id}`)
        console.log(`Email: ${u.email}`)
        console.log(`Created: ${u.created_at}`)
        console.log('Metadata:', JSON.stringify(u.user_metadata, null, 2))
    })
}

main()
