-- 25/09/2026 - Iscritti al Sito: la tab impiegava molto a caricarsi.
-- Gli account sono appena 910, ma quattro iscritti del settembre 2025 hanno
-- nei metadati auth le foto del documento in base64 (chiave `verification`,
-- fino a 8 MB ciascuno, 24 MB in tutto). `auth.admin.listUsers` le spediva
-- ogni volta, pagina dopo pagina.
-- Questa funzione legge gli stessi campi direttamente da auth.users senza le
-- chiavi pesanti. I documenti restano dove sono: qui semplicemente non si
-- leggono. Solo service_role (la function Netlify).
create or replace function public.admin_elenco_iscritti_sito()
returns table (
  id uuid,
  email text,
  created_at timestamptz,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  meta jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.email::text, u.created_at, u.email_confirmed_at, u.last_sign_in_at,
         coalesce(u.raw_user_meta_data, '{}'::jsonb) - 'verification' - 'businessVerification'
  from auth.users u
  order by u.created_at, u.id
$$;

revoke all on function public.admin_elenco_iscritti_sito() from public, anon, authenticated;
grant execute on function public.admin_elenco_iscritti_sito() to service_role;
