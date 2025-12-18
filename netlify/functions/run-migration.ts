import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export const handler: Handler = async (event) => {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        }
    }

    try {
        const supabase = createClient(supabaseUrl, supabaseServiceKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        })

        // Execute the SQL directly
        const sql = `
      CREATE OR REPLACE FUNCTION public.check_vehicle_availability()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
        DECLARE
          v_check RECORD;
          v_is_update BOOLEAN;
        BEGIN
          v_is_update := (TG_OP = 'UPDATE');
          
          IF (NEW.service_type IS NULL OR NEW.service_type != 'car_wash') AND
             NEW.vehicle_plate IS NOT NULL AND
             NEW.pickup_date IS NOT NULL AND
             NEW.dropoff_date IS NOT NULL AND
             NEW.status IN ('confirmed', 'pending', 'held') THEN

            IF v_is_update AND 
               OLD.vehicle_plate = NEW.vehicle_plate AND
               OLD.pickup_date = NEW.pickup_date AND
               OLD.dropoff_date = NEW.dropoff_date THEN
              RETURN NEW;
            END IF;

            SELECT * INTO v_check
            FROM check_unified_vehicle_availability(
              NEW.vehicle_plate,
              NEW.pickup_date,
              NEW.dropoff_date,
              NEW.id
            );

            IF NOT v_check.is_available THEN
              RAISE EXCEPTION '%', v_check.conflict_message;
            END IF;
          END IF;

          RETURN NEW;
        END;
      $function$;
    `

        const { error } = await supabase.rpc('exec_sql', { sql })

        if (error) {
            console.error('SQL execution error:', error)
            throw error
        }

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                success: true,
                message: '✅ Database migration applied successfully! You can now modify bookings.'
            })
        }
    } catch (error: any) {
        console.error('Migration failed:', error)
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                success: false,
                error: error.message || 'Failed to apply migration'
            })
        }
    }
}
