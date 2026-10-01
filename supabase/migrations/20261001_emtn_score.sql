-- 01/10/2026 (direzione) — EMTN Score: storico dei ricalcoli e interventi manuali.
--
-- Lo score (src/utils/emtnScore/motore.ts) e' calcolato dal codice a ogni
-- consultazione. Ogni volta che cambia (score, confidence, livello, flag o
-- versione dell'algoritmo) si salva una riga in emtn_score_storico: score
-- precedente e nuovo, causa, fattori, versione, confidence, override.
--
-- emtn_score_override: solo la direzione. Motivo obbligatorio, mai
-- cancellato: si revoca (attivo = false) e resta la traccia.
--
-- Come tutto EMTN: RLS attiva e nessuna policy, si legge e si scrive solo
-- dalle Netlify Functions con la service role.
--
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.emtn_score_storico (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           uuid NOT NULL REFERENCES public.emtn_clients(id) ON DELETE CASCADE,
    score_precedente    integer,
    score               integer NOT NULL CHECK (score BETWEEN 0 AND 100),
    score_calcolato     integer NOT NULL CHECK (score_calcolato BETWEEN 0 AND 100),
    confidence          integer NOT NULL CHECK (confidence BETWEEN 0 AND 100),
    livello             text NOT NULL,
    trend               text NOT NULL,
    flag                jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- positivi, rischi, spiegazione, dettaglio del calcolo
    fattori             jsonb NOT NULL DEFAULT '{}'::jsonb,
    causa               text NOT NULL,
    versione            text NOT NULL,
    override_id         uuid,
    operatore_email     text,
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS emtn_score_storico_client_idx ON public.emtn_score_storico (client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.emtn_score_override (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           uuid NOT NULL REFERENCES public.emtn_clients(id) ON DELETE CASCADE,
    tipo                text NOT NULL CHECK (tipo IN ('limite_massimo', 'score_fisso', 'flag_critico')),
    valore              integer CHECK (valore IS NULL OR valore BETWEEN 0 AND 100),
    motivo              text NOT NULL CHECK (char_length(btrim(motivo)) >= 10),
    operatore_id        uuid,
    operatore_email     text,
    attivo              boolean NOT NULL DEFAULT true,
    scade_il            timestamptz,
    revocato_il         timestamptz,
    revocato_da         text,
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS emtn_score_override_client_idx ON public.emtn_score_override (client_id) WHERE attivo;

ALTER TABLE public.emtn_score_storico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emtn_score_override ENABLE ROW LEVEL SECURITY;
