-- Iscritti al Sito: elenco a pagine, ricerca e statistiche dentro il database.
--
-- Perche': la tab scaricava TUTTO prima di disegnare qualcosa. La function
-- `list-site-users` pagina ogni account auth (200 per volta, oltre cento
-- pagine), poi rilegge per intero customers_extended, i saldi wallet e le
-- transazioni del bonus, unisce le righe in memoria e risponde con un JSON di
-- decine di MB; il browser poi disegna una riga di tabella per OGNI iscritto.
-- Sopra i ventimila account questo significa decine di secondi di attesa — la
-- stessa causa gia' documentata per il riquadro accessi (dr7_recent_logins).
--
-- Qui il lavoro sta dove stanno i dati: si chiedono 50 righe alla volta, la
-- ricerca e l'ordinamento li fa Postgres, e i numeri delle carte in cima sono
-- conteggi, non somme di righe scaricate.
--
-- SECURITY DEFINER perche' auth.users non e' esposto a PostgREST. L'accesso e'
-- ristretto agli operatori non archiviati: dr7_admin_id() torna NULL per
-- chiunque altro (i clienti del sito vivono nello stesso progetto Supabase).

-- ---------------------------------------------------------------------------
-- Indici: senza questi ogni riga dell'elenco costerebbe una scansione intera
-- di customers_extended.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_customers_extended_user_id
  ON public.customers_extended (user_id);

CREATE INDEX IF NOT EXISTS idx_customers_extended_email_lower
  ON public.customers_extended (lower(email));

-- Chi ha gia' ricevuto i 10 € di benvenuto. Parziale: la tabella delle
-- transazioni e' grande, di righe welcome_bonus ce n'e' una per persona.
CREATE INDEX IF NOT EXISTS idx_credit_transactions_welcome_bonus
  ON public.credit_transactions (user_id)
  WHERE reference_type = 'welcome_bonus';

-- ---------------------------------------------------------------------------
-- Primo valore utile di una lista. E' la traduzione esatta di `valore()` in
-- list-site-users.ts: scheda cliente prima, metadati della registrazione poi,
-- scartando stringhe vuote e spazi.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dr7_primo_valore(VARIADIC p_valori TEXT[])
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT coalesce((
    SELECT nullif(btrim(t.x), '')
      FROM unnest(p_valori) WITH ORDINALITY AS t(x, ord)
     WHERE nullif(btrim(t.x), '') IS NOT NULL
     ORDER BY t.ord
     LIMIT 1
  ), '');
$fn$;

-- ---------------------------------------------------------------------------
-- "Non in Clienti": il dato e' stato compilato in registrazione (metadati
-- auth) ma nella scheda cliente non c'e'. Stessa lista di campi di
-- CAMPI_COMPARAZIONE in list-site-users.ts.
--
-- I campi si leggono dal jsonb della riga, non da colonne: se un domani una
-- colonna non esistesse piu', qui non salta nulla.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.iscritti_sito_da_recuperare(p_scheda JSONB, p_meta JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE
    WHEN p_scheda IS NULL
      OR (nullif(btrim(coalesce(p_scheda->>'user_id', '')), '') IS NULL
          AND nullif(btrim(coalesce(p_scheda->>'email', '')), '') IS NULL)
    THEN true
    ELSE EXISTS (
      SELECT 1 FROM (VALUES
        (p_scheda->>'nome', public.dr7_primo_valore(
            p_meta->>'nome', p_meta->>'first_name', p_meta->>'given_name',
            public.dr7_primo_valore(p_meta->>'full_name', p_meta->>'fullName', p_meta->>'name'))),
        (p_scheda->>'cognome', public.dr7_primo_valore(
            p_meta->>'cognome', p_meta->>'last_name', p_meta->>'family_name')),
        (p_scheda->>'telefono', public.dr7_primo_valore(p_meta->>'telefono', p_meta->>'phone')),
        (p_scheda->>'codice_fiscale', public.dr7_primo_valore(p_meta->>'codiceFiscale', p_meta->>'codice_fiscale')),
        (p_scheda->>'data_nascita', public.dr7_primo_valore(p_meta->>'dataNascita', p_meta->>'data_nascita')),
        (p_scheda->>'indirizzo', public.dr7_primo_valore(p_meta->>'indirizzo')),
        (p_scheda->>'numero_civico', public.dr7_primo_valore(p_meta->>'numeroCivico', p_meta->>'numero_civico')),
        (p_scheda->>'codice_postale', public.dr7_primo_valore(p_meta->>'codicePostale', p_meta->>'codice_postale')),
        (p_scheda->>'citta_residenza', public.dr7_primo_valore(p_meta->>'cittaResidenza', p_meta->>'citta_residenza')),
        (p_scheda->>'provincia_residenza', public.dr7_primo_valore(p_meta->>'provinciaResidenza', p_meta->>'provincia_residenza')),
        (p_scheda->>'denominazione', public.dr7_primo_valore(p_meta->>'denominazione', p_meta->>'company_name')),
        (p_scheda->>'partita_iva', public.dr7_primo_valore(p_meta->>'partitaIva', p_meta->>'partita_iva')),
        (p_scheda->>'ente_ufficio', public.dr7_primo_valore(p_meta->>'enteUfficio'))
      ) AS t(nella_scheda, dai_metadati)
      WHERE nullif(btrim(coalesce(t.nella_scheda, '')), '') IS NULL
        AND coalesce(t.dai_metadati, '') <> ''
    )
  END;
$fn$;

-- ---------------------------------------------------------------------------
-- La vista con l'iscritto gia' ricomposto. Sta in uno schema PRIVATO: contiene
-- l'anagrafica di ogni account del sito e non deve essere raggiungibile da
-- PostgREST (che espone solo `public`). La leggono le funzioni qui sotto, che
-- girano come proprietario.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS dr7_privato;
REVOKE ALL ON SCHEMA dr7_privato FROM PUBLIC;

CREATE OR REPLACE VIEW dr7_privato.iscritti_sito AS
SELECT
  b.*,
  -- Nome mostrato: persona fisica, altrimenti la ragione sociale o l'ente.
  public.dr7_primo_valore(
    btrim(b.nome || ' ' || b.cognome),
    b.denominazione,
    b.ente_ufficio
  ) AS nome_visibile,
  lower(concat_ws(' ',
    b.email, b.nome, b.cognome, b.denominazione, b.ente_ufficio,
    b.codice_fiscale, b.partita_iva, b.citta_residenza, b.telefono
  )) AS cerca_testo
FROM (
  SELECT
    a.*,
    -- Nome e cognome: scheda, poi metadati (anche nelle grafie OAuth), poi il
    -- nome intero spezzato, infine il rappresentante legale dell'azienda.
    CASE
      WHEN a.nome_base <> '' OR a.cognome_base <> '' THEN a.nome_base
      WHEN a.nome_intero <> '' THEN (regexp_split_to_array(a.nome_intero, '\s+'))[1]
      ELSE public.dr7_primo_valore(a.scheda->>'rappresentante_nome', a.meta->>'rappresentanteNome')
    END AS nome,
    CASE
      WHEN a.nome_base <> '' OR a.cognome_base <> '' THEN a.cognome_base
      WHEN a.nome_intero <> '' THEN array_to_string((regexp_split_to_array(a.nome_intero, '\s+'))[2:], ' ')
      ELSE public.dr7_primo_valore(a.scheda->>'rappresentante_cognome', a.meta->>'rappresentanteCognome')
    END AS cognome
  FROM (
    SELECT
      g.id, g.email, g.created_at, g.email_confirmed_at, g.last_sign_in_at,
      g.meta, g.scheda, g.balance,
      (nullif(btrim(coalesce(g.scheda->>'user_id', '')), '') IS NOT NULL
       OR nullif(btrim(coalesce(g.scheda->>'email', '')), '') IS NOT NULL) AS ha_scheda,
      public.iscritti_sito_da_recuperare(g.scheda, g.meta) AS da_recuperare,
      public.dr7_primo_valore(g.scheda->>'nome', g.meta->>'nome', g.meta->>'first_name', g.meta->>'given_name') AS nome_base,
      public.dr7_primo_valore(g.scheda->>'cognome', g.meta->>'cognome', g.meta->>'last_name', g.meta->>'family_name') AS cognome_base,
      public.dr7_primo_valore(g.meta->>'full_name', g.meta->>'fullName', g.meta->>'name') AS nome_intero,
      public.dr7_primo_valore(g.scheda->>'tipo_cliente', g.meta->>'tipoCliente') AS tipo_cliente,
      public.dr7_primo_valore(g.scheda->>'nazione', g.meta->>'nazione') AS nazione,
      public.dr7_primo_valore(g.scheda->>'telefono', g.meta->>'telefono', g.meta->>'phone') AS telefono,
      public.dr7_primo_valore(g.scheda->>'pec', g.meta->>'pec') AS pec,
      public.dr7_primo_valore(g.scheda->>'codice_fiscale', g.meta->>'codiceFiscale', g.meta->>'codice_fiscale') AS codice_fiscale,
      public.dr7_primo_valore(g.scheda->>'sesso', g.meta->>'sesso') AS sesso,
      public.dr7_primo_valore(g.scheda->>'data_nascita', g.meta->>'dataNascita', g.meta->>'data_nascita') AS data_nascita,
      public.dr7_primo_valore(g.scheda->>'citta_nascita', g.meta->>'cittaNascita', g.meta->>'citta_nascita') AS citta_nascita,
      public.dr7_primo_valore(g.scheda->>'provincia_nascita', g.meta->>'provinciaNascita', g.meta->>'provincia_nascita') AS provincia_nascita,
      public.dr7_primo_valore(g.scheda->>'indirizzo', g.meta->>'indirizzo') AS indirizzo,
      public.dr7_primo_valore(g.scheda->>'numero_civico', g.meta->>'numeroCivico', g.meta->>'numero_civico') AS numero_civico,
      public.dr7_primo_valore(g.scheda->>'codice_postale', g.meta->>'codicePostale', g.meta->>'codice_postale') AS codice_postale,
      public.dr7_primo_valore(g.scheda->>'citta_residenza', g.meta->>'cittaResidenza', g.meta->>'citta_residenza',
                              g.scheda->>'citta', g.meta->>'citta') AS citta_residenza,
      public.dr7_primo_valore(g.scheda->>'provincia_residenza', g.meta->>'provinciaResidenza', g.meta->>'provincia_residenza') AS provincia_residenza,
      public.dr7_primo_valore(g.scheda->>'denominazione', g.scheda->>'ragione_sociale',
                              g.meta->>'denominazione', g.meta->>'company_name') AS denominazione,
      public.dr7_primo_valore(g.scheda->>'partita_iva', g.meta->>'partitaIva', g.meta->>'partita_iva') AS partita_iva,
      public.dr7_primo_valore(g.scheda->>'codice_destinatario', g.meta->>'codiceDestinatario') AS codice_destinatario,
      public.dr7_primo_valore(g.scheda->>'sede_operativa', g.meta->>'sedeOperativa') AS sede_operativa,
      btrim(
        public.dr7_primo_valore(g.scheda->>'rappresentante_nome', g.meta->>'rappresentanteNome')
        || ' ' ||
        public.dr7_primo_valore(g.scheda->>'rappresentante_cognome', g.meta->>'rappresentanteCognome')
      ) AS rappresentante,
      public.dr7_primo_valore(g.scheda->>'rappresentante_cf', g.meta->>'rappresentanteCF') AS rappresentante_cf,
      public.dr7_primo_valore(g.scheda->>'rappresentante_ruolo', g.meta->>'rappresentanteRuolo') AS rappresentante_ruolo,
      public.dr7_primo_valore(g.scheda->>'ente_ufficio', g.meta->>'enteUfficio') AS ente_ufficio,
      public.dr7_primo_valore(g.scheda->>'codice_univoco', g.meta->>'codiceUnivoco') AS codice_univoco,
      public.dr7_primo_valore(g.scheda->>'source', g.meta->>'source') AS source
    FROM (
      SELECT
        u.id,
        u.email::text AS email,
        u.created_at,
        u.email_confirmed_at,
        u.last_sign_in_at,
        coalesce(u.raw_user_meta_data, '{}'::jsonb) AS meta,
        c.j AS scheda,
        coalesce(w.balance, 0)::numeric AS balance
      FROM auth.users u
      -- La scheda cliente: prima quella agganciata all'account, poi quella con
      -- la stessa email. Identico all'abbinamento fatto finora in TypeScript.
      LEFT JOIN LATERAL (
        SELECT to_jsonb(x) AS j
          FROM public.customers_extended x
         WHERE x.user_id = u.id
            OR (u.email IS NOT NULL AND lower(x.email) = lower(u.email))
         ORDER BY (x.user_id = u.id) DESC NULLS LAST, x.created_at ASC NULLS LAST
         LIMIT 1
      ) c ON TRUE
      LEFT JOIN public.user_credit_balance w ON w.user_id = u.id
    ) g
  ) a
) b;

-- ---------------------------------------------------------------------------
-- Riga dell'elenco nella forma che la tab si aspetta.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION dr7_privato.iscritto_riga(v dr7_privato.iscritti_sito)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $fn$
  SELECT jsonb_build_object(
    'id', v.id,
    'email', coalesce(v.email, ''),
    'created_at', v.created_at,
    'email_confirmed_at', v.email_confirmed_at,
    'last_sign_in_at', v.last_sign_in_at,
    'balance', v.balance,
    'bonus_benvenuto', EXISTS (
      SELECT 1 FROM public.credit_transactions t
       WHERE t.user_id = v.id AND t.reference_type = 'welcome_bonus'
    ),
    'ha_scheda', v.ha_scheda,
    'da_recuperare', v.da_recuperare,
    'tipo_cliente', v.tipo_cliente,
    'nazione', v.nazione,
    'nome', v.nome,
    'cognome', v.cognome,
    'telefono', v.telefono,
    'pec', v.pec,
    'codice_fiscale', v.codice_fiscale,
    'sesso', v.sesso,
    'data_nascita', v.data_nascita,
    'citta_nascita', v.citta_nascita,
    'provincia_nascita', v.provincia_nascita,
    'indirizzo', v.indirizzo,
    'numero_civico', v.numero_civico,
    'codice_postale', v.codice_postale,
    'citta_residenza', v.citta_residenza,
    'provincia_residenza', v.provincia_residenza,
    'denominazione', v.denominazione,
    'partita_iva', v.partita_iva,
    'codice_destinatario', v.codice_destinatario,
    'sede_operativa', v.sede_operativa,
    'rappresentante', v.rappresentante,
    'rappresentante_cf', v.rappresentante_cf,
    'rappresentante_ruolo', v.rappresentante_ruolo,
    'ente_ufficio', v.ente_ufficio,
    'codice_univoco', v.codice_univoco,
    'source', v.source
  );
$fn$;

-- ---------------------------------------------------------------------------
-- Elenco a pagine. Torna { totale, righe } — `totale` e' il conteggio della
-- ricerca in corso, non le righe scaricate.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.iscritti_sito_elenco(
  p_cerca  TEXT    DEFAULT '',
  p_ordine TEXT    DEFAULT 'created_at',
  p_dir    TEXT    DEFAULT 'desc',
  p_offset INTEGER DEFAULT 0,
  p_limite INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_cerca   TEXT    := lower(nullif(btrim(coalesce(p_cerca, '')), ''));
  v_limite  INTEGER := greatest(1, least(coalesce(p_limite, 50), 200));
  v_offset  INTEGER := greatest(0, coalesce(p_offset, 0));
  v_ordine  TEXT    := lower(coalesce(p_ordine, 'created_at'));
  v_dir     TEXT;
  v_colonna TEXT;
  v_totale  BIGINT;
  v_righe   JSONB;
BEGIN
  IF public.dr7_admin_id() IS NULL THEN
    RAISE EXCEPTION 'Riservato agli operatori del gestionale.';
  END IF;

  IF v_ordine NOT IN ('nome', 'email', 'created_at', 'last_sign_in_at', 'balance') THEN
    v_ordine := 'created_at';
  END IF;
  v_dir := CASE WHEN lower(coalesce(p_dir, 'desc')) = 'asc' THEN 'ASC' ELSE 'DESC' END;

  v_colonna := CASE v_ordine
    WHEN 'nome'            THEN 'lower(v.nome_visibile)'
    WHEN 'email'           THEN 'lower(v.email)'
    WHEN 'balance'         THEN 'v.balance'
    WHEN 'last_sign_in_at' THEN 'v.last_sign_in_at'
    ELSE 'v.created_at'
  END;

  IF v_cerca IS NULL AND v_ordine IN ('created_at', 'last_sign_in_at', 'email') THEN
    -- Nessuna ricerca e ordine che vive in auth.users: la pagina si sceglie
    -- PRIMA di ricomporre gli iscritti, cosi' scheda cliente, saldo e bonus si
    -- leggono solo per le righe che finiscono a schermo.
    SELECT count(*) INTO v_totale FROM auth.users;

    EXECUTE format($q$
      SELECT coalesce(jsonb_agg(dr7_privato.iscritto_riga(v) ORDER BY %s %s NULLS LAST, v.id), '[]'::jsonb)
        FROM (
          SELECT u.id
            FROM auth.users u
           ORDER BY %s %s NULLS LAST, u.id
           LIMIT %s OFFSET %s
        ) k
        JOIN dr7_privato.iscritti_sito v ON v.id = k.id
    $q$,
      v_colonna, v_dir,
      CASE v_ordine
        WHEN 'email'           THEN 'lower(u.email::text)'
        WHEN 'last_sign_in_at' THEN 'u.last_sign_in_at'
        ELSE 'u.created_at'
      END,
      v_dir, v_limite, v_offset
    ) INTO v_righe;
  ELSE
    -- Ricerca o ordinamento su un campo ricomposto: si scorre la vista intera
    -- una volta sola. `position` e non LIKE: cosi' un % digitato nella ricerca
    -- resta un carattere, non un jolly.
    SELECT count(*) INTO v_totale
      FROM dr7_privato.iscritti_sito v
     WHERE v_cerca IS NULL OR position(v_cerca IN v.cerca_testo) > 0;

    EXECUTE format($q$
      SELECT coalesce(jsonb_agg(dr7_privato.iscritto_riga(v) ORDER BY %s %s NULLS LAST, v.id), '[]'::jsonb)
        FROM (
          SELECT * FROM dr7_privato.iscritti_sito v2
           WHERE $1 IS NULL OR position($1 IN v2.cerca_testo) > 0
           ORDER BY %s %s NULLS LAST, v2.id
           LIMIT %s OFFSET %s
        ) v
    $q$,
      v_colonna, v_dir,
      replace(v_colonna, 'v.', 'v2.'), v_dir, v_limite, v_offset
    ) INTO v_righe USING v_cerca;
  END IF;

  RETURN jsonb_build_object(
    'totale', coalesce(v_totale, 0),
    'righe', coalesce(v_righe, '[]'::jsonb)
  );
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Le carte in cima e i riquadri di destra. Sono CONTEGGI: prima erano somme
-- fatte sulle righe scaricate, quindi calavano in silenzio se una pagina auth
-- non arrivava.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.iscritti_sito_statistiche()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v JSONB;
BEGIN
  IF public.dr7_admin_id() IS NULL THEN
    RAISE EXCEPTION 'Riservato agli operatori del gestionale.';
  END IF;

  WITH b AS (
    SELECT v.id, v.email_confirmed_at, v.created_at, v.balance, v.ha_scheda,
           v.da_recuperare, v.codice_fiscale, v.partita_iva, v.codice_univoco,
           v.nome_visibile, v.email,
           (bo.user_id IS NOT NULL) AS bonus_benvenuto
      FROM dr7_privato.iscritti_sito v
      LEFT JOIN (
        SELECT DISTINCT user_id
          FROM public.credit_transactions
         WHERE reference_type = 'welcome_bonus'
      ) bo ON bo.user_id = v.id
  ),
  numeri AS (
    SELECT
      count(*)                                                          AS totale,
      count(*) FILTER (WHERE email_confirmed_at IS NOT NULL)            AS verificati,
      count(*) FILTER (WHERE email_confirmed_at IS NULL)                AS non_verificati,
      count(*) FILTER (WHERE created_at >= date_trunc('month', (now() AT TIME ZONE 'Europe/Rome')) AT TIME ZONE 'Europe/Rome') AS nuovi_mese,
      coalesce(sum(balance), 0)                                         AS credito_totale,
      count(*) FILTER (WHERE NOT bonus_benvenuto)                       AS senza_bonus,
      count(*) FILTER (WHERE NOT bonus_benvenuto AND balance = 0)       AS senza_bonus_a_zero,
      count(*) FILTER (WHERE codice_fiscale = '' AND partita_iva = '' AND codice_univoco = '') AS schede_incomplete,
      count(*) FILTER (WHERE da_recuperare)                             AS da_recuperare,
      count(*) FILTER (WHERE NOT ha_scheda)                             AS senza_scheda
    FROM b
  ),
  giorni AS (
    SELECT (d::date) AS giorno
      FROM generate_series(
        ((now() AT TIME ZONE 'Europe/Rome')::date - 29),
        ((now() AT TIME ZONE 'Europe/Rome')::date),
        interval '1 day'
      ) d
  ),
  andamento AS (
    SELECT g.giorno,
           count(b.id) AS quanti
      FROM giorni g
      LEFT JOIN b ON (b.created_at AT TIME ZONE 'Europe/Rome')::date = g.giorno
     GROUP BY g.giorno
  ),
  top AS (
    SELECT b.id, b.nome_visibile, b.email, b.balance
      FROM b
     WHERE b.balance > 0
     ORDER BY b.balance DESC
     LIMIT 5
  )
  SELECT jsonb_build_object(
    'totale', n.totale,
    'verificati', n.verificati,
    'non_verificati', n.non_verificati,
    'nuovi_mese', n.nuovi_mese,
    'credito_totale', n.credito_totale,
    'senza_bonus', n.senza_bonus,
    'senza_bonus_a_zero', n.senza_bonus_a_zero,
    'schede_incomplete', n.schede_incomplete,
    'da_recuperare', n.da_recuperare,
    'senza_scheda', n.senza_scheda,
    'andamento', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                            'giorno', a.giorno, 'quanti', a.quanti) ORDER BY a.giorno), '[]'::jsonb)
                    FROM andamento a),
    'top_credito', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                            'id', t.id, 'nome', t.nome_visibile, 'email', t.email,
                            'balance', t.balance) ORDER BY t.balance DESC), '[]'::jsonb)
                    FROM top t)
  ) INTO v
  FROM numeri n;

  RETURN v;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Gli id per le due azioni di massa. Servono perche' la tab ora ha in mano
-- una pagina sola: chi va accreditato o portato in Clienti lo dice il
-- database. Tetto di sicurezza a 5000 per chiamata.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.iscritti_sito_ids(p_scope TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v JSONB;
BEGIN
  IF public.dr7_admin_id() IS NULL THEN
    RAISE EXCEPTION 'Riservato agli operatori del gestionale.';
  END IF;

  IF p_scope = 'bonus_a_zero' THEN
    SELECT coalesce(jsonb_agg(x.id), '[]'::jsonb) INTO v FROM (
      SELECT v2.id
        FROM dr7_privato.iscritti_sito v2
       WHERE v2.balance = 0
         AND NOT EXISTS (
           SELECT 1 FROM public.credit_transactions t
            WHERE t.user_id = v2.id AND t.reference_type = 'welcome_bonus')
       ORDER BY v2.created_at DESC
       LIMIT 5000
    ) x;
  ELSIF p_scope = 'da_recuperare' THEN
    SELECT coalesce(jsonb_agg(x.id), '[]'::jsonb) INTO v FROM (
      SELECT v2.id
        FROM dr7_privato.iscritti_sito v2
       WHERE v2.da_recuperare
       ORDER BY v2.created_at DESC
       LIMIT 5000
    ) x;
  ELSE
    RAISE EXCEPTION 'Insieme sconosciuto: %', p_scope;
  END IF;

  RETURN v;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Permessi: la vista resta privata, le tre funzioni le chiama il gestionale
-- con la sessione dell'operatore (il controllo vero e' dr7_admin_id()).
-- ---------------------------------------------------------------------------
REVOKE ALL ON dr7_privato.iscritti_sito FROM PUBLIC;

REVOKE ALL ON FUNCTION public.iscritti_sito_elenco(TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.iscritti_sito_statistiche() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.iscritti_sito_ids(TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.iscritti_sito_elenco(TEXT, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.iscritti_sito_statistiche() TO authenticated;
GRANT EXECUTE ON FUNCTION public.iscritti_sito_ids(TEXT) TO authenticated;

COMMENT ON FUNCTION public.iscritti_sito_elenco IS
  'Iscritti al Sito: una pagina di iscritti gia'' ricomposti (scheda cliente + metadati registrazione). Solo operatori.';
COMMENT ON FUNCTION public.iscritti_sito_statistiche IS
  'Iscritti al Sito: conteggi delle carte, andamento 30 giorni e top credito. Solo operatori.';
COMMENT ON FUNCTION public.iscritti_sito_ids IS
  'Iscritti al Sito: id per le azioni di massa (bonus_a_zero | da_recuperare). Solo operatori.';

-- Verifica: prima pagina e conteggio.
SELECT (public.iscritti_sito_elenco('', 'created_at', 'desc', 0, 5))->'totale' AS iscritti_totali;
