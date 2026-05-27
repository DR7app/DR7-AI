import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import Button from './Button'
import DiscountCodeGeneratorModal from './DiscountCodeGeneratorModal'
import { QRCodeSVG } from 'qrcode.react'
import toast from 'react-hot-toast'

interface DiscountCode {
    id: string
    code: string
    code_type: 'codice_sconto' | 'gift_card'
    scope: string[]
    value_type: 'fixed' | 'percentage'
    value_amount: number
    minimum_spend: number | null
    valid_from: string
    valid_until: string
    single_use: boolean
    message: string | null
    usage_conditions: string | null
    qr_url: string | null
    status: 'active' | 'deactivated' | 'expired'
    created_at: string
    updated_at: string
    usage_count?: number
    usage_total?: number
    last_used_at?: string | null
}

type DiscountCodeFilter = 'all' | 'active' | 'deactivated' | 'expired'

export default function CodiciScontoTab() {
    const [discountCodes, setDiscountCodes] = useState<DiscountCode[]>([])
    const [discountCodesLoading, setDiscountCodesLoading] = useState(false)
    const [showDiscountCodeModal, setShowDiscountCodeModal] = useState(false)
    const [discountCodeFilter, setDiscountCodeFilter] = useState<DiscountCodeFilter>('all')
    const [discountCodeSearch, setDiscountCodeSearch] = useState('')
    const [selectedCodeForQR, setSelectedCodeForQR] = useState<DiscountCode | null>(null)
    const [editingCode, setEditingCode] = useState<DiscountCode | null>(null)

    useEffect(() => {
        loadDiscountCodes()
    }, [])

    async function loadDiscountCodes() {
        setDiscountCodesLoading(true)
        try {
            const { data: codes, error } = await supabase
                .from('discount_codes')
                .select('*')
                .order('created_at', { ascending: false })

            if (error) throw error

            if (!codes) {
                setDiscountCodes([])
                return
            }

            const now = new Date()
            const expiredIds: string[] = []

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const processedCodes = codes.map((code: any) => {
                if (code.status === 'active' && new Date(code.valid_until) < now) {
                    expiredIds.push(code.id)
                    return { ...code, status: 'expired' }
                }
                return code
            })

            if (expiredIds.length > 0) {
                supabase
                    .from('discount_codes')
                    .update({ status: 'expired', updated_at: new Date().toISOString() })
                    .in('id', expiredIds)
                    .then(({ error: updateError }) => {
                        if (updateError) console.error('Error auto-expiring codes:', updateError)
                    })
            }

            const { data: usageData, error: usageError } = await supabase
                .from('discount_code_usages')
                .select('discount_code_id, discount_applied, used_at')

            if (usageError && usageError.code !== '42P01') {
                console.error('Error loading usage stats:', usageError)
            }

            const usageMap = new Map<string, { count: number; total: number; lastUsed: string | null }>()
            if (usageData) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                usageData.forEach((u: any) => {
                    const existing = usageMap.get(u.discount_code_id) || { count: 0, total: 0, lastUsed: null }
                    existing.count += 1
                    existing.total += Number(u.discount_applied) || 0
                    if (!existing.lastUsed || new Date(u.used_at) > new Date(existing.lastUsed)) {
                        existing.lastUsed = u.used_at
                    }
                    usageMap.set(u.discount_code_id, existing)
                })
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const codesWithUsage: DiscountCode[] = processedCodes.map((code: any) => {
                const usage = usageMap.get(code.id)
                return {
                    ...code,
                    usage_count: usage?.count || 0,
                    usage_total: usage?.total || 0,
                    last_used_at: usage?.lastUsed || null,
                }
            })

            setDiscountCodes(codesWithUsage)
        } catch (error) {
            console.error('Error loading discount codes:', error)
        } finally {
            setDiscountCodesLoading(false)
        }
    }

    async function toggleCodeStatus(id: string, currentStatus: string) {
        if (currentStatus === 'expired') {
            toast.error('Un codice scaduto non può essere riattivato.')
            return
        }

        const newStatus = currentStatus === 'active' ? 'deactivated' : 'active'

        try {
            const { error } = await supabase
                .from('discount_codes')
                .update({ status: newStatus, updated_at: new Date().toISOString() })
                .eq('id', id)

            if (error) throw error

            setDiscountCodes(prev => prev.map(c =>
                c.id === id ? { ...c, status: newStatus as DiscountCode['status'] } : c
            ))
        } catch (error: unknown) {
          const _errMsg = error instanceof Error ? error.message : String(error)
            console.error('Error toggling code status:', error)
            toast.error(`Errore: ${_errMsg}`)
        }
    }

    function copyCode(code: string) {
        navigator.clipboard.writeText(code).then(() => {
            toast.success('Codice copiato!')
        }).catch(() => {
            const el = document.createElement('textarea')
            el.value = code
            document.body.appendChild(el)
            el.select()
            document.execCommand('copy')
            document.body.removeChild(el)
            toast.success('Codice copiato!')
        })
    }

    function formatScopeBadges(scope: string[]) {
        const labels: Record<string, string> = {
            noleggio: 'Noleggio',
            lavaggi: 'Lavaggi',
            supercar: 'Supercar',
            utilitarie: 'Utilitarie',
            tutti_i_servizi: 'Tutti',
        }
        return scope.map(s => labels[s] || s)
    }

    function statusBadge(status: string) {
        const config: Record<string, { bg: string; text: string; label: string }> = {
            active: { bg: 'bg-green-600/20', text: 'text-green-400', label: 'Attivo' },
            deactivated: { bg: 'bg-gray-600/20', text: 'text-gray-400', label: 'Disattivato' },
            expired: { bg: 'bg-red-600/20', text: 'text-red-400', label: 'Scaduto' },
        }
        const c = config[status] || config.expired
        return (
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>
                {c.label}
            </span>
        )
    }

    const filteredDiscountCodes = discountCodes.filter(code => {
        if (discountCodeFilter !== 'all' && code.status !== discountCodeFilter) return false
        if (discountCodeSearch) {
            const q = discountCodeSearch.toLowerCase()
            return (
                code.code.toLowerCase().includes(q) ||
                code.message?.toLowerCase().includes(q) ||
                code.code_type.toLowerCase().includes(q)
            )
        }
        return true
    })

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h3 className="text-lg font-bold text-theme-text-primary">Codici Sconto & Gift Card</h3>
                    <p className="text-theme-text-muted text-sm">Genera, gestisci e traccia codici sconto e gift card</p>
                </div>
                <Button onClick={() => { setEditingCode(null); setShowDiscountCodeModal(true) }}>
                    Genera Codice
                </Button>
            </div>

            {/* Filter bar */}
            <div className="flex flex-wrap gap-3 items-center">
                <div className="flex gap-2">
                    {([
                        { key: 'all' as DiscountCodeFilter, label: 'Tutti' },
                        { key: 'active' as DiscountCodeFilter, label: 'Attivi' },
                        { key: 'deactivated' as DiscountCodeFilter, label: 'Disattivati' },
                        { key: 'expired' as DiscountCodeFilter, label: 'Scaduti' },
                    ]).map(f => (
                        <button
                            key={f.key}
                            onClick={() => setDiscountCodeFilter(f.key)}
                            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                                discountCodeFilter === f.key
                                    ? 'bg-dr7-gold text-white'
                                    : 'bg-theme-bg-tertiary text-theme-text-primary hover:bg-theme-bg-hover'
                            }`}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
                <div className="flex-1 min-w-[200px]">
                    <div className="bg-theme-bg-tertiary p-3 rounded-full border border-theme-border">
                        <input
                            type="text"
                            placeholder="Cerca codice..."
                            value={discountCodeSearch}
                            onChange={(e) => setDiscountCodeSearch(e.target.value)}
                            className="w-full bg-transparent text-theme-text-primary outline-none"
                        />
                    </div>
                </div>
            </div>

            {/* Codes Table */}
            {discountCodesLoading ? (
                <div className="text-center py-10 text-dr7-gold">Caricamento codici...</div>
            ) : (
                <div className="bg-theme-bg-tertiary rounded-lg overflow-hidden border border-theme-border">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-theme-text-muted">
                            <thead className="bg-theme-bg-secondary/50 text-theme-text-secondary uppercase font-medium">
                                <tr>
                                    <th className="p-4">Codice</th>
                                    <th className="p-4">Tipo</th>
                                    <th className="p-4">Valore</th>
                                    <th className="p-4">Ambito</th>
                                    <th className="p-4">Validità</th>
                                    <th className="p-4">Stato</th>
                                    <th className="p-4">Utilizzi</th>
                                    <th className="p-4 text-right">Azioni</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-theme-border">
                                {filteredDiscountCodes.map((code) => (
                                    <tr key={code.id} className="hover:bg-theme-bg-hover/50 transition-colors">
                                        <td className="p-4">
                                            <span className="font-mono font-bold text-theme-text-primary tracking-wider">
                                                {code.code}
                                            </span>
                                        </td>
                                        <td className="p-4">
                                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                                code.code_type === 'gift_card'
                                                    ? 'bg-purple-600/20 text-purple-400'
                                                    : 'bg-blue-600/20 text-blue-400'
                                            }`}>
                                                {code.code_type === 'gift_card' ? 'Gift Card' : 'Sconto'}
                                            </span>
                                        </td>
                                        <td className="p-4 text-theme-text-primary font-medium">
                                            {code.value_type === 'percentage'
                                                ? `${code.value_amount}%`
                                                : `${code.value_amount.toFixed(2)} €`
                                            }
                                        </td>
                                        <td className="p-4">
                                            <div className="flex flex-wrap gap-1">
                                                {formatScopeBadges(code.scope).map((label, i) => (
                                                    <span key={i} className="px-2 py-0.5 rounded-full text-xs bg-theme-bg-secondary text-theme-text-secondary">
                                                        {label}
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="p-4 text-xs">
                                            <div>{new Date(code.valid_from).toLocaleDateString('it-IT')}</div>
                                            <div className="text-theme-text-muted">{new Date(code.valid_until).toLocaleDateString('it-IT')}</div>
                                        </td>
                                        <td className="p-4">
                                            {statusBadge(code.status)}
                                        </td>
                                        <td className="p-4 text-center">
                                            <span className="text-theme-text-primary font-medium">{code.usage_count || 0}</span>
                                            {code.usage_total ? (
                                                <div className="text-xs text-theme-text-muted">{code.usage_total.toFixed(2)} €</div>
                                            ) : null}
                                        </td>
                                        <td className="p-4">
                                            <div className="flex gap-2 justify-end">
                                                <button
                                                    onClick={() => toggleCodeStatus(code.id, code.status)}
                                                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                                                        code.status === 'active'
                                                            ? 'bg-gray-600 text-white hover:bg-gray-500'
                                                            : code.status === 'deactivated'
                                                            ? 'bg-green-600/80 text-white hover:bg-green-600'
                                                            : 'bg-theme-bg-hover text-theme-text-muted cursor-not-allowed'
                                                    }`}
                                                    title={
                                                        code.status === 'active' ? 'Disattiva' :
                                                        code.status === 'deactivated' ? 'Riattiva' :
                                                        'Non riattivabile'
                                                    }
                                                >
                                                    {code.status === 'active' ? 'Disattiva' :
                                                     code.status === 'deactivated' ? 'Riattiva' :
                                                     'Scaduto'}
                                                </button>
                                                <button
                                                    onClick={() => setSelectedCodeForQR(code)}
                                                    className="px-3 py-1 rounded-full text-xs font-medium bg-dr7-gold/20 text-dr7-gold hover:bg-dr7-gold/30 transition-colors"
                                                >
                                                    QR
                                                </button>
                                                <button
                                                    onClick={() => copyCode(code.code)}
                                                    className="px-3 py-1 rounded-full text-xs font-medium bg-theme-bg-secondary text-theme-text-secondary hover:bg-theme-bg-hover transition-colors"
                                                >
                                                    Copia
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {filteredDiscountCodes.length === 0 && (
                                    <tr>
                                        <td colSpan={8} className="p-8 text-center text-theme-text-muted">
                                            {discountCodes.length === 0
                                                ? 'Nessun codice sconto creato. Clicca "Genera Codice" per iniziare.'
                                                : 'Nessun codice trovato con i filtri selezionati.'
                                            }
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {showDiscountCodeModal && (
                <DiscountCodeGeneratorModal
                    editingCode={editingCode}
                    onClose={() => { setShowDiscountCodeModal(false); setEditingCode(null) }}
                    onSave={() => { setShowDiscountCodeModal(false); setEditingCode(null); loadDiscountCodes() }}
                />
            )}

            {selectedCodeForQR && (
                <div className="fixed inset-0 bg-theme-overlay flex items-center justify-center z-50 p-4" onClick={() => setSelectedCodeForQR(null)}>
                    <div className="bg-theme-bg-secondary rounded-3xl shadow-xl max-w-md w-full p-8" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold text-theme-text-primary">QR Code</h3>
                            <button
                                onClick={() => setSelectedCodeForQR(null)}
                                className="text-theme-text-muted hover:text-theme-text-primary text-3xl leading-none"
                            >
                                ×
                            </button>
                        </div>

                        <div id="qr-print-area" className="flex flex-col items-center gap-4">
                            <div className="bg-white p-4 rounded-xl">
                                <QRCodeSVG
                                    value={`https://dr7empire.com/promo/${selectedCodeForQR.code}`}
                                    size={200}
                                />
                            </div>
                            <div className="text-center">
                                <p className="font-mono text-lg font-bold text-dr7-gold tracking-wider">
                                    {selectedCodeForQR.code}
                                </p>
                                <p className="text-sm text-theme-text-secondary mt-1">
                                    {selectedCodeForQR.value_type === 'percentage'
                                        ? `${selectedCodeForQR.value_amount}% di sconto`
                                        : `${selectedCodeForQR.value_amount.toFixed(2)} € di sconto`
                                    }
                                </p>
                                {selectedCodeForQR.message && (
                                    <p className="text-sm text-theme-text-muted mt-2 italic">
                                        {selectedCodeForQR.message}
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="flex gap-3 justify-center mt-6">
                            <button
                                onClick={() => window.print()}
                                className="px-6 py-2 bg-dr7-gold text-white font-semibold rounded-full hover:bg-[#247a6f] transition-colors"
                            >
                                Stampa
                            </button>
                            <button
                                onClick={() => copyCode(selectedCodeForQR.code)}
                                className="px-6 py-2 bg-gray-600 text-white rounded-full hover:bg-gray-700 transition-colors"
                            >
                                Copia Codice
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
