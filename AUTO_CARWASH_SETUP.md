# Automatic Car Wash on Vehicle Return - Setup Complete

## What Was Implemented

An automatic car wash booking system that creates a 45-minute "Lavaggio Completo" booking whenever a rental vehicle is returned.

## How It Works

1. **Trigger Activation**: When a rental booking reaches its `dropoff_date`, a PostgreSQL trigger automatically fires
2. **Smart Slot Finding**: The system searches for the next available 45-minute slot:
   - Starts at the exact dropoff time
   - If occupied, checks the next 15-minute slot
   - Continues checking up to 2.5 hours ahead
   - Avoids conflicts with existing car wash and mechanical service bookings
3. **Booking Creation**: Creates a car wash booking with:
   - Service: "Lavaggio Completo" (45 minutes)
   - Price: €25
   - Status: "confirmed"
   - Payment: "pending"
   - Auto-generated customer name: "Auto-generato (Rientro)"

## Files Created

- **Migration**: `supabase/migrations/create_auto_carwash_on_return.sql`
- **Test Script**: `test_auto_carwash_trigger.sql`

## Installation Steps

1. **Apply the migration**:
   - The SQL has been copied to your clipboard
   - Go to your Supabase Dashboard → SQL Editor
   - Paste and run the migration

2. **Verify installation**:
   ```sql
   -- Check if trigger exists
   SELECT tgname, tgtype, tgenabled 
   FROM pg_trigger 
   WHERE tgname LIKE '%auto_carwash%';
   ```

## Testing

### Quick Test
Run the test script in Supabase SQL Editor:
```bash
# The test script is in: test_auto_carwash_trigger.sql
```

### Real-World Test
1. Create a rental booking with a dropoff time in the near future
2. Wait for the dropoff time to pass
3. Check the following tabs:
   - **Prenotazioni Car Wash** - should show the new car wash booking
   - **Calendario Car Wash** - should display it in the calendar
   - **Calendario Giornaliero** - should show it in the daily view

## Features

✅ **Automatic Creation**: No manual intervention needed  
✅ **Smart Scheduling**: Finds next available slot if dropoff time is occupied  
✅ **Conflict Prevention**: Respects existing car wash and mechanical bookings  
✅ **Duplicate Prevention**: Won't create multiple car washes for the same return  
✅ **Coherent Logic**: Integrates seamlessly with existing booking system  

## Booking Details

The auto-created car wash bookings include metadata:
```json
{
  "auto_created": true,
  "source_booking_id": "original-rental-booking-id",
  "source_vehicle": "Vehicle Name",
  "original_dropoff": "2026-01-08T10:00:00Z",
  "notes": "Lavaggio automatico creato al rientro del veicolo"
}
```

## Visibility

The car wash bookings are automatically visible in:
1. **Prenotazioni Car Wash** (CarWashBookingsTab) - filters by `service_type = 'car_wash'`
2. **Calendario Car Wash** (CarWashCalendarTab) - displays all car wash appointments
3. **Calendario Giornaliero** (DailyCalendarTab) - shows all bookings including car wash

## Notes

- The trigger only activates for rental bookings (no `service_type` or `service_type = 'rental'`)
- Cancelled bookings are ignored
- The system checks for existing car wash bookings to prevent duplicates
- If no slot is available within 2.5 hours, it creates the booking at dropoff time anyway (admin can manually adjust)
