-- ============================================================================
-- FIDELITY CARD LAVAGGIO: AZZERA I PUNTI, UNA SOLA VOLTA PER CLIENTE (13/11/2026)
--
-- Da eseguire a mano nel SQL editor di Supabase, DOPO
-- 20261106_fidelity_lavaggio_da_centralina.sql. Rilanciabile.
--
-- PERCHE' (direzione, 13/11/2026)
-- Si ritirano le vecchie carte di cartone. Chi la usava ha gia' dei punti sul
-- gestionale per lavaggi timbrati anche sulla carta vecchia: allo staff serve
-- poter azzerare i punti di quel cliente al momento del ritiro, cosi' riparte
-- da zero con la carta nuova. Si puo' fare UNA volta sola per cliente:
-- "altrimenti si possono fare danni".
--
-- COME FUNZIONA
-- Si riusa l'ancora di 20261106 (fidelity_lavaggio_ancora), senza toccare la
-- formula: per la versione delle regole in vigore si scrive per il cliente
-- un'ancora con punti = 0, i centesimi di lavaggi pagati di adesso e i premi
-- gia' dati. Da li' in poi la carta conta solo i lavaggi pagati dopo
-- l'azzeramento, con le regole in vigore. Il "Totale punti" (storico) e i
-- premi gia' emessi non si toccano.
-- Un cambio di regole successivo (dr7_fidelity_lavaggio_applica) fotografa la
-- carta a partire da questa ancora: l'azzeramento resta.
-- La riga in fidelity_lavaggio_azzeramenti (chiave = titolare) e' il "una
-- volta sola": una seconda chiamata risponde gia_azzerata e non scrive nulla.
--
-- CASO LIMITE
-- Un lavaggio pagato PRIMA dell'azzeramento e annullato DOPO toglie i suoi
-- punti a quelli nuovi (la carta resta a 0 finche' non li ricupera), come gia'
-- succede dopo un cambio di regole.
--
-- CHI PUO'
-- Solo lo staff (riga in `admins` per auth.uid()). La funzione e' chiamata dal
-- gestionale, scheda cliente > Fidelity Card lavaggio > "Azzera punti".
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fidelity_lavaggio_azzeramenti (
  titolare UUID PRIMARY KEY,
  scheda_id UUID,
  punti_azzerati INTEGER NOT NULL,
  totale_al_momento INTEGER NOT NULL,
  versione INTEGER NOT NULL,
  azzerato_da UUID,
  azzerato_da_email TEXT,
  azzerato_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.fidelity_lavaggio_azzeramenti ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fidelity_lavaggio_azzeramenti_staff_lettura ON public.fidelity_lavaggio_azzeramenti;
CREATE POLICY fidelity_lavaggio_azzeramenti_staff_lettura ON public.fidelity_lavaggio_azzeramenti
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()));
-- Nessuna policy di scrittura: si scrive solo dalla funzione qui sotto.

CREATE OR REPLACE FUNCTION public.dr7_fidelity_lavaggio_azzera(p_scheda UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_titolare UUID;
  v_schede UUID[];
  v_cfg JSONB;
  v_ver INTEGER;
  v_cent NUMERIC;
  v_base INTEGER;
  v_dati INTEGER;
  v_an INTEGER;
  v_ap INTEGER;
  v_at INTEGER;
  v_ac NUMERIC;
  v_ar INTEGER;
  f RECORD;
  v_gia RECORD;
  v_email TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Solo lo staff puo azzerare i punti' USING ERRCODE = '42501';
  END IF;
  IF p_scheda IS NULL OR NOT EXISTS (SELECT 1 FROM customers_extended WHERE id = p_scheda) THEN
    RAISE EXCEPTION 'Cliente non trovato' USING ERRCODE = 'P0002';
  END IF;

  v_titolare := dr7_punti_titolare_corrente(p_scheda);

  -- Stessi lock del ricalcolo: nessun accredito a meta' durante l'azzeramento.
  PERFORM pg_advisory_xact_lock_shared(hashtext('dr7_fidelity_lavaggio_regole'));
  PERFORM pg_advisory_xact_lock(hashtext('dr7_punti_lavaggio:' || v_titolare::TEXT));

  v_schede := ARRAY[v_titolare] || coalesce(ARRAY(SELECT id FROM customers_extended WHERE user_id = v_titolare), '{}'::UUID[]);

  -- Una volta sola, anche se nel frattempo la scheda e' stata collegata a un account.
  SELECT * INTO v_gia FROM fidelity_lavaggio_azzeramenti
   WHERE titolare = ANY (v_schede) ORDER BY azzerato_at LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'gia_azzerata',
                              'azzerato_at', v_gia.azzerato_at,
                              'azzerato_da_email', v_gia.azzerato_da_email,
                              'punti_azzerati', v_gia.punti_azzerati);
  END IF;

  SELECT dr7_fidelity_lavaggio_norm(c.config), c.versione INTO v_cfg, v_ver
    FROM fidelity_lavaggio_config c WHERE c.id = 'attiva';
  IF v_cfg IS NULL THEN v_cfg := dr7_fidelity_lavaggio_norm('{}'::JSONB); v_ver := 0; END IF;

  -- La carta di adesso, con la stessa formula del ricalcolo.
  v_cent := dr7_punti_lavaggio_cent(v_titolare);
  SELECT coalesce(sum(soglie), 0) INTO v_base FROM fidelity_lavaggio_base WHERE titolare = ANY (v_schede);
  SELECT count(*) INTO v_dati FROM fidelity_buoni
   WHERE titolare = ANY (v_schede) OR (titolare IS NULL AND customer_extended_id = ANY (v_schede));
  SELECT count(*), coalesce(sum(punti), 0), coalesce(sum(totale), 0), coalesce(sum(cent), 0), coalesce(sum(premi), 0)
    INTO v_an, v_ap, v_at, v_ac, v_ar
    FROM fidelity_lavaggio_ancora WHERE versione = v_ver AND titolare = ANY (v_schede);
  SELECT * INTO f FROM dr7_punti_lavaggio_formula(v_cfg, v_cent, v_an, v_ap, v_at, v_ac, v_ar, v_base, v_dati);

  -- Ancora a zero: da qui contano solo i lavaggi pagati dopo.
  DELETE FROM fidelity_lavaggio_ancora WHERE versione = v_ver AND titolare = ANY (v_schede);
  INSERT INTO fidelity_lavaggio_ancora (versione, titolare, punti, totale, cent, premi)
  VALUES (v_ver, v_titolare, 0, f.totale, v_cent, v_dati);

  UPDATE customers_extended
     SET fidelity_points = 0
   WHERE id = ANY (v_schede)
     AND coalesce(user_id, id) = v_titolare;

  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  INSERT INTO fidelity_lavaggio_azzeramenti (titolare, scheda_id, punti_azzerati, totale_al_momento, versione,
                                             azzerato_da, azzerato_da_email)
  VALUES (v_titolare, p_scheda, f.linea, f.totale, v_ver, auth.uid(), v_email);

  RETURN jsonb_build_object('ok', true, 'punti_azzerati', f.linea, 'totale', f.totale);
END;
$$;

REVOKE ALL ON FUNCTION public.dr7_fidelity_lavaggio_azzera(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dr7_fidelity_lavaggio_azzera(UUID) TO authenticated, service_role;

-- Verifica (facoltativa):
--   SELECT * FROM fidelity_lavaggio_azzeramenti ORDER BY azzerato_at DESC;
