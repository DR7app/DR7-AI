-- ============================================================
-- Codice "Invita un amico" mai vuoto per chi ha un account sul sito
--
-- La pagina /account/referral legge customers_extended.referral_code.
-- Alcune schede con user_id avevano referral_code NULL (es. Davide Alfonso,
-- scheda del 07/04 riscritta il 06/05): il cliente vedeva "codice non ancora
-- disponibile". Il DEFAULT della colonna vale solo se l'INSERT non scrive la
-- colonna: chi reinserisce/riscrive una scheda copiando referral_code = null
-- lo azzera.
--
-- 1) trigger: se la scheda ha user_id e il codice e' vuoto, se ne genera uno
--    (INSERT e UPDATE). Un codice gia' presente non viene MAI cambiato.
-- 2) backfill: stesse regole sulle schede esistenti.
-- ============================================================

CREATE OR REPLACE FUNCTION dr7_nuovo_referral_code_cliente()
RETURNS text AS $$
DECLARE
  code text;
BEGIN
  LOOP
    code := 'DR7-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    IF NOT EXISTS (SELECT 1 FROM customers_extended WHERE referral_code = code) THEN
      RETURN code;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_referral_code_mai_vuoto()
RETURNS trigger AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND coalesce(trim(NEW.referral_code), '') = '' THEN
    -- in UPDATE si recupera prima il codice che la scheda aveva gia'
    IF TG_OP = 'UPDATE' AND coalesce(trim(OLD.referral_code), '') <> '' THEN
      NEW.referral_code := OLD.referral_code;
    ELSE
      NEW.referral_code := dr7_nuovo_referral_code_cliente();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_referral_code_mai_vuoto ON customers_extended;
CREATE TRIGGER trg_referral_code_mai_vuoto
  BEFORE INSERT OR UPDATE ON customers_extended
  FOR EACH ROW EXECUTE FUNCTION trg_referral_code_mai_vuoto();

-- Backfill: una riga alla volta, cosi' il controllo di unicita' vede i codici
-- appena assegnati.
DO $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT id FROM customers_extended
    WHERE user_id IS NOT NULL AND coalesce(trim(referral_code), '') = ''
  LOOP
    UPDATE customers_extended SET referral_code = dr7_nuovo_referral_code_cliente() WHERE id = r.id;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'referral_code assegnati: %', n;
END $$;
