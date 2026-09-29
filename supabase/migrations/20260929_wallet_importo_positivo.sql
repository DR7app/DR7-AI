-- deduct_credits / book_with_credits: importo > 0 (29/09/2026)
--
-- Revisione indipendente: deduct_credits(p_user_id = me, p_amount = -1000)
-- AUMENTAVA il saldo di 1000 EUR (saldo - (-1000)), e il controllo "credito
-- insufficiente" non scattava. Chiamabile da qualunque cliente loggato sul
-- proprio wallet. Provato in produzione su un account di prova (transazione
-- annullata): 0,50 -> 1.000,50. Stesso difetto in book_with_credits.
-- Il controllo si aggiunge subito dopo dr7_wallet_solo_proprio. Idempotente.
DO $$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.deduct_credits(uuid,numeric,text,uuid,text)'::regprocedure);
  IF position('importo_non_positivo' IN v_def) = 0 THEN
    v_def := replace(v_def, 'PERFORM public.dr7_wallet_solo_proprio(p_user_id);',
      E'PERFORM public.dr7_wallet_solo_proprio(p_user_id);\n  IF p_amount IS NULL OR p_amount <= 0 THEN\n    RAISE EXCEPTION ''Importo non valido: deve essere maggiore di zero'' USING ERRCODE = ''22023'', HINT = ''importo_non_positivo'';\n  END IF;');
    EXECUTE v_def;
  END IF;

  v_def := pg_get_functiondef('public.book_with_credits(uuid,integer,text,jsonb)'::regprocedure);
  IF position('importo_non_positivo' IN v_def) = 0 THEN
    v_def := replace(v_def, 'PERFORM public.dr7_wallet_solo_proprio(p_user_id);',
      E'PERFORM public.dr7_wallet_solo_proprio(p_user_id);\n  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN\n    RAISE EXCEPTION ''Importo non valido: deve essere maggiore di zero'' USING ERRCODE = ''22023'', HINT = ''importo_non_positivo'';\n  END IF;');
    EXECUTE v_def;
  END IF;
END $$;
