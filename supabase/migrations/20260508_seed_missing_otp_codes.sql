-- ============================================================
-- Seed dei codici OTP mancanti (audit completo del codice 2026-05-08).
--
-- system_otp_overrides era stato popolato a fine aprile 2026 con i 10
-- codici noti all'epoca. Da allora sono stati aggiunti diversi gate
-- (Gestione OTP self-management, lavaggio/booking confirmations,
-- fuori orario, paid_rental_modify, foreign plate carwash, fornitore
-- admin actions). Questo migrate aggiunge le righe mancanti così
-- ogni gate è elencato in Gestione OTP e può essere attivato /
-- disattivato dalla direzione.
--
-- ON CONFLICT DO NOTHING — non sovrascrive righe già presenti, è
-- sicuro rieseguire e non azzera customizzazioni manuali.
-- ============================================================

INSERT INTO public.system_otp_overrides (id, label, reason, used_in, is_required, sort_order) VALUES
    -- Booking / Preventivo Salva-time (combined-OTP gate)
    ('out_of_office_hours',          'Ritiro/Riconsegna Fuori Orario',           'Pickup o riconsegna selezionati fuori dagli orari standard di apertura. Richiede autorizzazione direzionale al Salva.',                                          'Prenotazione + Preventivo',           true, 110),
    ('paid_rental_modify',           'Modifica Prenotazione Pagata/Confermata',   'Modificare una prenotazione già pagata o in stato confermato richiede autorizzazione direzionale (rischio cliente già notificato).',                                'Prenotazione (edit)',                 true, 120),

    -- Lavaggio / Meccanica
    ('prenotazione_lavaggio_conferma','Conferma Prenotazione Lavaggio',           'Le prenotazioni di lavaggio entrano direttamente in stato confirmed: la conferma esplicita richiede autorizzazione per evitare conferme involontarie.', 'Prime Wash (Salva)',                  true, 130),
    ('paid_wash_modify',             'Modifica Lavaggio Pagato/Confermato',       'Modificare una prenotazione lavaggio già pagata o confermata richiede autorizzazione direzionale.',                                                            'Prime Wash (edit)',                   true, 140),
    ('foreign_plate_carwash',        'Targa Estera per Lavaggio',                 'Targa non italiana inserita per un lavaggio: la categoria veicolo va selezionata manualmente, serve autorizzazione.',                                            'Prime Wash (creazione)',              true, 150),

    -- Noleggio (conferma esplicita)
    ('prenotazione_noleggio_conferma','Conferma Prenotazione Noleggio',           'Conferma esplicita di una prenotazione di noleggio (uscita dallo stato pending). Richiede autorizzazione direzionale.',                                          'Prenotazione (conferma)',             true, 160),

    -- Fornitori
    ('fornitore_admin_action',       'Azione Admin su Fornitore',                 'Azioni amministrative di scrittura sui fornitori (delete, modifiche critiche). Richiedono autorizzazione direzionale.',                                            'Tab Fornitori',                       true, 170),
    ('fornitore_doc_no_file',        'Documento Fornitore senza File',            'Salvataggio di un documento fornitore senza file allegato: anomalia che richiede autorizzazione esplicita.',                                                    'Tab Fornitori (upload bolla)',        true, 180),

    -- Gestione OTP self-management (i gate del tab stesso)
    ('gestione_otp_access',          'Accesso al tab Gestione OTP',               'Aprire la sezione Gestione OTP richiede autorizzazione direzionale per gli operatori non-direzione.',                                                            'Tab Gestione OTP',                    true, 190),
    ('gestione_otp_write',           'Modifica regola OTP',                       'Salvare modifiche a label/used_in/reason di una regola OTP esistente.',                                                                                          'Tab Gestione OTP',                    true, 200),
    ('gestione_otp_toggle',          'Attiva/Disattiva regola OTP',               'Cambiare lo stato is_required (on/off) di un gate OTP. Disattivare significa permettere all`azione di passare senza OTP.',                                       'Tab Gestione OTP',                    true, 210),
    ('gestione_otp_create',          'Crea nuova regola OTP',                     'Aggiungere un nuovo codice limitation alla tabella. Va abbinato a una chiamata requestOverride lato frontend per essere effettivo.',                              'Tab Gestione OTP',                    true, 220),
    ('gestione_otp_delete',          'Elimina regola OTP',                        'Rimuovere definitivamente una riga da system_otp_overrides. Operazione irreversibile, richiede autorizzazione.',                                                'Tab Gestione OTP',                    true, 230)
ON CONFLICT (id) DO NOTHING;
