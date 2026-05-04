-- Cleanup — rimuove i documenti fornitore con data_documento < 2026-01-01
-- che la sync da Aruba potrebbe aver trascinato dentro nei 12 mesi indietro.
-- I clienti DR7 partono dal 01/2026, qualsiasi cosa precedente e' rumore.
-- Idempotente: tocca solo le righe pre-2026.

-- Preview: quanti record verranno rimossi e per quali fornitori
SELECT
    f.nome AS fornitore,
    COUNT(*) AS docs_pre_2026,
    MIN(d.data_documento) AS data_piu_vecchia,
    MAX(d.data_documento) AS data_piu_recente
FROM public.fornitore_documents d
JOIN public.fornitori f ON f.id = d.fornitore_id
WHERE d.data_documento < '2026-01-01'
GROUP BY f.nome
ORDER BY docs_pre_2026 DESC;

-- Esegui questo per cancellarli (rimuove anche eventuali alert collegati via FK CASCADE)
DELETE FROM public.fornitore_documents
WHERE data_documento < '2026-01-01';

-- Verifica: dovrebbe ritornare 0
SELECT COUNT(*) AS residui
FROM public.fornitore_documents
WHERE data_documento < '2026-01-01';
