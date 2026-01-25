import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function handler() {
    try {
        const supabase = createClient(supabaseUrl, supabaseServiceKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        })

        console.log('🔧 Starting Dubai admin permissions fix...')

        // Execute the comprehensive fix SQL
        const { data, error } = await supabase.rpc('exec_sql', {
            sql: `
        -- ============================================================================
        -- COMPREHENSIVE FIX: Dubai Admin Permissions (Persistent)
        -- ============================================================================

        -- STEP 1: Ensure admin record exists
        INSERT INTO admins (user_id, role, can_view_financials)
        SELECT
          id,
          'admin',
          false
        FROM auth.users
        WHERE email = 'dubai.rent7.0srl@gmail.com'
        ON CONFLICT (user_id) DO UPDATE
        SET 
          role = 'admin',
          can_view_financials = false;

        -- STEP 2: Fix BOOKINGS RLS Policies
        ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

        -- Drop ALL existing admin policies
        DROP POLICY IF EXISTS "Enable read access for all users" ON bookings;
        DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON bookings;
        DROP POLICY IF EXISTS "Enable update for users based on email" ON bookings;
        DROP POLICY IF EXISTS "Enable delete for users based on user_id" ON bookings;
        DROP POLICY IF EXISTS "Allow admins to view all" ON bookings;
        DROP POLICY IF EXISTS "Allow admins to insert" ON bookings;
        DROP POLICY IF EXISTS "Allow admins to update" ON bookings;
        DROP POLICY IF EXISTS "Allow admins to delete" ON bookings;
        DROP POLICY IF EXISTS "Service role has full access" ON bookings;
        DROP POLICY IF EXISTS "Users can view own bookings" ON bookings;
        DROP POLICY IF EXISTS "Admins can select bookings" ON bookings;
        DROP POLICY IF EXISTS "Admins can update bookings" ON bookings;
        DROP POLICY IF EXISTS "Admins can insert bookings" ON bookings;
        DROP POLICY IF EXISTS "Admins can delete bookings" ON bookings;

        -- Create NEW comprehensive policies
        CREATE POLICY "Admins can select bookings"
          ON bookings FOR SELECT
          TO authenticated
          USING (
            EXISTS (
              SELECT 1 FROM admins
              WHERE admins.user_id = auth.uid()
              AND admins.role IN ('admin', 'superadmin')
            )
          );

        CREATE POLICY "Admins can insert bookings"
          ON bookings FOR INSERT
          TO authenticated
          WITH CHECK (
            EXISTS (
              SELECT 1 FROM admins
              WHERE admins.user_id = auth.uid()
              AND admins.role IN ('admin', 'superadmin')
            )
          );

        CREATE POLICY "Admins can update bookings"
          ON bookings FOR UPDATE
          TO authenticated
          USING (
            EXISTS (
              SELECT 1 FROM admins
              WHERE admins.user_id = auth.uid()
              AND admins.role IN ('admin', 'superadmin')
            )
          )
          WITH CHECK (
            EXISTS (
              SELECT 1 FROM admins
              WHERE admins.user_id = auth.uid()
              AND admins.role IN ('admin', 'superadmin')
            )
          );

        CREATE POLICY "Admins can delete bookings"
          ON bookings FOR DELETE
          TO authenticated
          USING (
            EXISTS (
              SELECT 1 FROM admins
              WHERE admins.user_id = auth.uid()
              AND admins.role IN ('admin', 'superadmin')
            )
          );

        CREATE POLICY "Service role has full access"
          ON bookings
          TO service_role
          USING (true)
          WITH CHECK (true);

        CREATE POLICY "Users can view own bookings"
          ON bookings FOR SELECT
          TO authenticated
          USING (
            auth.uid() = user_id OR 
            customer_email = auth.email()
          );

        -- STEP 3: Fix CUSTOMERS_EXTENDED RLS Policies
        ALTER TABLE customers_extended ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS "Admins can select customers_extended" ON customers_extended;
        DROP POLICY IF EXISTS "Admins can insert customers_extended" ON customers_extended;
        DROP POLICY IF EXISTS "Admins can update customers_extended" ON customers_extended;
        DROP POLICY IF EXISTS "Admins can delete customers_extended" ON customers_extended;
        DROP POLICY IF EXISTS "Service role has full access" ON customers_extended;
        DROP POLICY IF EXISTS "Users can view own profile" ON customers_extended;

        CREATE POLICY "Admins can select customers_extended"
          ON customers_extended FOR SELECT
          TO authenticated
          USING (
            EXISTS (
              SELECT 1 FROM admins
              WHERE admins.user_id = auth.uid()
            )
          );

        CREATE POLICY "Admins can insert customers_extended"
          ON customers_extended FOR INSERT
          TO authenticated
          WITH CHECK (
            EXISTS (
              SELECT 1 FROM admins
              WHERE admins.user_id = auth.uid()
            )
          );

        CREATE POLICY "Admins can update customers_extended"
          ON customers_extended FOR UPDATE
          TO authenticated
          USING (
            EXISTS (
              SELECT 1 FROM admins
              WHERE admins.user_id = auth.uid()
            )
          )
          WITH CHECK (
            EXISTS (
              SELECT 1 FROM admins
              WHERE admins.user_id = auth.uid()
            )
          );

        CREATE POLICY "Admins can delete customers_extended"
          ON customers_extended FOR DELETE
          TO authenticated
          USING (
            EXISTS (
              SELECT 1 FROM admins
              WHERE admins.user_id = auth.uid()
            )
          );

        CREATE POLICY "Service role has full access"
          ON customers_extended
          TO service_role
          USING (true)
          WITH CHECK (true);

        CREATE POLICY "Users can view own profile"
          ON customers_extended FOR SELECT
          TO authenticated
          USING (auth.uid() = id);
      `
        })

        if (error) {
            console.error('❌ SQL execution error:', error)
            throw error
        }

        // Verify the fix
        const { data: verification, error: verifyError } = await supabase
            .from('admins')
            .select('role, can_view_financials')
            .eq('user_id', (await supabase.auth.admin.listUsers()).data.users.find(u => u.email === 'dubai.rent7.0srl@gmail.com')?.id)
            .single()

        console.log('✅ Fix applied successfully!')
        console.log('📋 Verification:', verification)

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                success: true,
                message: '✅ Dubai admin permissions fixed! All RLS policies applied.',
                verification: verification,
                details: {
                    bookings_policies: '6 policies (4 admin + 1 service + 1 user)',
                    customers_policies: '6 policies (4 admin + 1 service + 1 user)',
                    admin_status: 'role=admin, can_view_financials=false'
                }
            })
        }
    } catch (error: any) {
        console.error('❌ Migration failed:', error)
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                success: false,
                error: error.message,
                details: error.details || error.hint || 'No additional details'
            })
        }
    }
}
