-- =====================================================================
-- WEBSITE BUILDER — schema completo
-- 04/09/2026
--
-- Additiva e idempotente: non tocca nessuna tabella esistente, non
-- cancella niente. Il CMS testuale attuale (`centralina_pro_config.
-- config.site_copy`) resta esattamente com'e' e continua a servire il
-- sito: il Website Builder e' uno STRATO IN PIU', non un sostituto.
--
-- Modello:
--   wb_sites        un sito per tenant (multi-tenant vero, `tenant_id`)
--   wb_pages        pagine, con bozza e versione pubblicata separate
--   wb_themes       temi = token di design
--   wb_navigation   header / footer / menu (bozza + pubblicato)
--   wb_media        media library
--   wb_overlays     popup, banner, promozioni (stessa forma)
--   wb_scripts      integrazioni di terze parti
--   wb_templates    sezioni e pagine salvate come modello
--   wb_versions     istantanea COMPLETA del sito a ogni pubblicazione
--   wb_audit_log    chi ha fatto cosa
--
-- La pubblicazione e' ATOMICA: una sola funzione in transazione unica
-- che copia le bozze, scrive l'istantanea e sposta il puntatore. Il
-- sito pubblico legge UNA riga (RPC `wb_public_site`), mai le bozze.
-- =====================================================================

-- ─── Estensioni ──────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Aggiornamento automatico di updated_at ──────────────────────────
CREATE OR REPLACE FUNCTION wb_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ─── wb_sites ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wb_sites (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             text NOT NULL DEFAULT 'dr7',
  key                   text NOT NULL,
  name                  text NOT NULL DEFAULT 'Sito',
  domain                text,
  favicon_url           text,
  default_locale        text NOT NULL DEFAULT 'it',
  locales               text[] NOT NULL DEFAULT ARRAY['it','en'],
  settings              jsonb NOT NULL DEFAULT '{}'::jsonb,
  active_theme_id       uuid,
  published_version_id  uuid,
  published_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS wb_sites_tenant_key_idx ON wb_sites (tenant_id, key);

DROP TRIGGER IF EXISTS trg_wb_sites_touch ON wb_sites;
CREATE TRIGGER trg_wb_sites_touch BEFORE UPDATE ON wb_sites
  FOR EACH ROW EXECUTE FUNCTION wb_touch_updated_at();

-- ─── wb_themes ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wb_themes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     uuid NOT NULL REFERENCES wb_sites(id) ON DELETE CASCADE,
  name        text NOT NULL,
  tokens      jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_builtin  boolean NOT NULL DEFAULT false,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wb_themes_site_idx ON wb_themes (site_id);

DROP TRIGGER IF EXISTS trg_wb_themes_touch ON wb_themes;
CREATE TRIGGER trg_wb_themes_touch BEFORE UPDATE ON wb_themes
  FOR EACH ROW EXECUTE FUNCTION wb_touch_updated_at();

-- Il tema attivo del sito. FK dichiarata dopo wb_themes per evitare
-- l'ordine circolare; ON DELETE SET NULL cosi' cancellare un tema non
-- rende il sito irraggiungibile.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wb_sites_active_theme_fkey'
  ) THEN
    ALTER TABLE wb_sites
      ADD CONSTRAINT wb_sites_active_theme_fkey
      FOREIGN KEY (active_theme_id) REFERENCES wb_themes(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─── wb_pages ────────────────────────────────────────────────────────
--
-- `draft_content`     = quello che l'operatore sta modificando
-- `published_content` = quello che il sito serve davvero
-- I due non si toccano mai fuori da `wb_publish_site`.
--
-- `overrides_route`: la pagina React esistente resta al suo posto
-- finche' questo flag non viene alzato. E' la garanzia di zero
-- regressione: il builder non si prende una rotta di nascosto.
CREATE TABLE IF NOT EXISTS wb_pages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id            uuid NOT NULL REFERENCES wb_sites(id) ON DELETE CASCADE,
  slug               text NOT NULL,
  title              text NOT NULL DEFAULT 'Nuova pagina',
  status             text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','scheduled','published','archived')),
  is_home            boolean NOT NULL DEFAULT false,
  overrides_route    boolean NOT NULL DEFAULT false,
  sort_order         integer NOT NULL DEFAULT 0,
  seo                jsonb NOT NULL DEFAULT '{}'::jsonb,
  draft_content      jsonb NOT NULL DEFAULT '{"sections":[]}'::jsonb,
  published_content  jsonb,
  scheduled_at       timestamptz,
  unpublish_at       timestamptz,
  published_at       timestamptz,
  last_edited_by     text,
  last_edited_at     timestamptz,
  created_by         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS wb_pages_site_slug_idx ON wb_pages (site_id, slug);
CREATE INDEX IF NOT EXISTS wb_pages_site_status_idx ON wb_pages (site_id, status);

DROP TRIGGER IF EXISTS trg_wb_pages_touch ON wb_pages;
CREATE TRIGGER trg_wb_pages_touch BEFORE UPDATE ON wb_pages
  FOR EACH ROW EXECUTE FUNCTION wb_touch_updated_at();

-- Una sola home per sito. Vincolo parziale: le altre pagine non sono
-- toccate e `is_home = false` puo' ripetersi quanto vuole.
CREATE UNIQUE INDEX IF NOT EXISTS wb_pages_single_home_idx
  ON wb_pages (site_id) WHERE is_home;

-- ─── wb_navigation ───────────────────────────────────────────────────
-- key: 'header' | 'footer' | qualsiasi menu futuro.
CREATE TABLE IF NOT EXISTS wb_navigation (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      uuid NOT NULL REFERENCES wb_sites(id) ON DELETE CASCADE,
  key          text NOT NULL,
  draft        jsonb NOT NULL DEFAULT '{}'::jsonb,
  published    jsonb,
  updated_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS wb_navigation_site_key_idx ON wb_navigation (site_id, key);

DROP TRIGGER IF EXISTS trg_wb_navigation_touch ON wb_navigation;
CREATE TRIGGER trg_wb_navigation_touch BEFORE UPDATE ON wb_navigation
  FOR EACH ROW EXECUTE FUNCTION wb_touch_updated_at();

-- ─── wb_media ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wb_media (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         uuid NOT NULL REFERENCES wb_sites(id) ON DELETE CASCADE,
  kind            text NOT NULL DEFAULT 'image'
                  CHECK (kind IN ('image','video','icon','document')),
  folder          text NOT NULL DEFAULT '',
  filename        text NOT NULL,
  storage_path    text,
  url             text NOT NULL,
  mime            text,
  size_bytes      bigint,
  width           integer,
  height          integer,
  alt             jsonb NOT NULL DEFAULT '{}'::jsonb,
  title           text,
  caption         jsonb NOT NULL DEFAULT '{}'::jsonb,
  focal_x         numeric NOT NULL DEFAULT 0.5,
  focal_y         numeric NOT NULL DEFAULT 0.5,
  tags            text[] NOT NULL DEFAULT '{}',
  video_poster_url text,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wb_media_site_idx     ON wb_media (site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wb_media_site_kind_idx ON wb_media (site_id, kind);
CREATE INDEX IF NOT EXISTS wb_media_folder_idx   ON wb_media (site_id, folder);
CREATE INDEX IF NOT EXISTS wb_media_tags_idx     ON wb_media USING gin (tags);

DROP TRIGGER IF EXISTS trg_wb_media_touch ON wb_media;
CREATE TRIGGER trg_wb_media_touch BEFORE UPDATE ON wb_media
  FOR EACH ROW EXECUTE FUNCTION wb_touch_updated_at();

-- ─── wb_overlays (popup / banner / promozioni) ───────────────────────
CREATE TABLE IF NOT EXISTS wb_overlays (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     uuid NOT NULL REFERENCES wb_sites(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('popup','banner','promo')),
  name        text NOT NULL,
  status      text NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft','scheduled','published','archived')),
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  targeting   jsonb NOT NULL DEFAULT '{}'::jsonb,
  starts_at   timestamptz,
  ends_at     timestamptz,
  sort_order  integer NOT NULL DEFAULT 0,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wb_overlays_site_kind_idx ON wb_overlays (site_id, kind, status);

DROP TRIGGER IF EXISTS trg_wb_overlays_touch ON wb_overlays;
CREATE TRIGGER trg_wb_overlays_touch BEFORE UPDATE ON wb_overlays
  FOR EACH ROW EXECUTE FUNCTION wb_touch_updated_at();

-- ─── wb_scripts ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wb_scripts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           uuid NOT NULL REFERENCES wb_sites(id) ON DELETE CASCADE,
  name              text NOT NULL,
  provider          text,
  placement         text NOT NULL DEFAULT 'body_end'
                    CHECK (placement IN ('head','body_start','body_end')),
  code              text NOT NULL DEFAULT '',
  consent_category  text NOT NULL DEFAULT 'marketing'
                    CHECK (consent_category IN ('necessary','analytics','marketing')),
  enabled           boolean NOT NULL DEFAULT false,
  created_by        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wb_scripts_site_idx ON wb_scripts (site_id);

DROP TRIGGER IF EXISTS trg_wb_scripts_touch ON wb_scripts;
CREATE TRIGGER trg_wb_scripts_touch BEFORE UPDATE ON wb_scripts
  FOR EACH ROW EXECUTE FUNCTION wb_touch_updated_at();

-- ─── wb_templates ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wb_templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      uuid NOT NULL REFERENCES wb_sites(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('section','page')),
  name         text NOT NULL,
  description  text,
  preview_url  text,
  payload      jsonb NOT NULL,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wb_templates_site_kind_idx ON wb_templates (site_id, kind);

-- ─── wb_versions ─────────────────────────────────────────────────────
-- Un'istantanea per pubblicazione: contiene TUTTO il sito servito in
-- quel momento. Ripristinare = rimettere questa istantanea.
CREATE TABLE IF NOT EXISTS wb_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     uuid NOT NULL REFERENCES wb_sites(id) ON DELETE CASCADE,
  number      integer NOT NULL,
  label       text,
  note        text,
  snapshot    jsonb NOT NULL,
  summary     jsonb NOT NULL DEFAULT '{}'::jsonb,
  author      text,
  restored_from uuid REFERENCES wb_versions(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS wb_versions_site_number_idx ON wb_versions (site_id, number);
CREATE INDEX IF NOT EXISTS wb_versions_site_created_idx ON wb_versions (site_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wb_sites_published_version_fkey'
  ) THEN
    ALTER TABLE wb_sites
      ADD CONSTRAINT wb_sites_published_version_fkey
      FOREIGN KEY (published_version_id) REFERENCES wb_versions(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─── wb_audit_log ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wb_audit_log (
  id            bigserial PRIMARY KEY,
  site_id       uuid REFERENCES wb_sites(id) ON DELETE CASCADE,
  action        text NOT NULL,
  object_type   text,
  object_id     text,
  object_label  text,
  author        text,
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wb_audit_site_created_idx ON wb_audit_log (site_id, created_at DESC);

-- =====================================================================
-- PERMESSI
--
-- Stesso schema di `sc_puo_operare()`: nessuna email in duro, cosi' una
-- copia venduta del gestionale non eredita gli indirizzi DR7. I diritti
-- granulari vivono in `admins.permissions[]`:
--   website.view  website.edit  website.publish  website.media
--   website.seo   website.theme website.settings website.code
-- Superadmin / role:direzione / role:developer hanno tutto, come nel
-- resto del gestionale (useAdminRole.hasPermission).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.wb_ha_diritto(p_diritto text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admins a
     WHERE a.user_id = auth.uid()
       AND a.archived_at IS NULL
       AND ( a.role = 'superadmin'
             OR a.permissions @> '["role:direzione"]'::jsonb
             OR a.permissions @> '["role:developer"]'::jsonb
             OR a.permissions @> '["*"]'::jsonb
             OR a.permissions @> to_jsonb(ARRAY[p_diritto])
             -- website.edit implica sempre la lettura
             OR ( p_diritto = 'website.view'
                  AND a.permissions @> '["website.edit"]'::jsonb ) )
  );
$$;

COMMENT ON FUNCTION public.wb_ha_diritto(text) IS
  'Website Builder: vero se l''operatore collegato ha il diritto richiesto (o e'' superadmin/direzione/developer).';

CREATE OR REPLACE FUNCTION public.wb_puo_leggere()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.wb_ha_diritto('website.view');
$$;

CREATE OR REPLACE FUNCTION public.wb_puo_scrivere()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.wb_ha_diritto('website.edit');
$$;

CREATE OR REPLACE FUNCTION public.wb_puo_pubblicare()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.wb_ha_diritto('website.publish');
$$;

-- =====================================================================
-- RLS
--
-- Il gestionale e il sito pubblico condividono lo stesso progetto
-- Supabase: "authenticated" comprende ogni cliente registrato su
-- dr7.app. Nessuna tabella del builder e' quindi leggibile in chiaro —
-- il sito pubblico passa esclusivamente dalla RPC `wb_public_site`,
-- che restituisce SOLO l'istantanea pubblicata.
-- =====================================================================

ALTER TABLE wb_sites      ENABLE ROW LEVEL SECURITY;
ALTER TABLE wb_pages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE wb_themes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE wb_navigation ENABLE ROW LEVEL SECURITY;
ALTER TABLE wb_media      ENABLE ROW LEVEL SECURITY;
ALTER TABLE wb_overlays   ENABLE ROW LEVEL SECURITY;
ALTER TABLE wb_scripts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE wb_templates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE wb_versions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE wb_audit_log  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'wb_sites','wb_pages','wb_themes','wb_navigation','wb_media',
    'wb_overlays','wb_scripts','wb_templates','wb_versions','wb_audit_log'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_sel', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_ins', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_upd', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_del', t);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.wb_puo_leggere())',
      t || '_sel', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.wb_puo_scrivere())',
      t || '_ins', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.wb_puo_scrivere()) WITH CHECK (public.wb_puo_scrivere())',
      t || '_upd', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.wb_puo_scrivere())',
      t || '_del', t);
  END LOOP;
END $$;

-- Le versioni non si modificano e non si cancellano a mano: sono lo
-- storico su cui poggia il ripristino. Si scrivono solo dalle funzioni
-- SECURITY DEFINER qui sotto.
DROP POLICY IF EXISTS wb_versions_ins ON public.wb_versions;
DROP POLICY IF EXISTS wb_versions_upd ON public.wb_versions;
DROP POLICY IF EXISTS wb_versions_del ON public.wb_versions;

-- L'audit non si riscrive.
DROP POLICY IF EXISTS wb_audit_log_upd ON public.wb_audit_log;
DROP POLICY IF EXISTS wb_audit_log_del ON public.wb_audit_log;

-- =====================================================================
-- ISTANTANEA E PUBBLICAZIONE ATOMICA
--
-- `wb_build_snapshot` costruisce il documento COMPLETO che il sito
-- servira'. `wb_publish_site` copia le bozze, scrive l'istantanea e
-- sposta il puntatore del sito: tutto dentro una sola transazione, per
-- cui il sito non puo' mai mostrare meta' vecchio e meta' nuovo. Se
-- qualcosa fallisce, la transazione torna indietro e resta online
-- l'ultima versione valida.
-- =====================================================================

-- `p_source` = 'published' (istantanea reale) | 'draft' (anteprima).
CREATE OR REPLACE FUNCTION public.wb_build_snapshot(p_site_id uuid, p_source text DEFAULT 'published')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_site   wb_sites%ROWTYPE;
  v_theme  jsonb;
  v_nav    jsonb;
  v_pages  jsonb;
  v_over   jsonb;
  v_script jsonb;
BEGIN
  SELECT * INTO v_site FROM wb_sites WHERE id = p_site_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sito % inesistente', p_site_id;
  END IF;

  SELECT jsonb_build_object('id', t.id, 'name', t.name, 'tokens', t.tokens)
    INTO v_theme
    FROM wb_themes t
   WHERE t.id = v_site.active_theme_id;

  SELECT coalesce(jsonb_object_agg(
           n.key,
           CASE WHEN p_source = 'draft' THEN n.draft ELSE coalesce(n.published, '{}'::jsonb) END
         ), '{}'::jsonb)
    INTO v_nav
    FROM wb_navigation n
   WHERE n.site_id = p_site_id;

  SELECT coalesce(jsonb_agg(x ORDER BY x->>'sort_order', x->>'slug'), '[]'::jsonb)
    INTO v_pages
    FROM (
      SELECT jsonb_build_object(
               'id',              p.id,
               'slug',            p.slug,
               'title',           p.title,
               'status',          p.status,
               'is_home',         p.is_home,
               'overrides_route', p.overrides_route,
               'sort_order',      p.sort_order,
               'seo',             p.seo,
               'scheduled_at',    p.scheduled_at,
               'unpublish_at',    p.unpublish_at,
               'published_at',    p.published_at,
               'content',         CASE WHEN p_source = 'draft'
                                       THEN p.draft_content
                                       ELSE coalesce(p.published_content, p.draft_content) END
             ) AS x
        FROM wb_pages p
       WHERE p.site_id = p_site_id
         AND ( p_source = 'draft' OR p.status IN ('published','scheduled') )
    ) s;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'kind', o.kind, 'name', o.name, 'status', o.status,
           'config', o.config, 'targeting', o.targeting,
           'starts_at', o.starts_at, 'ends_at', o.ends_at, 'sort_order', o.sort_order
         ) ORDER BY o.sort_order, o.created_at), '[]'::jsonb)
    INTO v_over
    FROM wb_overlays o
   WHERE o.site_id = p_site_id
     AND ( p_source = 'draft' OR o.status IN ('published','scheduled') );

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name, 'provider', s.provider,
           'placement', s.placement, 'code', s.code,
           'consent_category', s.consent_category
         ) ORDER BY s.created_at), '[]'::jsonb)
    INTO v_script
    FROM wb_scripts s
   WHERE s.site_id = p_site_id AND s.enabled;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'source',         p_source,
    'generated_at',   now(),
    'site', jsonb_build_object(
      'id', v_site.id, 'key', v_site.key, 'tenant_id', v_site.tenant_id,
      'name', v_site.name, 'domain', v_site.domain,
      'favicon_url', v_site.favicon_url,
      'default_locale', v_site.default_locale, 'locales', v_site.locales,
      'settings', v_site.settings
    ),
    'theme',      coalesce(v_theme, 'null'::jsonb),
    'navigation', v_nav,
    'pages',      v_pages,
    'overlays',   v_over,
    'scripts',    v_script
  );
END;
$$;

-- ── Pubblicazione ────────────────────────────────────────────────────
-- p_page_ids NULL = pubblica tutte le pagine in stato published/scheduled.
CREATE OR REPLACE FUNCTION public.wb_publish_site(
  p_site_id  uuid,
  p_label    text DEFAULT NULL,
  p_note     text DEFAULT NULL,
  p_page_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_author   text;
  v_number   integer;
  v_snapshot jsonb;
  v_version  uuid;
  v_pages    integer;
  v_vuote    integer;
BEGIN
  IF NOT public.wb_puo_pubblicare() THEN
    RAISE EXCEPTION 'Permesso negato: serve il diritto website.publish';
  END IF;

  v_author := coalesce(auth.jwt() ->> 'email', 'sconosciuto');

  -- Blocco di validazione: una pagina pubblicata senza contenuto e senza
  -- slug manderebbe online una schermata bianca. Gli avvisi non
  -- bloccanti vivono nell'interfaccia; qui restano solo gli errori seri.
  SELECT count(*) INTO v_vuote
    FROM wb_pages p
   WHERE p.site_id = p_site_id
     AND p.status IN ('published','scheduled')
     AND ( p.slug IS NULL OR btrim(p.slug) = ''
           OR jsonb_typeof(coalesce(p.draft_content->'sections','[]'::jsonb)) <> 'array' );
  IF v_vuote > 0 THEN
    RAISE EXCEPTION 'Pubblicazione annullata: % pagina/e senza slug o con struttura non valida', v_vuote;
  END IF;

  -- 1. le bozze diventano contenuto pubblicato
  UPDATE wb_pages p
     SET published_content = p.draft_content,
         published_at      = now()
   WHERE p.site_id = p_site_id
     AND p.status IN ('published','scheduled')
     AND (p_page_ids IS NULL OR p.id = ANY(p_page_ids));
  GET DIAGNOSTICS v_pages = ROW_COUNT;

  -- 2. la navigazione segue le pagine
  UPDATE wb_navigation n
     SET published = n.draft
   WHERE n.site_id = p_site_id;

  -- 3. istantanea completa
  v_snapshot := public.wb_build_snapshot(p_site_id, 'published');

  SELECT coalesce(max(number), 0) + 1 INTO v_number
    FROM wb_versions WHERE site_id = p_site_id;

  INSERT INTO wb_versions (site_id, number, label, note, snapshot, summary, author)
  VALUES (
    p_site_id, v_number, p_label, p_note, v_snapshot,
    jsonb_build_object(
      'pagine',   jsonb_array_length(v_snapshot->'pages'),
      'overlay',  jsonb_array_length(v_snapshot->'overlays'),
      'script',   jsonb_array_length(v_snapshot->'scripts'),
      'aggiornate', v_pages
    ),
    v_author
  )
  RETURNING id INTO v_version;

  -- 4. il puntatore si sposta solo adesso: fino a questa riga il sito
  --    continua a servire la versione precedente.
  UPDATE wb_sites
     SET published_version_id = v_version,
         published_at         = now()
   WHERE id = p_site_id;

  INSERT INTO wb_audit_log (site_id, action, object_type, object_id, object_label, author, meta)
  VALUES (p_site_id, 'publish', 'site', p_site_id::text, coalesce(p_label, 'Pubblicazione'), v_author,
          jsonb_build_object('versione', v_number, 'pagine_aggiornate', v_pages));

  RETURN jsonb_build_object('version_id', v_version, 'number', v_number, 'pages', v_pages);
END;
$$;

-- ── Ripristino di una versione ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wb_restore_version(p_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ver     wb_versions%ROWTYPE;
  v_author  text;
  v_number  integer;
  v_new     uuid;
  v_page    jsonb;
BEGIN
  IF NOT public.wb_puo_pubblicare() THEN
    RAISE EXCEPTION 'Permesso negato: serve il diritto website.publish';
  END IF;

  SELECT * INTO v_ver FROM wb_versions WHERE id = p_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Versione inesistente';
  END IF;

  v_author := coalesce(auth.jwt() ->> 'email', 'sconosciuto');

  -- Il contenuto pubblicato delle pagine torna a quello dell'istantanea.
  -- Le BOZZE non vengono toccate: chi stava lavorando non perde niente.
  FOR v_page IN SELECT * FROM jsonb_array_elements(v_ver.snapshot->'pages') LOOP
    UPDATE wb_pages
       SET published_content = v_page->'content',
           seo               = coalesce(v_page->'seo', seo),
           published_at      = now()
     WHERE id = (v_page->>'id')::uuid
       AND site_id = v_ver.site_id;
  END LOOP;

  -- Nuova versione che registra il ripristino: lo storico non si riscrive.
  SELECT coalesce(max(number), 0) + 1 INTO v_number
    FROM wb_versions WHERE site_id = v_ver.site_id;

  INSERT INTO wb_versions (site_id, number, label, note, snapshot, summary, author, restored_from)
  VALUES (v_ver.site_id, v_number,
          'Ripristino v' || v_ver.number,
          'Ripristinata la versione ' || v_ver.number,
          v_ver.snapshot,
          v_ver.summary || jsonb_build_object('ripristino_da', v_ver.number),
          v_author, v_ver.id)
  RETURNING id INTO v_new;

  UPDATE wb_sites
     SET published_version_id = v_new,
         published_at         = now()
   WHERE id = v_ver.site_id;

  INSERT INTO wb_audit_log (site_id, action, object_type, object_id, object_label, author, meta)
  VALUES (v_ver.site_id, 'restore', 'version', v_ver.id::text,
          'Versione ' || v_ver.number, v_author,
          jsonb_build_object('nuova_versione', v_number));

  RETURN jsonb_build_object('version_id', v_new, 'number', v_number);
END;
$$;

-- ── Lettura pubblica ─────────────────────────────────────────────────
-- L'UNICA porta d'accesso del sito pubblico. Restituisce solo
-- l'istantanea pubblicata: bozze, media non usati e tabelle interne
-- restano invisibili. Una sola chiamata per tutto il sito.
CREATE OR REPLACE FUNCTION public.wb_public_site(p_key text DEFAULT 'dr7', p_tenant text DEFAULT 'dr7')
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.snapshot
    FROM wb_sites s
    JOIN wb_versions v ON v.id = s.published_version_id
   WHERE s.key = p_key AND s.tenant_id = p_tenant
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.wb_public_site(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wb_public_site(text, text) TO anon, authenticated;

-- ── Anteprima della bozza ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wb_preview_site(p_site_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.wb_puo_leggere() THEN
    RAISE EXCEPTION 'Permesso negato';
  END IF;
  RETURN public.wb_build_snapshot(p_site_id, 'draft');
END;
$$;

REVOKE ALL ON FUNCTION public.wb_preview_site(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wb_preview_site(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.wb_publish_site(uuid, text, text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wb_publish_site(uuid, text, text, uuid[]) TO authenticated;
REVOKE ALL ON FUNCTION public.wb_restore_version(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wb_restore_version(uuid) TO authenticated;

-- =====================================================================
-- STORAGE — bucket dei media del sito
--
-- Lettura pubblica (le immagini stanno su un sito pubblico), scrittura
-- riservata a chi ha il diritto website.media. Un file per tenant/sito:
-- il percorso e' `<tenant_id>/<site_key>/<cartella>/<file>`, cosi' due
-- clienti diversi non si vedono nemmeno i nomi dei file.
-- =====================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'website-media', 'website-media', true, 209715200,
  ARRAY[
    'image/jpeg','image/png','image/webp','image/avif','image/gif','image/svg+xml',
    'video/mp4','video/webm','video/quicktime',
    'application/pdf','font/woff','font/woff2','application/font-woff2'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS wb_media_public_read ON storage.objects;
CREATE POLICY wb_media_public_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'website-media');

DROP POLICY IF EXISTS wb_media_write ON storage.objects;
CREATE POLICY wb_media_write ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'website-media' AND public.wb_ha_diritto('website.media'));

DROP POLICY IF EXISTS wb_media_update ON storage.objects;
CREATE POLICY wb_media_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'website-media' AND public.wb_ha_diritto('website.media'))
  WITH CHECK (bucket_id = 'website-media' AND public.wb_ha_diritto('website.media'));

DROP POLICY IF EXISTS wb_media_delete ON storage.objects;
CREATE POLICY wb_media_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'website-media' AND public.wb_ha_diritto('website.media'));

-- =====================================================================
-- SEED — il sito DR7 e il suo tema di partenza
--
-- I valori riproducono l'aspetto attuale di dr7.app (fondo nero, testo
-- bianco, oro #C9A96E, Exo 2 / Playfair Display / Rajdhani come sul
-- sito). Nessuna pagina viene pubblicata da qui: il sito continua a
-- servire i componenti React esistenti finche' un operatore non decide
-- il contrario dal Website Builder.
-- =====================================================================

INSERT INTO wb_sites (tenant_id, key, name, domain, default_locale, locales, settings)
VALUES ('dr7', 'dr7', 'DR7 Empire', 'dr7.app', 'it', ARRAY['it','en'],
  jsonb_build_object(
    'site_name', 'DR7 Empire',
    'email', 'info@dr7.app',
    'phone', '',
    'whatsapp', '',
    'address', '',
    'copyright', '© DR7 Empire',
    'social', jsonb_build_array()
  ))
ON CONFLICT (tenant_id, key) DO NOTHING;

DO $$
DECLARE
  v_site  uuid;
  v_theme uuid;
BEGIN
  SELECT id INTO v_site FROM wb_sites WHERE tenant_id = 'dr7' AND key = 'dr7';

  SELECT id INTO v_theme FROM wb_themes WHERE site_id = v_site AND name = 'DR7 Originale';
  IF v_theme IS NULL THEN
    INSERT INTO wb_themes (site_id, name, is_builtin, tokens)
    VALUES (v_site, 'DR7 Originale', true, jsonb_build_object(
      'colors', jsonb_build_object(
        'primary',    '#C9A96E',
        'secondary',  '#D4B896',
        'accent',     '#19C2D6',
        'bg',         '#000000',
        'surface',    '#0B0B0C',
        'surfaceAlt', '#1C1C1E',
        'text',       '#FFFFFF',
        'textMuted',  '#A3A3A3',
        'border',     '#2C2C2E',
        'success',    '#2D8A7E',
        'warning',    '#F4C430',
        'error',      '#EF4444',
        'info',       '#19C2D6'
      ),
      'typography', jsonb_build_object(
        'fontPrimary',   'Exo 2, sans-serif',
        'fontSecondary', 'Playfair Display, serif',
        'fontAccent',    'Rajdhani, sans-serif',
        'scales', jsonb_build_object(
          'h1',      jsonb_build_object('family','fontSecondary','size',56,'sizeTablet',44,'sizeMobile',34,'weight',700,'lineHeight',1.1,'letterSpacing',-0.5,'transform','none'),
          'h2',      jsonb_build_object('family','fontSecondary','size',42,'sizeTablet',34,'sizeMobile',28,'weight',700,'lineHeight',1.15,'letterSpacing',-0.3,'transform','none'),
          'h3',      jsonb_build_object('family','fontPrimary','size',30,'sizeTablet',26,'sizeMobile',22,'weight',700,'lineHeight',1.2,'letterSpacing',0,'transform','none'),
          'h4',      jsonb_build_object('family','fontPrimary','size',24,'sizeTablet',22,'sizeMobile',20,'weight',600,'lineHeight',1.25,'letterSpacing',0,'transform','none'),
          'h5',      jsonb_build_object('family','fontPrimary','size',20,'sizeTablet',19,'sizeMobile',18,'weight',600,'lineHeight',1.3,'letterSpacing',0,'transform','none'),
          'h6',      jsonb_build_object('family','fontPrimary','size',17,'sizeTablet',17,'sizeMobile',16,'weight',600,'lineHeight',1.35,'letterSpacing',0.4,'transform','uppercase'),
          'body',    jsonb_build_object('family','fontPrimary','size',17,'sizeTablet',16,'sizeMobile',16,'weight',400,'lineHeight',1.65,'letterSpacing',0,'transform','none'),
          'small',   jsonb_build_object('family','fontPrimary','size',14,'sizeTablet',14,'sizeMobile',13,'weight',400,'lineHeight',1.55,'letterSpacing',0,'transform','none'),
          'label',   jsonb_build_object('family','fontAccent','size',13,'sizeTablet',13,'sizeMobile',12,'weight',600,'lineHeight',1.4,'letterSpacing',1.2,'transform','uppercase'),
          'button',  jsonb_build_object('family','fontPrimary','size',15,'sizeTablet',15,'sizeMobile',15,'weight',600,'lineHeight',1,'letterSpacing',0.6,'transform','uppercase'),
          'menu',    jsonb_build_object('family','fontPrimary','size',14,'sizeTablet',14,'sizeMobile',15,'weight',500,'lineHeight',1.4,'letterSpacing',0.8,'transform','uppercase'),
          'caption', jsonb_build_object('family','fontPrimary','size',12,'sizeTablet',12,'sizeMobile',12,'weight',400,'lineHeight',1.5,'letterSpacing',0.2,'transform','none')
        )
      ),
      'radius',  jsonb_build_object('sm',4,'md',8,'lg',12,'xl',20,'button',8,'card',10),
      'spacing', jsonb_build_object('sectionY',96,'sectionYTablet',72,'sectionYMobile',56,'containerMax',1280,'gap',32),
      'buttons', jsonb_build_object(
        'primary',   jsonb_build_object('bg','#C9A96E','text','#000000','border','transparent','hoverBg','#D4B896','hoverText','#000000','radius',8,'padX',28,'padY',14),
        'secondary', jsonb_build_object('bg','#1C1C1E','text','#FFFFFF','border','#2C2C2E','hoverBg','#2C2C2E','hoverText','#FFFFFF','radius',8,'padX',28,'padY',14),
        'outline',   jsonb_build_object('bg','transparent','text','#FFFFFF','border','#FFFFFF','hoverBg','#FFFFFF','hoverText','#000000','radius',8,'padX',28,'padY',14),
        'ghost',     jsonb_build_object('bg','transparent','text','#C9A96E','border','transparent','hoverBg','rgba(201,169,110,0.12)','hoverText','#D4B896','radius',8,'padX',20,'padY',12)
      ),
      'effects', jsonb_build_object(
        'shadowSm','0 1px 3px rgba(0,0,0,.4)',
        'shadowMd','0 8px 24px rgba(0,0,0,.45)',
        'shadowLg','0 24px 60px rgba(0,0,0,.55)'
      ),
      'card', jsonb_build_object('bg','#0B0B0C','border','#2C2C2E','radius',10,'shadow','0 8px 24px rgba(0,0,0,.45)','pad',24)
    ))
    RETURNING id INTO v_theme;
  END IF;

  UPDATE wb_sites SET active_theme_id = coalesce(active_theme_id, v_theme) WHERE id = v_site;

  INSERT INTO wb_navigation (site_id, key, draft)
  VALUES (v_site, 'header', jsonb_build_object('items', jsonb_build_array(), 'settings', jsonb_build_object()))
  ON CONFLICT (site_id, key) DO NOTHING;

  INSERT INTO wb_navigation (site_id, key, draft)
  VALUES (v_site, 'footer', jsonb_build_object('columns', jsonb_build_array(), 'settings', jsonb_build_object()))
  ON CONFLICT (site_id, key) DO NOTHING;
END $$;

-- =====================================================================
-- MODULI DEL SITO
--
-- I moduli disegnati nel builder (contatti, newsletter) scrivono qui.
-- La scrittura passa SEMPRE dalla Netlify Function `wb-form-submit`, che
-- usa la service role: nessun permesso di scrittura viene dato ad anon,
-- altrimenti la tabella diventerebbe una casella aperta a chiunque.
-- =====================================================================

CREATE TABLE IF NOT EXISTS wb_form_submissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     uuid REFERENCES wb_sites(id) ON DELETE SET NULL,
  page_slug   text,
  block_id    text,
  form_name   text,
  values      jsonb NOT NULL DEFAULT '{}'::jsonb,
  consent     boolean NOT NULL DEFAULT false,
  user_agent  text,
  ip_hash     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wb_form_site_created_idx ON wb_form_submissions (site_id, created_at DESC);

ALTER TABLE wb_form_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wb_form_submissions_sel ON public.wb_form_submissions;
CREATE POLICY wb_form_submissions_sel ON public.wb_form_submissions
  FOR SELECT TO authenticated USING (public.wb_puo_leggere());

DROP POLICY IF EXISTS wb_form_submissions_del ON public.wb_form_submissions;
CREATE POLICY wb_form_submissions_del ON public.wb_form_submissions
  FOR DELETE TO authenticated USING (public.wb_puo_scrivere());

-- =====================================================================
-- FINE. Nessuna tabella esistente e' stata modificata o cancellata.
-- Per annullare tutto: DROP delle tabelle wb_* (i dati del gestionale
-- e del sito non ne dipendono in alcun modo).
-- =====================================================================
