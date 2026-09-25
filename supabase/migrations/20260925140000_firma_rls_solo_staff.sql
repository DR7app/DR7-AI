-- 25/09/2026 — Firma: tabelle chiuse al pubblico.
--
-- Le politiche "Service role full access" erano scritte senza TO service_role:
-- valevano per PUBLIC con USING (true). Chiunque avesse la chiave anon (e' nel
-- bundle del sito e del gestionale) poteva leggere token e OTP, cambiare il
-- device_id legato al link e modificare o cancellare l'audit trail.
-- La service role non ne ha bisogno: bypassa la RLS.
--
-- "Admin full access" usava auth.role() = 'authenticated': anche un cliente
-- registrato sul sito e' authenticated. Ora solo lo staff attivo in `admins`
-- (piu' la direzione, stessa regola di dr7_is_direzione()).
--
-- Audit trail append-only: nessuno lo modifica (nemmeno la service role).
-- Resta la cancellazione da parte dello staff, che la tab DR7 Trust usa
-- quando elimina un documento (e il CASCADE da signature_requests).

create or replace function public.dr7_is_staff()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.admins a
     where a.user_id = auth.uid()
       and a.archived_at is null
  ) or public.dr7_is_direzione();
$$;

revoke all on function public.dr7_is_staff() from public;
grant execute on function public.dr7_is_staff() to authenticated;

drop policy if exists "Service role full access on signature_requests" on public.signature_requests;
drop policy if exists "Admin full access on signature_requests" on public.signature_requests;
drop policy if exists "Service role full access on signature_audit_trail" on public.signature_audit_trail;
drop policy if exists "Admin full access on signature_audit_trail" on public.signature_audit_trail;

create policy "Staff gestisce signature_requests"
  on public.signature_requests
  for all
  to authenticated
  using (public.dr7_is_staff())
  with check (public.dr7_is_staff());

create policy "Staff legge signature_audit_trail"
  on public.signature_audit_trail
  for select
  to authenticated
  using (public.dr7_is_staff());

create policy "Staff elimina signature_audit_trail"
  on public.signature_audit_trail
  for delete
  to authenticated
  using (public.dr7_is_staff());

revoke all on public.signature_requests from anon;
revoke all on public.signature_audit_trail from anon;

create or replace function public.signature_audit_trail_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'signature_audit_trail e'' append-only: gli eventi non si modificano';
end;
$$;

drop trigger if exists trg_signature_audit_trail_append_only on public.signature_audit_trail;
create trigger trg_signature_audit_trail_append_only
  before update on public.signature_audit_trail
  for each row execute function public.signature_audit_trail_append_only();
