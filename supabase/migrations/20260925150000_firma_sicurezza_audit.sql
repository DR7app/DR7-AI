-- 25/09/2026 — Firma: Security & Signature Audit Trail.
--
-- Solo aggiunte: colonne nullable, funzioni nuove, un trigger BEFORE INSERT.
-- Nessuna colonna rinominata o tolta; le firme gia' fatte non si toccano
-- (i campi nuovi restano NULL e l'audit li mostra come "Non disponibile").
--
-- Chi scrive: le funzioni Netlify di dr7trust.com (service role) e
-- signature-init / document-sign-init del gestionale.

-- ── signature_requests: sessione dispositivo, OTP, revoca, posizione ─────
alter table public.signature_requests
  add column if not exists device_session_hash text,
  add column if not exists device_label text,
  add column if not exists first_opened_at timestamptz,
  add column if not exists first_ip text,
  add column if not exists first_user_agent text,
  add column if not exists otp_hash text,
  add column if not exists otp_channel text,
  add column if not exists otp_recipient_masked text,
  add column if not exists otp_sent_at timestamptz,
  add column if not exists otp_verified_at timestamptz,
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by text,
  add column if not exists revoke_reason text,
  add column if not exists finalizing_at timestamptz,
  add column if not exists signing_location jsonb,
  add column if not exists audit_trail_hash text;

comment on column public.signature_requests.device_session_hash is
  'SHA-256 del cookie HttpOnly dr7trust_dev del dispositivo legato al link. Il valore del cookie non si salva.';
comment on column public.signature_requests.device_label is
  'Identificativo sessione dispositivo generato da DR7 (DR7-DVC-XXXXXXXX). Non e'' IMEI ne'' numero di serie.';
comment on column public.signature_requests.otp_hash is
  'SHA-256 di "<id richiesta>:<codice>". Il codice in chiaro (otp_code) non si scrive piu''.';
comment on column public.signature_requests.finalizing_at is
  'Blocco della finalizzazione: una sola firma per volta sullo stesso contratto.';

-- ── signature_audit_trail: rete separata, dispositivo, catena di hash ─────
alter table public.signature_audit_trail
  add column if not exists client_ip text,
  add column if not exists proxy_ip text,
  add column if not exists forwarded_for text,
  add column if not exists device_label text,
  add column if not exists prev_hash text,
  add column if not exists event_hash text;

create index if not exists idx_signature_audit_trail_request_created
  on public.signature_audit_trail (signature_request_id, created_at);

-- Impronta di un evento: sempre la stessa formula, qui e nella verifica.
create or replace function public.firma_impronta_evento(
  p_prev text, p_id uuid, p_request uuid, p_tipo text, p_descr text,
  p_ip text, p_ua text, p_meta jsonb, p_quando timestamptz
) returns text
language sql
immutable
set search_path to 'public', 'extensions'
as $$
  select encode(extensions.digest(
    coalesce(p_prev, '') || '|' || p_id::text || '|' || coalesce(p_request::text, '') || '|' ||
    coalesce(p_tipo, '') || '|' || coalesce(p_descr, '') || '|' || coalesce(p_ip, '') || '|' ||
    coalesce(p_ua, '') || '|' || coalesce(p_meta, '{}'::jsonb)::text || '|' ||
    to_char(p_quando at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'sha256'), 'hex');
$$;

-- Ogni evento nuovo si aggancia al precedente della stessa richiesta: se un
-- evento viene cambiato o tolto dopo, la catena non torna piu'.
create or replace function public.signature_audit_trail_catena()
returns trigger
language plpgsql
set search_path to 'public', 'extensions'
as $$
declare
  v_prev text;
begin
  if new.id is null then new.id := gen_random_uuid(); end if;
  if new.metadata is null then new.metadata := '{}'::jsonb; end if;
  if new.signature_request_id is not null then
    perform pg_advisory_xact_lock(hashtext('firma_audit:' || new.signature_request_id::text));
  end if;
  -- Ora del server, presa DOPO il blocco: l'ordine per data e' l'ordine
  -- della catena anche quando due eventi arrivano insieme.
  new.created_at := clock_timestamp();
  if new.signature_request_id is not null then
    select t.event_hash into v_prev
      from public.signature_audit_trail t
     where t.signature_request_id = new.signature_request_id
       and t.event_hash is not null
     order by t.created_at desc, t.id desc
     limit 1;
  end if;
  new.prev_hash := v_prev;
  new.event_hash := public.firma_impronta_evento(
    v_prev, new.id, new.signature_request_id, new.event_type, new.event_description,
    new.ip_address, new.user_agent, new.metadata, new.created_at);
  return new;
end;
$$;

drop trigger if exists trg_signature_audit_trail_catena on public.signature_audit_trail;
create trigger trg_signature_audit_trail_catena
  before insert on public.signature_audit_trail
  for each row execute function public.signature_audit_trail_catena();

-- Verifica della catena di una richiesta: ricalcola ogni impronta.
create or replace function public.firma_verifica_catena(p_request uuid)
returns table (eventi_protetti int, integra boolean, primo_evento timestamptz, ultima_impronta text)
language plpgsql
stable
security definer
set search_path to 'public', 'extensions'
as $$
declare
  r record;
  v_prev text := null;
  v_ok boolean := true;
  v_n int := 0;
  v_primo timestamptz := null;
begin
  for r in
    select * from public.signature_audit_trail
     where signature_request_id = p_request and event_hash is not null
     order by created_at, id
  loop
    v_n := v_n + 1;
    if v_primo is null then v_primo := r.created_at; end if;
    if coalesce(r.prev_hash, '') <> coalesce(v_prev, '')
       or r.event_hash <> public.firma_impronta_evento(
            r.prev_hash, r.id, r.signature_request_id, r.event_type, r.event_description,
            r.ip_address, r.user_agent, r.metadata, r.created_at) then
      v_ok := false;
    end if;
    v_prev := r.event_hash;
  end loop;
  return query select v_n, v_ok, v_primo, v_prev;
end;
$$;

revoke all on function public.firma_verifica_catena(uuid) from public, anon, authenticated;
grant execute on function public.firma_verifica_catena(uuid) to service_role;

-- ── OTP: un tentativo e' una sola operazione ──────────────────────────────
-- Legge la riga bloccandola, conta il tentativo e confronta il codice nella
-- stessa transazione: due tentativi insieme non superano il limite e un
-- codice valido si usa una volta sola.
create or replace function public.firma_otp_tentativo(p_request uuid, p_hash text, p_max int default 5)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  r public.signature_requests%rowtype;
  v_tentativi int;
  v_ok boolean;
begin
  select * into r from public.signature_requests where id = p_request for update;
  if not found then return jsonb_build_object('esito', 'non_trovata'); end if;
  if r.status = 'signed' then return jsonb_build_object('esito', 'firmato'); end if;
  if r.revoked_at is not null then return jsonb_build_object('esito', 'revocato'); end if;
  if r.status <> 'otp_sent' then return jsonb_build_object('esito', 'nessun_codice'); end if;
  if coalesce(r.otp_attempts, 0) >= p_max then
    return jsonb_build_object('esito', 'bloccato', 'tentativi', r.otp_attempts);
  end if;

  v_tentativi := coalesce(r.otp_attempts, 0) + 1;

  if r.otp_expires_at is null or r.otp_expires_at < now() then
    update public.signature_requests
       set otp_attempts = v_tentativi, otp_hash = null, otp_code = null, updated_at = now()
     where id = p_request;
    return jsonb_build_object('esito', 'scaduto', 'tentativi', v_tentativi);
  end if;

  -- otp_code: solo i codici inviati prima di questa versione (vita 10 minuti).
  v_ok := (r.otp_hash is not null and r.otp_hash = p_hash)
       or (r.otp_hash is null and r.otp_code is not null
           and encode(extensions.digest(p_request::text || ':' || r.otp_code, 'sha256'), 'hex') = p_hash);

  if v_ok then
    update public.signature_requests
       set otp_attempts = v_tentativi, status = 'otp_verified', otp_hash = null, otp_code = null,
           otp_verified_at = now(), updated_at = now()
     where id = p_request;
    return jsonb_build_object('esito', 'ok', 'tentativi', v_tentativi);
  end if;

  update public.signature_requests
     set otp_attempts = v_tentativi, updated_at = now()
   where id = p_request;
  return jsonb_build_object('esito', case when v_tentativi >= p_max then 'bloccato' else 'errato' end,
                            'tentativi', v_tentativi);
end;
$$;

revoke all on function public.firma_otp_tentativo(uuid, text, int) from public, anon, authenticated;
grant execute on function public.firma_otp_tentativo(uuid, text, int) to service_role;

-- ── Finalizzazione: una sola firma per volta sullo stesso contratto ───────
-- Due firmatari dello stesso contratto che firmano nello stesso secondo
-- partivano entrambi dal PDF senza l'altra firma: vinceva l'ultimo e il
-- sigillo del primo spariva. Chi arriva secondo riprova dopo qualche secondo.
-- Il blocco scade da solo dopo 2 minuti (funzione caduta a meta').
create or replace function public.firma_inizia_finalizzazione(p_request uuid, p_con_pulsante boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r public.signature_requests%rowtype;
begin
  select * into r from public.signature_requests where id = p_request;
  if not found then return jsonb_build_object('esito', 'non_trovata'); end if;

  perform pg_advisory_xact_lock(hashtext('firma_finalizza:' || coalesce(r.contract_id::text, r.id::text)));

  select * into r from public.signature_requests where id = p_request for update;
  if r.status = 'signed' then return jsonb_build_object('esito', 'firmato'); end if;
  if r.revoked_at is not null then return jsonb_build_object('esito', 'revocato'); end if;
  if r.token_expires_at is not null and r.token_expires_at < now() then
    return jsonb_build_object('esito', 'scaduto');
  end if;
  if not p_con_pulsante and r.status <> 'otp_verified' then
    return jsonb_build_object('esito', 'otp_mancante');
  end if;
  if p_con_pulsante and r.status not in ('pending', 'otp_sent', 'otp_verified') then
    return jsonb_build_object('esito', 'stato_non_firmabile');
  end if;
  if exists (
    select 1 from public.signature_requests s
     where s.finalizing_at > now() - interval '2 minutes'
       and s.status <> 'signed'
       and (s.id = r.id or (r.contract_id is not null and s.contract_id = r.contract_id))
  ) then
    return jsonb_build_object('esito', 'in_corso');
  end if;

  update public.signature_requests set finalizing_at = now() where id = p_request;
  return jsonb_build_object('esito', 'ok');
end;
$$;

revoke all on function public.firma_inizia_finalizzazione(uuid, boolean) from public, anon, authenticated;
grant execute on function public.firma_inizia_finalizzazione(uuid, boolean) to service_role;
