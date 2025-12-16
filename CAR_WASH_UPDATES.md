# Car Wash Service Updates

## New Pricing & Duration

| Service | Price | Duration | Morning Slots | Afternoon Slots |
|---------|-------|----------|---------------|-----------------|
| Lavaggio Completo | €25 | 45 min | 9:00 - 12:00 | 15:00 - 18:00 |
| Lavaggio Top | €49 | 1h 30min | 9:00 - 11:30 | 15:00 - 17:30 |
| Lavaggio VIP | €75 | 2h | 9:00 - 11:00 | 15:00 - 17:00 |
| Lavaggio DR7 Luxury | €99 | 2h 30min | 9:00 - 10:30 | 15:00 - 16:30 |

## Files to Update

1. **Database trigger** - `fix-car-wash-double-booking.sql` (durations)
2. **Main website booking** - Car wash booking page (prices, durations, slots)
3. **Admin panel** - Car wash bookings tab (durations for conflict checking)
4. **Calendar display** - Show correct durations

## Implementation Notes

- Morning slots: 9:00 AM - 12:00 PM (with service duration subtracted)
- Afternoon slots: 3:00 PM - 6:00 PM (with service duration subtracted)
- Lunch break: 12:00 PM - 3:00 PM (no bookings)
- Conflict checking must account for new durations
