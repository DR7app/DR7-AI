import { useEffect, useState } from 'react'
import { supabase } from '../../../supabaseClient'

interface ClientCardInfoModalProps {
    customerId: string | null
    customerEmail?: string | null
    customerPhone?: string | null
    onClose: () => void
}

interface CustomerCardData {
    full_name: string
    email: string | null
    phone: string | null
    nexi_contract_id?: string
    nexi_card_masked_pan?: string
    nexi_card_circuit?: string
    nexi_card_brand?: string
    nexi_card_type?: string
    nexi_contract_updated?: string
}

function buildFullName(c: Record<string, unknown>): string {
    const tipo = c.tipo_cliente as string | undefined
    if (tipo === 'azienda') {
        return (c.denominazione as string) || (c.ragione_sociale as string) || 'N/A'
    }
    if (tipo === 'pubblica_amministrazione') {
        return (c.ente_ufficio as string) || 'N/A'
    }
    const nome = (c.nome as string) || ''
    const cognome = (c.cognome as string) || ''
    const combined = `${nome} ${cognome}`.trim()
    return combined || (c.ragione_sociale as string) || 'N/A'
}

export default function ClientCardInfoModal({ customerId, customerEmail, customerPhone, onClose }: ClientCardInfoModalProps) {
    const [loading, setLoading] = useState(false)
    const [data, setData] = useState<CustomerCardData | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!customerId) return
        let cancelled = false
        setLoading(true)
        setError(null)
        setData(null)

        const SELECT = 'nome, cognome, ragione_sociale, denominazione, ente_ufficio, tipo_cliente, email, telefono, metadata'

        // Il customerId che arriva può essere:
        //  - customers_extended.id (record creato dall'admin)
        //  - auth.users.user_id (cliente registrato via sito) → la riga
        //    customers_extended esiste ma con id diverso e user_id uguale
        //  - un id legacy della tabella customers (nessun match diretto)
        // Strategia: id, poi user_id, poi email, poi telefono.
        async function lookup() {
            const tryQuery = async (column: 'id' | 'user_id' | 'email' | 'telefono', value: string) => {
                const { data: row, error: err } = await supabase
                    .from('customers_extended')
                    .select(SELECT)
                    .eq(column, value)
                    .order('updated_at', { ascending: false })
                    .limit(1)
                    .maybeSingle()
                if (err) throw err
                return row
            }

            try {
                let row = await tryQuery('id', customerId!)
                if (!row) row = await tryQuery('user_id', customerId!)
                if (!row && customerEmail) row = await tryQuery('email', customerEmail)
                if (!row && customerPhone) row = await tryQuery('telefono', customerPhone)
                return row
            } catch (e: unknown) {
                throw e instanceof Error ? e : new Error(String(e))
            }
        }

        // Fallback: se customers_extended.metadata non ha la tokenizzazione,
        // controlla nexi_transactions per una transazione completata con
        // contract_id collegata alla stessa email del cliente. Capita per i
        // clienti pagati prima che il backfill scrivesse i campi
        // nexi_card_* dentro customers_extended.metadata (vedi NexiTab,
        // pulsante "Recupera carte mancanti").
        async function fetchNexiTxByEmail(email: string) {
            const { data: tx, error: err } = await supabase
                .from('nexi_transactions')
                .select('contract_id, status, metadata')
                .eq('customer_email', email)
                .eq('status', 'completed')
                .not('contract_id', 'is', null)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle()
            if (err) return null
            return tx
        }

        lookup()
            .then(async (row) => {
                if (cancelled) return
                if (!row) {
                    setError('Cliente non trovato in customers_extended')
                    setLoading(false)
                    return
                }
                const m = (row.metadata || {}) as Record<string, unknown>
                let contractId = m.nexi_contract_id as string | undefined
                let maskedPan = m.nexi_card_masked_pan as string | undefined
                let circuit = m.nexi_card_circuit as string | undefined
                let brand = m.nexi_card_brand as string | undefined
                let cardType = m.nexi_card_type as string | undefined
                let updated = m.nexi_contract_updated as string | undefined

                if (!contractId && row.email) {
                    const tx = await fetchNexiTxByEmail(row.email)
                    if (cancelled) return
                    if (tx?.contract_id) {
                        contractId = tx.contract_id
                        const txMeta = (tx.metadata || {}) as Record<string, unknown>
                        maskedPan = maskedPan || (txMeta.card_masked_pan as string | undefined) || (txMeta.nexi_card_masked_pan as string | undefined)
                        circuit = circuit || (txMeta.card_circuit as string | undefined) || (txMeta.nexi_card_circuit as string | undefined)
                        brand = brand || (txMeta.card_brand as string | undefined) || (txMeta.nexi_card_brand as string | undefined)
                        cardType = cardType || (txMeta.card_type as string | undefined) || (txMeta.nexi_card_type as string | undefined)
                    }
                }

                setData({
                    full_name: buildFullName(row as Record<string, unknown>),
                    email: row.email || null,
                    phone: row.telefono || null,
                    nexi_contract_id: contractId,
                    nexi_card_masked_pan: maskedPan,
                    nexi_card_circuit: circuit,
                    nexi_card_brand: brand,
                    nexi_card_type: cardType,
                    nexi_contract_updated: updated,
                })
                setLoading(false)
            })
            .catch((err: Error) => {
                if (cancelled) return
                setError(err.message)
                setLoading(false)
            })

        return () => {
            cancelled = true
        }
    }, [customerId, customerEmail, customerPhone])

    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [onClose])

    if (!customerId) return null

    // Tokenizzata = contract id presente. Il masked PAN può mancare per le
    // tokenizzazioni più vecchie (l'operation details fetch non è sempre
    // riuscito a popolarlo) — è una decorazione, non il segnale principale.
    // NexiTab, CustomersTab, CauzioniTab e ReportClienteModal usano la stessa
    // regola: basta nexi_contract_id per considerare la carta su file.
    const isTokenized = !!data?.nexi_contract_id
    const circuitLabel = data?.nexi_card_circuit || data?.nexi_card_brand || ''

    return (
        <div className="fixed inset-0 bg-theme-bg-primary bg-opacity-75 flex items-end sm:items-center justify-center z-[60] p-0 sm:p-4">
            <div className="bg-theme-bg-primary w-full sm:max-w-md rounded-t-lg sm:rounded-lg shadow-xl flex flex-col max-h-full sm:max-h-[90vh]">
                <div className="bg-theme-bg-primaryer p-4 border-b border-theme-border flex justify-between items-center rounded-t-lg flex-shrink-0">
                    <h3 className="text-lg font-bold text-dr7-gold">Cliente selezionato</h3>
                    <button
                        onClick={onClose}
                        className="text-theme-text-muted hover:text-theme-text-primary text-2xl leading-none min-h-[44px] min-w-[44px] flex items-center justify-center"
                        aria-label="Chiudi"
                    >
                        ×
                    </button>
                </div>

                <div className="p-4 sm:p-6 flex-1 overflow-y-auto">
                    {loading && (
                        <div className="text-theme-text-muted text-sm">Caricamento...</div>
                    )}

                    {error && (
                        <div className="text-red-400 text-sm">Errore: {error}</div>
                    )}

                    {data && (
                        <div className="space-y-4">
                            <div>
                                <div className="text-theme-text-primary font-semibold text-base">{data.full_name}</div>
                                <div className="text-xs text-theme-text-muted mt-1 space-y-0.5">
                                    {data.email && <div>{data.email}</div>}
                                    {data.phone && <div>{data.phone}</div>}
                                </div>
                            </div>

                            <div className="border-t border-theme-border pt-4">
                                <div className="text-xs uppercase tracking-wide text-theme-text-muted mb-2">
                                    Carta su file
                                </div>

                                {isTokenized ? (
                                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
                                        <div className="flex items-center gap-2 flex-wrap mb-2">
                                            <span className="px-2 py-0.5 rounded text-[10px] font-bold border bg-emerald-500/15 text-emerald-400 border-emerald-500/40 uppercase">
                                                Tokenizzata
                                            </span>
                                            {circuitLabel && (
                                                <span className="px-2 py-0.5 rounded text-[10px] font-bold border bg-dr7-gold/10 text-dr7-gold border-dr7-gold/30 uppercase">
                                                    {circuitLabel}
                                                </span>
                                            )}
                                            {data.nexi_card_type && (
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border uppercase ${
                                                    data.nexi_card_type === 'credit' ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30' :
                                                    data.nexi_card_type === 'debit' ? 'bg-blue-500/15 text-blue-400 border-blue-500/30' :
                                                    data.nexi_card_type === 'prepaid' ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' :
                                                    'bg-theme-bg-tertiary text-theme-text-muted border-theme-border'
                                                }`}>
                                                    {data.nexi_card_type}
                                                </span>
                                            )}
                                        </div>
                                        <div className="font-mono text-lg text-theme-text-primary">
                                            {data.nexi_card_masked_pan || '•••• •••• •••• ••••'}
                                        </div>
                                        {data.nexi_contract_updated && (
                                            <div className="text-xs text-theme-text-muted mt-2">
                                                Aggiornata: {new Date(data.nexi_contract_updated).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="px-2 py-0.5 rounded text-[10px] font-bold border bg-amber-500/15 text-amber-400 border-amber-500/40 uppercase">
                                                Non tokenizzata
                                            </span>
                                        </div>
                                        <div className="text-sm text-theme-text-muted">
                                            Nessuna carta salvata per questo cliente.
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-theme-border flex justify-end rounded-b-lg flex-shrink-0">
                    <button
                        onClick={onClose}
                        className="px-4 py-3 sm:py-2 min-h-[44px] bg-dr7-gold hover:bg-[#0A8FA3] text-theme-text-primary rounded-full transition-colors"
                    >
                        Continua
                    </button>
                </div>
            </div>
        </div>
    )
}
