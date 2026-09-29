-- Prova della fase 1, da lanciare PRIMA e DOPO la migrazione.
-- Gira come anon, come cliente (Massimo) e come staff (Ophelie) dentro una
-- transazione che alla fine viene annullata (RAISE): non resta scritto niente.
DO $$
DECLARE
  cliente uuid := '3b896d05-3d65-4819-a46a-ea9894343935';
  staff   uuid := '640112eb-a2d9-4751-a967-a1d531a9e6fb';
  n int; out text := '';

BEGIN
  -- ── anon ──
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SELECT count(*) INTO n FROM centralina_pro_config; out := out || 'ANON lettura_centralina=' || n;
  UPDATE centralina_pro_config SET config = config WHERE id = 'main'; GET DIAGNOSTICS n = ROW_COUNT; out := out || ' scrive_centralina=' || n;
  SELECT count(*) INTO n FROM discount_codes; out := out || ' legge_codici=' || n;
  UPDATE discount_codes SET code = code; GET DIAGNOSTICS n = ROW_COUNT; out := out || ' scrive_codici=' || n;
  SELECT count(*) INTO n FROM system_messages; out := out || ' legge_messaggi=' || n;
  UPDATE system_messages SET message_body = message_body; GET DIAGNOSTICS n = ROW_COUNT; out := out || ' scrive_messaggi=' || n;
  SELECT count(*) INTO n FROM user_documents; out := out || ' legge_documenti=' || n;
  UPDATE pending_addebiti SET id = id; GET DIAGNOSTICS n = ROW_COUNT; out := out || ' scrive_addebiti=' || n;
  SELECT count(*) INTO n FROM payment_method_config; out := out || ' legge_metodi_pag=' || n;
  RESET ROLE;

  -- ── cliente ──
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', cliente, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM centralina_pro_config; out := out || E'\nCLIENTE lettura_centralina=' || n;
  UPDATE centralina_pro_config SET config = config WHERE id = 'main'; GET DIAGNOSTICS n = ROW_COUNT; out := out || ' scrive_centralina=' || n;
  SELECT count(*) INTO n FROM discount_codes; out := out || ' legge_codici=' || n;
  SELECT count(*) INTO n FROM system_messages; out := out || ' legge_messaggi=' || n;
  SELECT count(*) INTO n FROM user_documents; out := out || ' legge_documenti=' || n;
  SELECT count(*) INTO n FROM user_documents WHERE user_id = cliente; out := out || ' (propri=' || n || ')';
  BEGIN
    INSERT INTO user_documents (user_id, document_type, file_path, bucket) VALUES (cliente, 'PROVA', 'prova/x.jpg', 'driver-licenses');
    out := out || ' aggiunge_proprio=si';
  EXCEPTION WHEN OTHERS THEN out := out || ' aggiunge_proprio=NO(' || SQLSTATE || ')'; END;
  BEGIN
    INSERT INTO user_documents (user_id, document_type, file_path, bucket) VALUES (staff, 'PROVA', 'prova/y.jpg', 'driver-licenses');
    out := out || ' aggiunge_altrui=SI';
  EXCEPTION WHEN OTHERS THEN out := out || ' aggiunge_altrui=no'; END;
  DELETE FROM user_documents WHERE document_type = 'PROVA' AND user_id = cliente; GET DIAGNOSTICS n = ROW_COUNT; out := out || ' cancella_proprio=' || n;
  RESET ROLE;

  -- ── staff ──
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', staff, 'role', 'authenticated')::text, true);
  UPDATE centralina_pro_config SET config = config WHERE id = 'main'; GET DIAGNOSTICS n = ROW_COUNT; out := out || E'\nSTAFF scrive_centralina=' || n;
  SELECT count(*) INTO n FROM discount_codes; out := out || ' legge_codici=' || n;
  UPDATE system_messages SET message_body = message_body WHERE id IS NOT NULL; GET DIAGNOSTICS n = ROW_COUNT; out := out || ' scrive_messaggi=' || n;
  SELECT count(*) INTO n FROM user_documents; out := out || ' legge_documenti=' || n;
  SELECT count(*) INTO n FROM magazzino_ordini; out := out || ' legge_magazzino=' || n;
  SELECT count(*) INTO n FROM payment_method_config; out := out || ' legge_metodi_pag=' || n;
  SELECT count(*) INTO n FROM movimenti_aerei; out := out || ' legge_movimenti_aerei=' || n;
  SELECT count(*) INTO n FROM sent_messages_log; out := out || ' legge_log_messaggi=' || n;
  RESET ROLE;

  RAISE EXCEPTION E'RISULTATO\n%', out;
END $$;
