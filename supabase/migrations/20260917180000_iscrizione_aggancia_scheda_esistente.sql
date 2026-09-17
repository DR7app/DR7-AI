-- ============================================================================
-- ISCRIZIONE AL SITO: AGGANCIARE LA SCHEDA GIA' CREATA DALL'UFFICIO (17/09/2026)
--
-- Problema (caso reale 16/09/2026): un cliente inserito in Lead dal
-- gestionale (scheda senza user_id, con la sua email) si iscrive al sito.
-- Il trigger `on_auth_user_created` faceva SEMPRE una INSERT: nasceva una
-- seconda scheda con la stessa email e l'account attaccato a quella nuova.
-- Poi `register-customer.js` aggiorna per user_id, quindi la scheda
-- dell'ufficio restava orfana e il cliente compariva due volte in Lead.
--
-- Ora, prima di inserire, si cerca una scheda SENZA account con la stessa
-- email (maiuscole e spazi ignorati) e lo stesso tipo cliente (o tipo non
-- indicato). Se c'e', le si attacca l'account invece di crearne un'altra.
--
-- Regola (direzione, 17/09/2026): e' la stessa persona se
--   - l'email e' la stessa, oppure
--   - nome E cognome sono uguali E il telefono e' lo stesso.
-- Mai per solo telefono, mai per solo nome. Tipi cliente diversi non si fondono.
-- Se le schede candidate sono piu' d'una si prende quella aggiornata piu'
-- di recente: e' quella su cui l'ufficio sta lavorando.
--
-- Vale per ogni strada che crea un account (form di iscrizione, Google,
-- inviti), perche' tutte passano da auth.users.
-- ============================================================================

-- Telefono confrontabile: solo cifre, senza 00 / +39 davanti.
CREATE OR REPLACE FUNCTION public.dr7_telefono_normalizzato(p_tel TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN length(t) < 6 THEN NULL
    WHEN length(t) > 10 AND left(t, 2) = '39' THEN substr(t, 3)
    ELSE t
  END
  FROM (SELECT regexp_replace(regexp_replace(coalesce(p_tel, ''), '\D', '', 'g'), '^00', '') AS t) x
$$;

CREATE OR REPLACE FUNCTION public.sync_auth_user_to_customers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  tipo_cliente_value TEXT;
  residency_zone_value TEXT;
  email_norm TEXT;
  nome_norm TEXT;
  cognome_norm TEXT;
  tel_norm TEXT;
  scheda_esistente UUID;
BEGIN
  BEGIN
    -- Extract values with defaults
    tipo_cliente_value := COALESCE(NEW.raw_user_meta_data->>'tipoCliente', 'persona_fisica');
    residency_zone_value := COALESCE(NEW.raw_user_meta_data->>'residencyZone', 'NON_RESIDENTE');
    email_norm := lower(btrim(coalesce(NEW.email, '')));

    -- 17/09/2026: scheda dell'ufficio con la stessa email e senza account?
    IF email_norm <> '' THEN
      SELECT ce.id INTO scheda_esistente
        FROM public.customers_extended ce
       WHERE ce.user_id IS NULL
         AND lower(btrim(ce.email)) = email_norm
         AND (ce.tipo_cliente IS NULL OR ce.tipo_cliente = tipo_cliente_value)
       ORDER BY ce.updated_at DESC NULLS LAST, ce.created_at DESC NULLS LAST
       LIMIT 1
       FOR UPDATE;
    END IF;

    -- 17/09/2026: altrimenti stesso nome, stesso cognome e stesso telefono.
    IF scheda_esistente IS NULL THEN
      nome_norm := lower(btrim(coalesce(NEW.raw_user_meta_data->>'nome', '')));
      cognome_norm := lower(btrim(coalesce(NEW.raw_user_meta_data->>'cognome', '')));
      tel_norm := public.dr7_telefono_normalizzato(
        coalesce(NEW.raw_user_meta_data->>'telefono', NEW.raw_user_meta_data->>'phone', NEW.phone));
      IF nome_norm <> '' AND cognome_norm <> '' AND tel_norm IS NOT NULL THEN
        SELECT ce.id INTO scheda_esistente
          FROM public.customers_extended ce
         WHERE ce.user_id IS NULL
           AND lower(btrim(coalesce(ce.nome, ''))) = nome_norm
           AND lower(btrim(coalesce(ce.cognome, ''))) = cognome_norm
           AND public.dr7_telefono_normalizzato(ce.telefono) = tel_norm
           AND (ce.tipo_cliente IS NULL OR ce.tipo_cliente = tipo_cliente_value)
         ORDER BY ce.updated_at DESC NULLS LAST, ce.created_at DESC NULLS LAST
         LIMIT 1
         FOR UPDATE;
      END IF;
    END IF;

    IF scheda_esistente IS NOT NULL THEN
      UPDATE public.customers_extended
         SET user_id = NEW.id,
             tipo_cliente = COALESCE(tipo_cliente, tipo_cliente_value),
             residency_zone = COALESCE(residency_zone, residency_zone_value),
             metadata = COALESCE(metadata, '{}'::jsonb)
                        || jsonb_build_object('account_sito_agganciato_il', now())
       WHERE id = scheda_esistente;

      RAISE NOTICE 'TRIGGER: account % agganciato alla scheda esistente %', NEW.id, scheda_esistente;
      RETURN NEW;
    END IF;

    -- Nessuna scheda da agganciare: se ne crea una nuova, come prima.
    INSERT INTO public.customers_extended (
      user_id,
      email,
      tipo_cliente,
      residency_zone,
      source,
      created_at
    ) VALUES (
      NEW.id,
      NEW.email,
      tipo_cliente_value,
      residency_zone_value,
      'website_registration',
      NEW.created_at
    );

    RAISE NOTICE 'TRIGGER SUCCESS: Customer created for user %', NEW.id;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'TRIGGER ERROR: % - SQLSTATE: %', SQLERRM, SQLSTATE;
    RAISE;
  END;

  RETURN NEW;
END;
$function$;
