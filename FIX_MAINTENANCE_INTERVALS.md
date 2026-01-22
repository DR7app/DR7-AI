# Fix: Separate Maintenance Intervals for Front and Rear Components

## Problem
The maintenance interval fields for "Manutenzioni intervallo anteriore" (front) and "Manutenzioni intervallo posteriore" (rear) were linked together. When you changed one value, the other would also change because they were both using the same database field.

## Root Cause
Both the front and rear interval input fields were bound to the same database columns:
- **Tires (Gomme)**: Both front and rear used `maintenance_tires_interval_km`
- **Brakes (Pastiglie)**: Both front and rear used `maintenance_brake_interval_km`

## Solution
Created separate database fields and TypeScript properties for front and rear intervals:

### New Database Columns
- `maintenance_tires_front_interval_km` - Front tires interval
- `maintenance_tires_rear_interval_km` - Rear tires interval  
- `maintenance_brake_front_interval_km` - Front brakes interval
- `maintenance_brake_rear_interval_km` - Rear brakes interval

### Files Modified

1. **src/types.ts**
   - Added new optional fields to the `Vehicle` interface
   - Marked old shared fields as legacy for backward compatibility

2. **src/pages/admin/components/FleetVehicleDetail.tsx**
   - Updated input fields to use separate front/rear interval fields
   - Updated alert calculation logic to check each interval independently
   - Updated "Prossimo cambio" (next change) calculations

3. **add_separate_maintenance_intervals.sql** (NEW)
   - SQL migration script to add new columns to the database
   - Automatically migrates existing data from old shared columns to new separate columns

## How to Apply

### Step 1: Run the SQL Migration
Execute the SQL migration file in your Supabase SQL editor:
```bash
# The file is located at:
# /Users/opheliegiraud/antigravity-dr7/DR7-empire-admin/add_separate_maintenance_intervals.sql
```

### Step 2: Deploy the Code
The TypeScript changes are already in place. Just deploy as normal.

## Data Migration
The SQL script automatically copies existing interval values to both the front and rear columns, so you won't lose any data. After migration:
- If a vehicle had `maintenance_tires_interval_km = 30000`, both front and rear will be set to 30000
- If a vehicle had `maintenance_brake_interval_km = 40000`, both front and rear will be set to 40000
- You can then edit them independently

## Backward Compatibility
The old columns (`maintenance_tires_interval_km` and `maintenance_brake_interval_km`) are kept in the database and TypeScript types for backward compatibility, but they are no longer used in the UI.

## Testing
After deployment, verify:
1. Open any vehicle detail page in the Fleet tab
2. Go to "Manutenzione (KM)" tab
3. Change the "Intervallo (km)" for "Gomme Anteriori" (front tires)
4. Verify that "Gomme Posteriori" (rear tires) interval does NOT change
5. Repeat for brake intervals
