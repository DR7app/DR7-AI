-- Estende il CHECK constraint su fornitore_documents.tipo per supportare
-- 'proforma' e 'preventivo' come nuovi tipi caricabili dal modal "Carica
-- documento" del dettaglio fornitore.
--
-- Workflow: ereditano dalla branch non-fattura di nextStates() (caricato →
-- verificato/anomalia → archiviato), quindi nessuna modifica TypeScript ai
-- transition rules.

ALTER TABLE public.fornitore_documents
    DROP CONSTRAINT IF EXISTS fornitore_documents_tipo_check;

ALTER TABLE public.fornitore_documents
    ADD CONSTRAINT fornitore_documents_tipo_check
    CHECK (tipo IN (
        'ddt',
        'bolla',
        'fattura',
        'nota_credito',
        'ricevuta_pagamento',
        'proforma',
        'preventivo'
    ));
