# Cauzioni Integration with Existing Booking System

## Overview

The Cauzioni system has been designed to **integrate seamlessly** with your existing booking deposit workflow.

## How It Works

### Automatic Cauzione Creation

When you create a rental booking with a deposit amount:

1. **Booking is created** in ReservationsTab with deposit field filled
2. **Cauzione record is auto-created** in the `cauzioni` table
3. **Linked via** `riferimento_contratto_id` (points to booking ID)
4. **Deadline auto-calculated** (14 business days after return date)

### Two-Way Integration

#### From Booking → Cauzione (Automatic)
- When booking created with deposit > €0 → Cauzione auto-created
- When booking return date changes → Cauzione deadline auto-updates
- When booking deposit amount changes → Cauzione amount auto-updates

#### From Cauzione Tab (Manual Management)
- View all active deposits with deadlines
- Track which are expiring soon (within 3 business days)
- Mark as "Restituita" when deposit returned
- Mark as "Sbloccata" for pre-authorization releases
- Add notes and change payment method

## Workflow Example

### Creating a Rental with Deposit

**Step 1: Create Booking** (ReservationsTab)
- Customer: Mario Rossi
- Vehicle: Lamborghini Huracán
- Return Date: 2026-02-15
- **Deposit: €3000** ← You fill this as usual

**Step 2: Automatic** (Behind the scenes)
- System creates cauzione record
- Calculates deadline: 2026-02-15 + 14 business days = ~2026-03-05
- Status: "Attiva"

**Step 3: Monitor** (Cauzioni Tab)
- See the €3000 deposit in Cauzioni tab
- Get alerts when it's expiring (3 days before deadline)
- Track if it becomes overdue

**Step 4: Return Deposit** (Cauzioni Tab)
- Click "Mark Restituita"
- Add note: "Returned via bank transfer on 2026-03-01"
- Status changes to "Restituita" (terminal state)

### Extending a Booking

**Scenario**: Customer extends rental from Feb 15 → Feb 20

**What happens**:
1. You update return date in ReservationsTab
2. Cauzione auto-updates:
   - `data_restituzione_veicolo`: Feb 15 → Feb 20
   - `scadenza_cauzione`: Recalculated to ~Mar 10
   - Status: Re-evaluated (may change from "In scadenza" back to "Attiva")

## Benefits of Dedicated Cauzioni Tab

### Why not just use the deposit field in bookings?

1. **Deadline Tracking**: Automatic calculation of 14 business days (excluding holidays)
2. **Status Management**: Know which deposits are expiring or overdue
3. **Centralized View**: See all active deposits across all bookings
4. **KPI Dashboard**: Total active deposits, expiring count, overdue count
5. **Audit Trail**: Track when deposits were returned/released
6. **Compliance**: Ensure deposits are returned within legal timeframe

## Data Flow Diagram

```
┌─────────────────────┐
│  ReservationsTab    │
│  (Create Booking)   │
│  - Customer         │
│  - Vehicle          │
│  - Return Date      │
│  - Deposit: €3000   │ ← User enters deposit
└──────────┬──────────┘
           │
           │ (Trigger fires)
           ▼
┌─────────────────────┐
│  Database Trigger   │
│  auto_create_       │
│  cauzione_from_     │
│  booking()          │
└──────────┬──────────┘
           │
           │ (Creates record)
           ▼
┌─────────────────────┐
│  cauzioni table     │
│  - cliente_id       │
│  - veicolo_id       │
│  - importo: €3000   │
│  - scadenza: Mar 5  │ ← Auto-calculated
│  - stato: Attiva    │
└──────────┬──────────┘
           │
           │ (Visible in)
           ▼
┌─────────────────────┐
│  CauzioniTab        │
│  (Monitor & Manage) │
│  - Track deadline   │
│  - Mark returned    │
│  - Add notes        │
└─────────────────────┘
```

## Migration Files

### 1. Core System
`create_cauzioni_system.sql` - Creates tables, functions, triggers

### 2. Integration
`integrate_cauzioni_with_bookings.sql` - Connects to existing bookings

## Deployment Order

1. Run `create_cauzioni_system.sql` first
2. Run `integrate_cauzioni_with_bookings.sql` second
3. Deploy frontend code

## Existing Bookings

**Q**: What about bookings created before this system?

**A**: The trigger only fires on new bookings or updates. For existing bookings with deposits:

**Option 1 - Manual Entry**: Create cauzioni manually in the Cauzioni tab

**Option 2 - Backfill Script**: Run this SQL to create cauzioni for existing bookings:

```sql
INSERT INTO cauzioni (
    cliente_id,
    veicolo_id,
    riferimento_contratto_id,
    data_restituzione_veicolo,
    importo,
    metodo,
    note
)
SELECT 
    ce.id as cliente_id,
    v.id as veicolo_id,
    b.id as riferimento_contratto_id,
    b.return_date::DATE as data_restituzione_veicolo,
    (b.booking_details->>'deposit')::NUMERIC as importo,
    'bonifico' as metodo,
    'Backfilled from existing booking' as note
FROM bookings b
JOIN customers_extended ce ON ce.email = b.customer_email
JOIN vehicles v ON v.license_plate = b.vehicle_plate
WHERE (b.booking_details->>'deposit')::NUMERIC > 0
  AND NOT EXISTS (
      SELECT 1 FROM cauzioni WHERE riferimento_contratto_id = b.id
  );
```

## Summary

✅ **Seamless Integration**: Works with your existing booking workflow
✅ **Automatic**: No extra steps when creating bookings
✅ **Centralized Management**: Dedicated tab for deposit lifecycle
✅ **Compliance**: Automatic deadline tracking with Italian holidays
✅ **Flexible**: Can manually adjust payment method, add notes, etc.

The Cauzioni tab **enhances** your existing deposit workflow without changing how you create bookings!
