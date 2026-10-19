-- ============================================================================
-- PREVENDITE: SOLO CARTA (19/10/2026)
--
-- Una prevendita non si paga piu' col Credit Wallet ne' con un codice sconto.
-- Il sito ha gia' tolto il pulsante wallet e il pagamento a credito nel
-- carrello; qui si chiude anche la porta del database, cosi' nessuno puo'
-- chiamare la funzione direttamente dal browser.
--
-- La funzione resta (storico, eventuale ripristino), ma solo service_role.
-- Ripristino: GRANT EXECUTE ... TO authenticated.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.prevendita_acquista_con_credito(UUID, JSONB) FROM authenticated;
