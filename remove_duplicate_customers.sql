-- Pulisce i duplicati basandosi sull'EMAIL
-- Mantiene il record PIÙ COMPLETO (quello con più dati compilati)
-- Se a parità di dati, mantiene il più recente aggiornato.

WITH scored_duplicates AS (
  SELECT
    id,
    email,
    updated_at,
    created_at,
    -- Calcolo Punteggio di Completezza
    (
      (CASE WHEN codice_fiscale IS NOT NULL AND codice_fiscale <> '' THEN 10 ELSE 0 END) +
      (CASE WHEN partita_iva IS NOT NULL AND partita_iva <> '' THEN 10 ELSE 0 END) +
      (CASE WHEN indirizzo IS NOT NULL AND indirizzo <> '' THEN 5 ELSE 0 END) +
      (CASE WHEN numero_patente IS NOT NULL AND numero_patente <> '' THEN 5 ELSE 0 END) +
      (CASE WHEN telefono IS NOT NULL AND telefono <> '' THEN 2 ELSE 0 END) +
      (CASE WHEN nazione IS NOT NULL AND nazione <> '' THEN 1 ELSE 0 END)
    ) as completeness_score
  FROM
    customers_extended
  WHERE
    email IS NOT NULL AND trim(email) <> ''
),
ranked_duplicates AS (
  SELECT
    id,
    email,
    completeness_score,
    -- Classifica: 1° = Punteggio più alto, poi più recente
    ROW_NUMBER() OVER (
      PARTITION BY lower(trim(email))
      ORDER BY completeness_score DESC, updated_at DESC
    ) as rn
  FROM
    scored_duplicates
)
-- Seleziona ed elimina quelli che NON sono il numero 1 (rn > 1)
DELETE FROM customers_extended
WHERE id IN (
  SELECT id FROM ranked_duplicates WHERE rn > 1
);

-----------------------------------------------------------------------
-- OPZIONALE: Pulisce i duplicati basandosi sul TELEFONO (se l'email non c'è)
-- Stessa logica di completezza
WITH scored_phones AS (
  SELECT
    id,
    telefono,
    updated_at,
    (
      (CASE WHEN codice_fiscale IS NOT NULL AND codice_fiscale <> '' THEN 10 ELSE 0 END) +
      (CASE WHEN numero_patente IS NOT NULL AND numero_patente <> '' THEN 5 ELSE 0 END) +
      (CASE WHEN nome IS NOT NULL AND nome <> '' THEN 2 ELSE 0 END)
    ) as completeness_score
  FROM
    customers_extended
  WHERE
    telefono IS NOT NULL AND trim(telefono) <> ''
    AND (email IS NULL OR trim(email) = '') -- Solo per chi non ha email
),
ranked_phones AS (
  SELECT
    id,
    telefono,
    ROW_NUMBER() OVER (
      PARTITION BY trim(telefono)
      ORDER BY completeness_score DESC, updated_at DESC
    ) as rn
  FROM
    scored_phones
)
DELETE FROM customers_extended
WHERE id IN (
  SELECT id FROM ranked_phones WHERE rn > 1
);
