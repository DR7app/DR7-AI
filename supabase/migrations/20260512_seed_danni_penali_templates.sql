-- Seed dei 3 template danni/penali in system_messages cosi' direzione li
-- vede in "Messaggi di Sistema Pro" e puo' personalizzarli. Prima il
-- sistema cadeva su un fallback generico "link pagamento" che mandava
-- al cliente il testo sbagliato.
--
-- Idempotente: ON CONFLICT salta se la riga esiste gia'. Non sovrascrive
-- testi che la direzione potrebbe aver gia' personalizzato.

INSERT INTO public.system_messages (message_key, label, description, message_body, is_enabled, include_header)
VALUES
  (
    'pro_richiesta_danni',
    'Richiesta pagamento DANNI',
    'Inviato al cliente quando viene generata una richiesta di pagamento per danni al veicolo. Variabili: {customer_name}, {nome}, {amount}, {link}, {booking_ref}.',
    E'Gentile {nome},\n\nDopo la verifica del veicolo abbiamo riscontrato dei danni che richiedono il tuo intervento. L''importo dovuto è di € {amount}.\n\nPuoi saldare comodamente tramite il seguente link sicuro (valido 1 ora):\n{link}\n\nRiferimento prenotazione: {booking_ref}\n\nPer qualsiasi chiarimento siamo a disposizione.\nDR7 Empire',
    true,
    false
  ),
  (
    'pro_richiesta_penali',
    'Richiesta pagamento PENALI',
    'Inviato al cliente quando viene generata una richiesta di pagamento per penali (es. consegna in ritardo, mancato rispetto condizioni contratto). Variabili: {customer_name}, {nome}, {amount}, {link}, {booking_ref}.',
    E'Gentile {nome},\n\nIn base alle condizioni del contratto di noleggio è stata applicata una penale di € {amount}.\n\nPuoi saldare tramite il link sicuro qui sotto (valido 1 ora):\n{link}\n\nRiferimento prenotazione: {booking_ref}\n\nPer ogni chiarimento siamo a tua disposizione.\nDR7 Empire',
    true,
    false
  ),
  (
    'pro_richiesta_danni_penali',
    'Richiesta pagamento DANNI + PENALI',
    'Inviato al cliente quando viene generata UN UNICO link che cumula danni e penali. Variabili: {customer_name}, {nome}, {amount}, {link}, {booking_ref}.',
    E'Gentile {nome},\n\nAl termine del noleggio sono stati rilevati danni e penali per un totale di € {amount}.\n\nPuoi saldare tramite il link sicuro qui sotto (valido 1 ora):\n{link}\n\nRiferimento prenotazione: {booking_ref}\n\nResta a disposizione il nostro team per qualsiasi chiarimento.\nDR7 Empire',
    true,
    false
  )
ON CONFLICT (message_key) DO NOTHING;
