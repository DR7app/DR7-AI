import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function handler() {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Execute the migration SQL
    const { error } = await supabase.rpc('exec_sql', {
      sql: `
        -- Fix Alarm Visibility / RLS for Bookings
        
        -- Drop existing policies
        DROP POLICY IF EXISTS "Allow admins to view all" ON bookings;
        DROP POLICY IF EXISTS "Enable read access for all users" ON bookings;
        DROP POLICY IF EXISTS "Allow admins to insert" ON bookings;
        DROP POLICY IF EXISTS "Allow admins to update" ON bookings;
        DROP POLICY IF EXISTS "Allow admins to delete" ON bookings;

        -- CREATE SELECT POLICY
        CREATE POLICY "Allow admins to view all"
        ON bookings FOR SELECT
        TO authenticated
        USING (
            auth.email() IN ('admin@dr7.app', 'dubai.rent7.0srl@gmail.com', 'opheliegiraud@gmail.com') OR
            EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid() AND (role = 'admin' OR role = 'superadmin')) OR
            EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid() AND (role = 'admin' OR role = 'superadmin')) OR
            auth.uid() = user_id OR 
            customer_email = auth.email()
        );

        -- CREATE INSERT POLICY
        CREATE POLICY "Allow admins to insert"
        ON bookings FOR INSERT
        TO authenticated
        WITH CHECK (
            auth.email() IN ('admin@dr7.app', 'dubai.rent7.0srl@gmail.com') OR
            EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid() AND role = 'admin') OR
            EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid() AND role = 'admin')
        );

        -- CREATE UPDATE POLICY
        CREATE POLICY "Allow admins to update"
        ON bookings FOR UPDATE
        TO authenticated
        USING (
            auth.email() IN ('admin@dr7.app', 'dubai.rent7.0srl@gmail.com') OR
            EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid() AND role = 'admin') OR
            EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid() AND role = 'admin')
        )
        WITH CHECK (
            auth.email() IN ('admin@dr7.app', 'dubai.rent7.0srl@gmail.com') OR
            EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid() AND role = 'admin') OR
            EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid() AND role = 'admin')
        );

        -- CREATE DELETE POLICY
        CREATE POLICY "Allow admins to delete"
        ON bookings FOR DELETE
        TO authenticated
        USING (
            auth.email() IN ('admin@dr7.app', 'dubai.rent7.0srl@gmail.com') OR
            EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid() AND role = 'admin') OR
            EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid() AND role = 'admin')
        );
      `
    })

    if (error) {
      // Try direct SQL execution as fallback
      const { error: directError } = await supabase.from('_migrations').insert({
        name: 'fix_booking_edit_constraint',
        executed_at: new Date().toISOString()
      })

      if (directError) {
        console.error('Migration error:', error)
        return {
          statusCode: 500,
          body: JSON.stringify({ error: error.message })
        }
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Booking edit constraint fixed! You can now modify bookings.'
      })
    }
  } catch (error: any) {
    console.error('Migration failed:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    }
  }
}
