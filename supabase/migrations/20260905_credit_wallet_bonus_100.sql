-- 05/09/2026 — Credit Wallet: il bonus massimo e' il 100%, non il 33%.
--
-- I pacchetti salvati dicono gia' un'altra cosa: "DR7 10000" da' 10.000 di
-- bonus su 10.000 ricaricati, cioe' il 100%. I due testi della pagina erano
-- rimasti fermi al 33% di quando il pacchetto piu' generoso era un altro, e
-- promettevano al cliente MENO di quello che riceve davvero.
--
-- Come per l'etichetta del menu: i valori di partenza nel codice del sito non
-- bastano, perche' la riga salvata in `centralina_pro_config` vince sempre.
-- Idempotente; tocca solo questi quattro campi sulla riga 'main'.

UPDATE centralina_pro_config
SET config = jsonb_set(
    jsonb_set(
        jsonb_set(
            jsonb_set(
                config,
                '{site_copy,creditWallet,hero_intro_it}',
                '"Il sistema di credito flessibile che premia la tua fiducia. Acquista crediti DR7 e ricevi bonus fino al 100%."'::jsonb, true
            ),
            '{site_copy,creditWallet,hero_intro_en}',
            '"The flexible credit system that rewards your trust. Buy DR7 credits and receive bonuses up to 100%."'::jsonb, true
        ),
        '{site_copy,creditWallet,benefit_extra_title_it}', '"Fino al 100% Extra"'::jsonb, true
    ),
    '{site_copy,creditWallet,benefit_extra_title_en}', '"Up to 100% Extra"'::jsonb, true
)
WHERE id = 'main'
  AND config #> '{site_copy,creditWallet}' IS NOT NULL;
