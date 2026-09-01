-- =====================================================================
-- 26/08/2026 — Da dove escono i numeri della carta "Senza Bonus 10€"
-- =====================================================================
-- Solo LETTURE: non scrive niente. Serve a confrontare i numeri veri del
-- database con quelli mostrati dalla carta (Iscritti al Sito).
--
-- La carta conta cosi':
--   valore grande   = account auth SENZA una riga credit_transactions con
--                     reference_type = 'welcome_bonus'
--   "con wallet a 0"= di quelli, chi ha saldo 0 (è l'unico gruppo che il
--                     pulsante di accredito in blocco tocca)
--   "schede incomplete" = account senza codice fiscale NE' partita iva NE'
--                     codice univoco, cercati sia nella scheda cliente sia
--                     nei metadati dell'iscrizione
-- =====================================================================

-- PASSO 1 — I quattro numeri, calcolati come li calcola la schermata
SELECT
  (SELECT count(*) FROM auth.users) AS account_totali,

  (SELECT count(*) FROM auth.users u
    WHERE NOT EXISTS (SELECT 1 FROM credit_transactions ct
                      WHERE ct.user_id = u.id AND ct.reference_type = 'welcome_bonus')
  ) AS senza_bonus,

  (SELECT count(*) FROM auth.users u
    WHERE NOT EXISTS (SELECT 1 FROM credit_transactions ct
                      WHERE ct.user_id = u.id AND ct.reference_type = 'welcome_bonus')
      AND COALESCE((SELECT b.balance FROM user_credit_balance b WHERE b.user_id = u.id), 0) = 0
  ) AS senza_bonus_e_wallet_a_zero,

  (SELECT count(*) FROM auth.users u
    LEFT JOIN customers_extended ce ON ce.user_id = u.id
    WHERE COALESCE(
            NULLIF(btrim(ce.codice_fiscale), ''),
            NULLIF(btrim(u.raw_user_meta_data->>'codiceFiscale'), ''),
            NULLIF(btrim(ce.partita_iva), ''),
            NULLIF(btrim(u.raw_user_meta_data->>'partitaIva'), ''),
            NULLIF(btrim(ce.codice_univoco), ''),
            NULLIF(btrim(u.raw_user_meta_data->>'codiceUnivoco'), '')
          ) IS NULL
  ) AS schede_incomplete;

-- PASSO 2 — Chi sono i "senza bonus": email, saldo, quando si sono iscritti.
-- Se in questo elenco ci sono account dello staff o clienti creati dal
-- gestionale, allora la carta sta contando gente che non e' iscritta al sito.
SELECT u.email,
       u.created_at,
       COALESCE((SELECT b.balance FROM user_credit_balance b WHERE b.user_id = u.id), 0) AS saldo,
       u.raw_user_meta_data->>'source' AS provenienza,
       EXISTS (SELECT 1 FROM admins a WHERE lower(a.email) = lower(u.email)) AS e_staff
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM credit_transactions ct
                  WHERE ct.user_id = u.id AND ct.reference_type = 'welcome_bonus')
ORDER BY u.created_at DESC;

-- PASSO 3 — Le "schede incomplete" divise per provenienza: si vede subito
-- se sono iscritti veri del sito o account di altra natura (Google, staff,
-- import dal gestionale).
SELECT COALESCE(NULLIF(u.raw_user_meta_data->>'source', ''), '(nessuna provenienza)') AS provenienza,
       count(*) AS quanti,
       count(*) FILTER (WHERE ce.user_id IS NULL) AS senza_scheda_cliente
FROM auth.users u
LEFT JOIN customers_extended ce ON ce.user_id = u.id
WHERE COALESCE(
        NULLIF(btrim(ce.codice_fiscale), ''),
        NULLIF(btrim(u.raw_user_meta_data->>'codiceFiscale'), ''),
        NULLIF(btrim(ce.partita_iva), ''),
        NULLIF(btrim(u.raw_user_meta_data->>'partitaIva'), ''),
        NULLIF(btrim(ce.codice_univoco), ''),
        NULLIF(btrim(u.raw_user_meta_data->>'codiceUnivoco'), '')
      ) IS NULL
GROUP BY 1
ORDER BY quanti DESC;
