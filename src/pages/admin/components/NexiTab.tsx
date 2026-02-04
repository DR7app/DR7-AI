import { useState, useEffect } from 'react'
import { formatRomeDate } from '../../../utils/timezoneUtils'
import { formatEUR } from '../../../utils/moneyUtils'

interface NexiTransaction {
    id: string
    created_at: string
    order_id: string
    amount_cents: number
    status: 'pending' | 'completed' | 'failed' | 'cancelled'
    description: string
    customer_email: string
    booking?: {
        id: string
        vehicle_name: string
        customer_name: string
    }
}

export default function NexiTab() {
    const [transactions, setTransactions] = useState<NexiTransaction[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    useEffect(() => {
        fetchTransactions()
    }, [])

    async function fetchTransactions() {
        try {
            setLoading(true)
            // Call our Netlify function
            const response = await fetch('/.netlify/functions/nexi-list-orders')
            const data = await response.json()

            if (!response.ok) throw new Error(data.error || 'Failed to fetch messages')

            setTransactions(data.transactions || [])
        } catch (err: any) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    function getStatusBadge(status: string) {
        const styles = {
            completed: 'bg-green-900/50 text-green-300 border-green-700/50',
            pending: 'bg-yellow-900/50 text-yellow-300 border-yellow-700/50',
            failed: 'bg-red-900/50 text-red-300 border-red-700/50',
            cancelled: 'bg-theme-bg-tertiary/50 text-theme-text-secondary border-theme-border/50'
        }
        const style = styles[status as keyof typeof styles] || styles.pending

        return (
            <span className={`px-2 py-1 rounded text-xs font-bold border ${style} uppercase tracking-wider`}>
                {status}
            </span>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-theme-text-primary">Transazioni Nexi</h2>
                <button
                    onClick={fetchTransactions}
                    className="p-2 hover:bg-theme-text-primary/5 rounded-full transition-colors"
                    title="Aggiorna"
                >
                    <svg className="w-5 h-5 text-theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                </button>
            </div>

            {error && (
                <div className="bg-red-900/50 border border-red-700 text-red-200 p-4 rounded-lg">
                    {error}
                </div>
            )}

            {loading ? (
                <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-dr7-gold mx-auto mb-4"></div>
                    <p className="text-theme-text-muted">Caricamento transazioni...</p>
                </div>
            ) : transactions.length === 0 ? (
                <div className="text-center py-12 bg-theme-text-primary/5 rounded-xl border border-theme-border/50">
                    <p className="text-theme-text-muted">Nessuna transazione trovata</p>
                </div>
            ) : (
                <div className="bg-theme-text-primary/5 rounded-xl border border-theme-border/50 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-theme-bg-primary/20 text-xs uppercase text-theme-text-muted font-medium">
                                <tr>
                                    <th className="px-6 py-4">Data</th>
                                    <th className="px-6 py-4">Order ID</th>
                                    <th className="px-6 py-4">Descrizione</th>
                                    <th className="px-6 py-4">Importo</th>
                                    <th className="px-6 py-4">Stato</th>
                                    <th className="px-6 py-4">Cliente</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {transactions.map((tx) => (
                                    <tr key={tx.id} className="hover:bg-theme-text-primary/5 transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="text-theme-text-primary font-mono text-sm">
                                                {formatRomeDate(new Date(tx.created_at), { dateStyle: 'short', timeStyle: 'short' })}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm font-mono text-dr7-gold">{tx.order_id}</div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm text-theme-text-secondary">{tx.description}</div>
                                            {tx.booking && (
                                                <div className="text-xs text-theme-text-muted mt-1">
                                                    Ref: {tx.booking.vehicle_name}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-theme-text-primary font-mono font-bold">
                                                {formatEUR(tx.amount_cents || 0)}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            {getStatusBadge(tx.status)}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm text-theme-text-primary">
                                                {tx.booking?.customer_name || 'N/A'}
                                            </div>
                                            <div className="text-xs text-theme-text-muted">{tx.customer_email}</div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    )
}
