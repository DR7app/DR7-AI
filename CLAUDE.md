# Project rules

- Never remove existing business logic.
- Always preserve dark mode and light mode.
- Keep DR7 branding professional.
- Use React + TypeScript + Tailwind.
- Before big changes, explain the plan first.
- Do not simplify components unless explicitly asked.

## How to apply

### 1. Never remove existing business logic
Restyling and refactoring are fine, but the data flow, handlers, gating, side effects, and Supabase RPCs that ship to customers must keep working. When a redesign touches a component that contains business logic, **preserve every handler / query / state machine** and only restructure the JSX around them. Dated `// 2026-MM-DD:` comments are scar tissue from past bugs — leave them alone.

### 2. Always preserve dark mode AND light mode
Every screen has to read correctly in both. Prefer the theme tokens (`bg-theme-bg-primary`, `bg-theme-bg-secondary`, `bg-theme-bg-tertiary`, `bg-theme-bg-hover`, `text-theme-text-primary`, `text-theme-text-secondary`, `text-theme-text-muted`, `border-theme-border`) — they auto-switch via the `.dark` / `.light` class on `<html>`.
- When using hardcoded colors, **always pair** with the opposite-mode variant: `bg-white dark:bg-zinc-950`, `text-zinc-900 dark:text-white`.
- Never use bare `bg-black`, `bg-zinc-900`, `text-white`, etc. without a light-mode counterpart. (Modal scrims like `bg-black/50` are the accepted exception.)
- For dynamic backgrounds driven by inline `style`, derive from `useTheme().theme` and **provide both branches**. Never assume dark.

### 3. Keep DR7 branding professional
Clean, enterprise-grade, automotive-luxury feel. Cyan as the brand accent. No flashy/gamer animations. Italian UI copy. Never rebrand placeholder content to match an external reference site (e.g. don't repurpose Ashley Brows assets while wiring up bookings).

### 4. Use React + TypeScript + Tailwind
No new state libraries, CSS-in-JS, or styling systems. Reach for existing utilities (theme tokens, existing hooks) before introducing new dependencies. When adding chart code, reuse `recharts` (already in the dep tree). When adding motion, reuse `framer-motion`.

### 5. Before big changes, explain the plan first
"Big" = a refactor that touches multiple files, restructures a tab's information architecture, or changes a shared utility / Netlify function / Supabase schema. Drop a short bullet plan in chat, wait for approval, then ship. Single-file fixes and clear edits don't need a plan.

### 6. Do not simplify components unless explicitly asked
If a component has many state variables, conditionals, or sub-renders, that's deliberate. Don't collapse it, don't pull state out into "cleaner" hooks, don't replace inline logic with an abstraction. Match the existing density.

## Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS, framer-motion, recharts, react-leaflet
- **Backend**: Supabase (Postgres + RLS + auth), Netlify Functions
- **Timezone**: all timestamps stored UTC, displayed `Europe/Rome`

## Repo layout

- `src/pages/admin/AdminDashboard.tsx` — admin shell + sidebar (12 sections grouped CORE BUSINESS / GESTIONE / SISTEMI)
- `src/pages/admin/components/*.tsx` — one file per admin tab
- `netlify/functions/*.ts` — serverless API + business logic
- `supabase/` — schema, RLS, migrations

## Working with the AI

- The AI may sync this repo into `DR7app/BETA-AI` (staging mirror) and re-apply design on top. Trigger phrase: **"sync admin to beta"**. The reverse (design back into admin) is done file-by-file, surgically — never with a force push to `bonaparks-dev/dr7-empire-admin`.
- Files the AI keeps un-committed in admin-temp's working tree are design WIP. Don't `git reset --hard` without checking with the user first.
- When debugging, prefer to read the actual file rather than acting on memory. The repo evolves fast.

## Anti-patterns to refuse

- `--no-verify`, `--no-gpg-sign`, or skipping hooks.
- Force-pushing to `main` on `bonaparks-dev/dr7-empire-admin`.
- Replacing semantic theme tokens with hardcoded colors "for performance".
- Deleting dated `// 2026-MM-DD:` regression comments.
- Quietly removing error handling, validation, or override gates (`OTP`, permission checks, `LimitationOverrideModal`) as part of a redesign.

---

## Cauzioni on booking cancellation (4× regression history)

**Rule (plain English):** when a booking with a cauzione becomes `status = cancelled`, the cauzione disappears from the Cauzioni tab automatically. No manual cleanup, no orphan rows. Same for hard-delete (`DELETE FROM bookings`).

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
