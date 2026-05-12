-- ============================================================
-- Audit completo OTP — assicura che OGNI codice usato in code sia
-- elencato in system_otp_overrides (cosi' appare nel tab Gestione
-- OTP) e disattiva i gate che l'utente ha esplicitamente chiesto di
-- togliere.
--
-- 1) INSERT idempotente di TUTTI i codici visti nel codice.
-- 2) UPDATE per disattivare booking.delete + wash.delete (richiesta
--    diretta: nessun OTP quando si cancella una prenotazione).
--
-- Sicuro rieseguire: ON CONFLICT DO NOTHING + UPDATE per id.
-- ============================================================

-- ── 1) Codici mancanti (audit grep'ato dal codice 2026-05-12) ──
INSERT INTO public.system_otp_overrides (id, label, reason, used_in, is_required, sort_order) VALUES
    -- Sito CMS (gating Sito tab access + write)
    ('gestione_sito_access',   'Accesso al tab Sito',                'Aprire la sezione Sito (CMS) richiede autorizzazione direzionale per operatori non-direzione.',                                  'Tab Sito',                       true, 240),
    ('gestione_sito_write',    'Modifica testi del Sito',            'Salvare modifiche ai testi/contenuti del sito (FAQ, Hero, Footer, etc.) richiede autorizzazione direzionale.',                  'Tab Sito > Salva',              true, 250),

    -- Booking actions gia' wired in codice
    ('booking.delete',         'Elimina Prenotazione Noleggio',      'Eliminare una prenotazione di noleggio: azione irreversibile, richiede approvazione direzionale.',                                'Prenotazioni > tasto Elimina',  true, 260),
    ('wash.delete',            'Elimina Prenotazione Lavaggio',      'Eliminare una prenotazione lavaggio/meccanica: azione irreversibile, richiede approvazione direzionale.',                          'Prime Wash > tasto Elimina',    true, 270),

    -- Fattura actions gia' wired
    ('fattura.delete',         'Elimina Fattura',                    'Eliminare una fattura non ancora inviata a SDI. Se inviata, va creata una Nota di Credito.',                                       'Fattura > tasto Elimina',       true, 280),
    ('fattura.send_sdi',       'Invia Fattura a SDI',                'L''invio al Sistema di Interscambio (SDI) e'' definitivo. Richiede approvazione direzionale.',                                      'Fattura > tasto Invia SDI',     true, 290)
ON CONFLICT (id) DO NOTHING;

-- ── 2) Disattiva OTP delete booking (richiesta esplicita) ────
-- L'utente non vuole piu' essere chiesta OTP quando elimina una
-- prenotazione (noleggio o lavaggio). is_required=false → il hook
-- useLimitationOverride bypassa silenziosamente.
UPDATE public.system_otp_overrides
SET is_required = false, updated_at = now()
WHERE id IN ('booking.delete', 'wash.delete');
