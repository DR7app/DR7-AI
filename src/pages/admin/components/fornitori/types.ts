export type DocumentTipo = 'ddt' | 'bolla' | 'fattura' | 'nota_credito' | 'ricevuta_pagamento' | 'proforma' | 'preventivo'

export type DocumentStato =
    | 'caricato'
    | 'verificato'
    | 'anomalia'
    | 'in_verifica'
    | 'approvato'
    | 'pagabile'
    | 'bloccato'
    | 'pagato'
    | 'archiviato'

export type AlertTipo =
    | 'scadenza_imminente'
    | 'scadenza_oggi'
    | 'scaduta'
    | 'anomalia_importi'
    | 'bolle_mancanti'
    | 'duplicato'

export interface Fornitore {
    id: string
    nome: string
    piva: string | null
    referente: string | null
    telefono: string | null
    email: string | null
    iban: string | null
    categoria_merce: string | null
    condizioni_pagamento: string | null
    scadenza_default_giorni: number
    indirizzo: string | null
    citta: string | null
    cap: string | null
    provincia: string | null
    note: string | null
    attivo: boolean
    created_at: string
    updated_at: string
}

export interface FornitoreDocument {
    id: string
    fornitore_id: string
    tipo: DocumentTipo
    numero_documento: string
    data_documento: string
    data_scadenza: string | null
    periodo_anno: number
    periodo_mese: number
    importo_imponibile: number | null
    importo_iva: number | null
    importo_totale: number
    fattura_collegata_id: string | null
    file_url: string | null
    file_name: string | null
    file_hash: string | null
    aruba_filename?: string | null
    stato: DocumentStato
    metodo_pagamento: string | null
    data_pagamento: string | null
    note: string | null
    created_at: string
    updated_at: string
}

export interface FornitoreAlert {
    id: string
    fornitore_id: string
    document_id: string | null
    tipo: AlertTipo
    severity: 'info' | 'warning' | 'error'
    messaggio: string
    status: 'open' | 'acknowledged' | 'resolved'
    metadata: Record<string, unknown>
    created_at: string
    acknowledged_at: string | null
    resolved_at: string | null
}

export interface CrosscheckRow {
    fattura_id: string
    fattura_numero: string
    fattura_data: string
    fattura_totale: number
    ddt_totale: number
    differenza: number
    stato_calcolato: 'verificato' | 'anomalia'
}

export const DOCUMENT_TIPO_LABELS: Record<DocumentTipo, string> = {
    ddt: 'DDT',
    bolla: 'Bolla',
    fattura: 'Fattura',
    nota_credito: 'Nota Credito',
    ricevuta_pagamento: 'Ricevuta',
    proforma: 'Proforma',
    preventivo: 'Preventivo',
}

export const DOCUMENT_STATO_LABELS: Record<DocumentStato, string> = {
    caricato: 'Caricato',
    verificato: 'Verificato',
    anomalia: 'Anomalia',
    in_verifica: 'In verifica',
    approvato: 'Approvato',
    pagabile: 'Pagabile',
    bloccato: 'Bloccato',
    pagato: 'Pagato',
    archiviato: 'Archiviato',
}

export const DOCUMENT_STATO_COLORS: Record<DocumentStato, string> = {
    caricato: 'bg-theme-bg-tertiary text-theme-text-secondary',
    verificato: 'bg-emerald-900 text-emerald-200',
    anomalia: 'bg-orange-900 text-orange-200',
    in_verifica: 'bg-yellow-900 text-yellow-200',
    approvato: 'bg-blue-900 text-blue-200',
    pagabile: 'bg-cyan-900 text-cyan-200',
    bloccato: 'bg-red-900 text-red-200',
    pagato: 'bg-green-900 text-green-200',
    archiviato: 'bg-theme-bg-tertiary text-theme-text-muted',
}

export const ALERT_SEVERITY_COLORS: Record<'info' | 'warning' | 'error', string> = {
    info: 'bg-blue-900 text-blue-200',
    warning: 'bg-yellow-900 text-yellow-200',
    error: 'bg-red-900 text-red-200',
}

export const ALERT_TIPO_LABELS: Record<AlertTipo, string> = {
    scadenza_imminente: 'Scadenza imminente',
    scadenza_oggi: 'Scade oggi',
    scaduta: 'Scaduta',
    anomalia_importi: 'Anomalia importi',
    bolle_mancanti: 'Bolle mancanti',
    duplicato: 'Documento duplicato',
}

export const MESI_IT = [
    'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
]

/**
 * Allowed workflow transitions. Returns the next reachable states
 * from the current state.
 */
export function nextStates(current: DocumentStato, tipo: DocumentTipo): DocumentStato[] {
    // DDT/bolla/nota_credito/ricevuta have no payment workflow
    if (tipo !== 'fattura') {
        if (current === 'caricato') return ['verificato', 'anomalia', 'archiviato']
        if (current === 'verificato' || current === 'anomalia') return ['archiviato']
        return []
    }
    // Fattura full workflow
    switch (current) {
        case 'caricato':
            return ['verificato', 'anomalia', 'in_verifica']
        case 'verificato':
            return ['in_verifica', 'pagabile', 'bloccato']
        case 'anomalia':
            return ['in_verifica', 'bloccato']
        case 'in_verifica':
            return ['approvato', 'bloccato']
        case 'approvato':
            return ['pagabile', 'bloccato']
        case 'pagabile':
            return ['pagato', 'bloccato']
        case 'pagato':
            return ['archiviato']
        case 'bloccato':
            return ['in_verifica']
        case 'archiviato':
            return []
        default:
            return []
    }
}

/** SHA-256 hex digest of a File using SubtleCrypto. */
export async function hashFile(file: File): Promise<string> {
    const buf = await file.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', buf)
    return Array.from(new Uint8Array(digest))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
}

export function fmtEUR(n: number | null | undefined): string {
    if (n === null || n === undefined || isNaN(n)) return '—'
    return new Intl.NumberFormat('it-IT', {
        style: 'currency',
        currency: 'EUR',
    }).format(n)
}

export function fmtDateIT(s: string | null | undefined): string {
    if (!s) return '—'
    try {
        const d = new Date(s)
        return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
    } catch {
        return s
    }
}
