# Project rules

- Never remove existing business logic.
- Always preserve dark mode and light mode.
- Keep DR7 branding professional.
- Use React + TypeScript + Tailwind.
- Before big changes, explain the plan first.
- Do not simplify components unless explicitly asked.

## Cauzioni on booking cancellation (4× regression history)

- Cauzioni MUST be auto-deleted when a booking is cancelled, **regardless of where the cancel comes from** — admin panel, customer-facing website, Nexi unpaid cron, prepaid card guard, direct SQL, third-party sync (Cargos), or any future code path.
- The durable enforcement lives in the database: trigger `trg_delete_cauzione_on_cancel` on `bookings AFTER UPDATE OF status` (migration `supabase/migrations/20260527_auto_delete_cauzione_on_booking_cancel.sql`). A second trigger `trg_delete_cauzione_on_booking_delete` covers hard `DELETE FROM bookings` (migration `20260527_auto_delete_cauzione_on_booking_delete.sql`).
- Both triggers preserve terminal rows: `stato IN ('Restituita', 'Incassata')` or `data_incasso IS NOT NULL` stay for audit trail.
- **Do NOT** add `DISABLE TRIGGER`, RLS rules, or schema changes that bypass these triggers without explicit approval — this bug has come back 4 times exactly because the cleanup was patched in individual code paths instead of enforced at the DB level.
- When adding any new code path that cancels or deletes a booking, you can rely on the trigger — no need to manually delete the cauzione from your code. Just flip the status (or hard-delete) and the trigger handles the rest.
- If the bug is ever reported again, first verify the trigger is still installed before touching code:
  ```sql
  SELECT tgname, tgenabled FROM pg_trigger
  WHERE tgname IN ('trg_delete_cauzione_on_cancel', 'trg_delete_cauzione_on_booking_delete');
  ```
  Both rows should appear with `tgenabled = 'O'`. If missing, re-apply the two migrations above.
