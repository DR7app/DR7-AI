import { useEffect, useState } from 'react'
import { supabase } from '../../../supabaseClient'

interface ClientCardInfoModalProps {
    customerId: string | null
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

export default function ClientCardInfoModal({ customerId, onClose }: ClientCardInfoModalProps) {
    const [loading, setLoading] = useState(false)
    const [data, setData] = useState<CustomerCardData | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!customerId) return
        let cancelled = false
        setLoading(true)
        setError(null)
        setData(null)

        supabase
            .from('customers_extended')
            .select('nome, cognome, ragione_sociale, denominazione, ente_ufficio, tipo_cliente, email, telefono, metadata')
            .eq('id', customerId)
            .maybeSingle()
            .then(({ data: row, error: err }) => {
                if (cancelled) return
                if (err) {
                    setError(err.message)
                    setLoading(false)
                    return
                }
                if (!row) {
                    setError('Cliente non trovato')
                    setLoading(false)
                    return
                }
                const m = (row.metadata || {}) as Record<string, unknown>
                setData({
                    full_name: buildFullName(row as Record<string, unknown>),
                    email: row.email || null,
                    phone: row.telefono || null,
                    nexi_contract_id: m.nexi_contract_id as string | undefined,
                    nexi_card_masked_pan: m.nexi_card_masked_pan as string | undefined,
                    nexi_card_circuit: m.nexi_card_circuit as string | undefined,
                    nexi_card_brand: m.nexi_card_brand as string | undefined,
                    nexi_card_type: m.nexi_card_type as string | undefined,
                    nexi_contract_updated: m.nexi_contract_updated as string | undefined,
                })
                setLoading(false)
            })

        return () => {
            cancelled = true
        }
    }, [customerId])

    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [onClose])

    if (!customerId) return null

    const isTokenized = !!(data?.nexi_contract_id && data?.nexi_card_masked_pan)
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
                                            {data.nexi_card_masked_pan}
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
