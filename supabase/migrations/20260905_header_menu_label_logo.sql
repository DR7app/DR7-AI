-- 05/09/2026 — Barra in alto: "MENU" al posto di "ESPLORA" e logo un filo
-- piu' grande.
--
-- I due valori vivono in `centralina_pro_config.config.site_copy` e la riga
-- salvata VINCE sempre sui valori di partenza scritti nel codice del sito
-- (`Sito/utils/siteCopy.ts`). Cambiare solo quelli non avrebbe cambiato nulla
-- sul sito vero: l'istanza ha gia' 'ESPLORA' e le altezze 56/64 scritte a
-- database. Questa migrazione allinea la riga.
--
-- Solo la riga 'main' (Terra): il sito pubblico legge quella.
-- Idempotente: rilanciarla riscrive gli stessi valori.

UPDATE centralina_pro_config
SET config = jsonb_set(
    jsonb_set(
        jsonb_set(
            jsonb_set(
                config,
                '{site_copy,header,explore_label_it}', '"MENU"'::jsonb, true
            ),
            '{site_copy,header,explore_label_en}', '"MENU"'::jsonb, true
        ),
        '{site_copy,aspetto,logo_height_desktop}', '72'::jsonb, true
    ),
    '{site_copy,aspetto,logo_height_mobile}', '62'::jsonb, true
)
WHERE id = 'main'
  AND config ? 'site_copy';
