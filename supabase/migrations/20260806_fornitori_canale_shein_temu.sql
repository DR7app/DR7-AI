-- ─────────────────────────────────────────────────────────────────────────
-- Nuovi canali di riordino fornitori: Shein e Temu.
-- 1) allarga i 3 CHECK che vincolavano il canale ai 4 valori originali
--    (fornitori.canale_riordino_default, inv_articoli.canale_riordino,
--     inv_ordini.canale);
-- 2) aggiunge Shein e Temu all'elenco fornitori (idempotente).
-- Il canale e' solo un'etichetta (ordine reale fatto a mano sui siti Shein/Temu):
-- nessuna logica di invio cambia, l'alarm WhatsApp allo staff resta invariato.
-- ─────────────────────────────────────────────────────────────────────────

-- Rimuove OGNI check constraint esistente sulle 3 colonne canale, qualunque sia
-- il nome auto-generato, poi ne aggiunge uno nuovo che include shein/temu.
DO $$
DECLARE
    r RECORD;
    canali CONSTANT TEXT := '''whatsapp'',''email'',''amazon'',''shein'',''temu'',''manuale''';
    targets TEXT[][] := ARRAY[
        ARRAY['fornitori',   'canale_riordino_default'],
        ARRAY['inv_articoli','canale_riordino'],
        ARRAY['inv_ordini',  'canale']
    ];
    t TEXT[];
BEGIN
    FOREACH t SLICE 1 IN ARRAY targets LOOP
        -- drop di tutti i CHECK che citano la colonna su quella tabella
        FOR r IN
            SELECT con.conname
            FROM pg_constraint con
            JOIN pg_class cls ON cls.oid = con.conrelid
            JOIN pg_namespace ns ON ns.oid = cls.relnamespace
            WHERE ns.nspname = 'public'
              AND cls.relname = t[1]
              AND con.contype = 'c'
              AND pg_get_constraintdef(con.oid) ILIKE '%' || t[2] || '%'
        LOOP
            EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t[1], r.conname);
        END LOOP;

        EXECUTE format(
            'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%I IN (%s))',
            t[1], t[1] || '_' || t[2] || '_check', t[2], canali);
    END LOOP;
END $$;

-- Elenco fornitori: aggiungi Shein e Temu se non gia' presenti (match per nome).
INSERT INTO public.fornitori (nome, canale_riordino_default, note, attivo)
SELECT v.nome, v.canale, 'E-commerce — ordine manuale sul sito', TRUE
FROM (VALUES ('Shein', 'shein'), ('Temu', 'temu')) AS v(nome, canale)
WHERE NOT EXISTS (
    SELECT 1 FROM public.fornitori f WHERE LOWER(f.nome) = LOWER(v.nome)
);
