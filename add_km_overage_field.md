# Adding "Sforo per KM" Field

## ✅ What Was Done:

### 1. Database Migration Created
**File**: `supabase/migrations/add_km_overage_fee.sql`

Adds `km_overage_fee` column to `bookings` table to store the per-kilometer overage charge.

### 2. Run Migration in Supabase

Go to Supabase SQL Editor and run:
```sql
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS km_overage_fee DECIMAL(10,2) DEFAULT 0.00;
```

### 3. Field Will Be Added to Booking Forms

The field will be added to:
- ReservationsTab (rental bookings)
- Contract generation will include this value

### 4. PDF Field Name

In your contract PDF, create a field named:
- **`KMOverageFee`** - for the "Sforo per KM:" value

### 5. Typical Values

- **Urban cars**: €0.30 - €0.50 per km
- **Standard cars**: €0.50 - €1.00 per km  
- **Supercar**: €1.00 - €2.00 per km

---

## 🎯 Next Steps:

1. Run the migration in Supabase
2. I'll update the booking form to include this field
3. Add `KMOverageFee` field to your PDF contract template
