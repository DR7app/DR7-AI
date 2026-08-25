-- ============================================================
-- OTP: modifica dimensioni del Calendario Noleggio
--
-- Il Calendario Noleggio calcola larghezze colonne e altezze righe in
-- automatico. Da questa versione l'operatore puo' trascinare i bordi come
-- in Excel; il layout risultante e' salvato in `app_settings` sotto la
-- chiave `calendar_noleggio_layout` ed e' CONDIVISO fra tutti gli
-- operatori — se lo cambia uno lo vedono tutti.
--
-- Per questo la modifica passa dal gate OTP: chi non ha il bypass deve
-- farsi autorizzare dalla direzione. Disattivando la riga (is_required =
-- false) da Gestione OTP la modifica torna libera per tutti.
--
-- ON CONFLICT DO NOTHING — sicuro da rieseguire, non azzera eventuali
-- personalizzazioni gia' fatte dalla direzione.
-- ============================================================

INSERT INTO public.system_otp_overrides (id, label, reason, used_in, is_required, sort_order) VALUES
    ('calendario_noleggio_layout',
     'Modifica Dimensioni Calendario Noleggio',
     'Cambiare larghezza delle colonne o altezza delle righe del Calendario Noleggio. Il layout e'' condiviso con tutti gli operatori: una modifica sbagliata cambia la vista a tutti.',
     'Calendario Noleggio (pulsante DIMENSIONI)',
     true,
     240)
ON CONFLICT (id) DO NOTHING;

-- Verifica
SELECT id, label, is_required, sort_order
FROM public.system_otp_overrides
WHERE id = 'calendario_noleggio_layout';
