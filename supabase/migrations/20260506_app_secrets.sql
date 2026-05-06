-- app_secrets: persistent server-side storage for credentials too big for
-- AWS Lambda's 4KB env-var cap (GA4 service-account JSON, OAuth refresh
-- tokens, etc). Used by:
--   netlify/functions/ga-setup-key.ts            (writes ga4_creds)
--   netlify/functions/ga-oauth-callback.ts       (writes ga4_oauth_refresh_token)
--   netlify/functions/ga-report.ts               (reads both)

create table if not exists public.app_secrets (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Lock down: only the service_role key (used by Netlify Functions) may
-- read/write. anon and authenticated have NO access.
alter table public.app_secrets enable row level security;

revoke all on public.app_secrets from anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'app_secrets' and policyname = 'no_public_access'
  ) then
    create policy "no_public_access"
      on public.app_secrets
      for all
      to anon, authenticated
      using (false)
      with check (false);
  end if;
end $$;
