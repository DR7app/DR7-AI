-- System Control: incremento atomico delle metriche.
-- Prima il wrapper leggeva la riga dell'ora e poi la riscriveva: due chiamate
-- simultanee perdevano un incremento. Ora un solo INSERT ... ON CONFLICT.
-- Il codice funziona anche senza questa funzione (ripiega sulla lettura +
-- scrittura), quindi la migrazione si puo' eseguire in qualunque momento.
CREATE OR REPLACE FUNCTION public.sc_registra_metrica(
  p_tipo TEXT, p_nome TEXT, p_business TEXT, p_ora TIMESTAMPTZ,
  p_durata_ms INTEGER, p_errore BOOLEAN
) RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  INSERT INTO public.sc_metrics AS m (tipo, nome, business, ora, chiamate, errori, durata_totale_ms, durata_max_ms)
  VALUES (p_tipo, left(p_nome, 120), coalesce(p_business, '*'), p_ora, 1, CASE WHEN p_errore THEN 1 ELSE 0 END, p_durata_ms, p_durata_ms)
  ON CONFLICT (tipo, nome, business, ora) DO UPDATE SET
    chiamate = m.chiamate + 1,
    errori = m.errori + EXCLUDED.errori,
    durata_totale_ms = m.durata_totale_ms + EXCLUDED.durata_totale_ms,
    durata_max_ms = greatest(m.durata_max_ms, EXCLUDED.durata_max_ms);
$$;

-- Solo il service role (le Netlify functions) scrive le metriche.
REVOKE ALL ON FUNCTION public.sc_registra_metrica(TEXT, TEXT, TEXT, TIMESTAMPTZ, INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sc_registra_metrica(TEXT, TEXT, TEXT, TIMESTAMPTZ, INTEGER, BOOLEAN) TO service_role;
