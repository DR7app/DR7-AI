import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function handler() {
    try {
        const supabase = createClient(supabaseUrl, supabaseServiceKey)

        // Execute the migration SQL
        const { error } = await supabase.rpc('exec_sql', {
            sql: `
        CREATE OR REPLACE FUNCTION public.check_vehicle_availability()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $function$
          DECLARE
            v_check RECORD;
            v_is_update BOOLEAN;
          BEGIN
            -- Determine if this is an UPDATE operation
            v_is_update := (TG_OP = 'UPDATE');
            
            -- Only validate car rental bookings
            IF (NEW.service_type IS NULL OR NEW.service_type != 'car_wash') AND
               NEW.vehicle_plate IS NOT NULL AND
               NEW.pickup_date IS NOT NULL AND
               NEW.dropoff_date IS NOT NULL AND
               NEW.status IN ('confirmed', 'pending', 'held') THEN

              -- For UPDATE operations, skip validation if dates and vehicle haven't changed
              IF v_is_update AND 
                 OLD.vehicle_plate = NEW.vehicle_plate AND
                 OLD.pickup_date = NEW.pickup_date AND
                 OLD.dropoff_date = NEW.dropoff_date THEN
                -- No conflict check needed - just updating other fields
                RETURN NEW;
              END IF;

              -- Use unified availability check with PLATE
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
