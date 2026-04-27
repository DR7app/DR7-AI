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
    customer_email: string | null
    customer_phone: string | null
    qr_url: string | null
    status: 'active' | 'deactivated' | 'expired'
    created_at: string
    updated_at: string
    usage_count?: number
    usage_total?: number
    last_used_at?: string | null
}

interface DiscountCodeUsage {
    id: string
    discount_code_id: string
    booking_id: string | null
    service_type: string | null
    discount_applied: number
    used_at: string
    notes: string | null
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
    const [detailCode, setDetailCode] = useState<DiscountCode | null>(null)
    const [detailUsages, setDetailUsages] = useState<DiscountCodeUsage[]>([])
    const [detailLoading, setDetailLoading] = useState(false)
    // Invia modal state
    const [sendModalCode, setSendModalCode] = useState<DiscountCode | null>(null)
    const [sendTarget, setSendTarget] = useState<'cliente' | 'numero'>('cliente')
    const [sendCustomers, setSendCustomers] = useState<Array<{ id: string; nome: string | null; cognome: string | null; denominazione: string | null; email: string | null; telefono: string | null }>>([])
    const [sendCustomerSearch, setSendCustomerSearch] = useState('')
    const [sendSelectedPhone, setSendSelectedPhone] = useState('')
    const [sendSelectedLabel, setSendSelectedLabel] = useState('')
    const [sendManualPhone, setSendManualPhone] = useState('')
    const [sendMessage, setSendMessage] = useState('')
    const [sending, setSending] = useState(false)

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

    async function openDetails(code: DiscountCode) {
        setDetailCode(code)
        setDetailUsages([])
        setDetailLoading(true)
        try {
            const { data, error } = await supabase
                .from('discount_code_usages')
                .select('*')
                .eq('discount_code_id', code.id)
                .order('used_at', { ascending: false })
            if (error && error.code !== '42P01') throw error
            setDetailUsages((data as DiscountCodeUsage[]) || [])
        } catch (err) {
            console.error('Error loading usages:', err)
            toast.error('Errore nel caricamento dello storico utilizzi')
        } finally {
            setDetailLoading(false)
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

    // ── Invia codice via WhatsApp ──────────────────────────────────────────
    async function openSendModal(code: DiscountCode) {
        setSendModalCode(code)
        setSendTarget('cliente')
        setSendCustomerSearch('')
        setSendSelectedPhone('')
        setSendSelectedLabel('')
        setSendManualPhone('')
        // Pre-compila un messaggio di default sensato. L'admin può modificarlo
        // prima dell'invio. Niente template Pro hardcoded — usiamo customMessage.
        const scope = (code.scope || []).join(', ') || 'tutti i servizi'
        const valido = code.valid_until ? new Date(code.valid_until).toLocaleDateString('it-IT') : ''
        const valore = code.value_type === 'percentage'
            ? `${code.value_amount}%`
            : `€${Number(code.value_amount).toFixed(2)}`
        const minSpend = code.minimum_spend ? `\nSpesa minima: €${Number(code.minimum_spend).toFixed(2)}` : ''
        setSendMessage(
            `Ciao! 🎁\n\nEcco il tuo codice sconto DR7 di ${valore} su ${scope}:\n\n*${code.code}*\n\nValido fino al ${valido}.${minSpend}\n\nLo puoi usare al check-out su www.dr7empire.com\n\nGrazie,\nDR7 Empire`
        )
        // Carica clienti se non già pronti
        if (sendCustomers.length === 0) {
            const { data } = await supabase
                .from('customers_extended')
                .select('id, nome, cognome, denominazione, email, telefono')
                .not('telefono', 'is', null)
                .order('updated_at', { ascending: false })
                .limit(1000)
            setSendCustomers(data || [])
        }
    }

    function pickSendCustomer(c: { id: string; nome: string | null; cognome: string | null; denominazione: string | null; email: string | null; telefono: string | null }) {
        const name = c.denominazione || `${c.nome || ''} ${c.cognome || ''}`.trim() || c.telefono || 'Cliente'
        setSendSelectedPhone(c.telefono || '')
        setSendSelectedLabel(`${name}${c.telefono ? ` · ${c.telefono}` : ''}`)
        setSendCustomerSearch('')
    }

    async function confirmSend() {
        if (!sendModalCode) return
        const phoneRaw = sendTarget === 'cliente' ? sendSelectedPhone : sendManualPhone
        const phone = (phoneRaw || '').trim()
        if (!phone) {
            toast.error(sendTarget === 'cliente' ? 'Seleziona un cliente con telefono' : 'Inserisci un numero di telefono')
            return
        }
        if (!sendMessage.trim()) {
            toast.error('Il messaggio non può essere vuoto')
            return
        }
        // Normalise phone — strip non-digits, default Italy +39 if no prefix
        let clean = phone.replace(/[^\d]/g, '')
        if (clean.startsWith('00')) clean = clean.slice(2)
        if (clean.startsWith('0')) clean = '39' + clean.slice(1)
        if (!clean.startsWith('39') && clean.length === 10) clean = '39' + clean
        if (clean.length < 11) {
            toast.error('Numero di telefono non valido')
            return
        }

        setSending(true)
        try {
            const res = await fetch('/.netlify/functions/send-whatsapp-notification', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customMessage: sendMessage,
                    customPhone: clean,
                }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                throw new Error(data.message || `HTTP ${res.status}`)
            }
            toast.success(`Codice ${sendModalCode.code} inviato a ${clean}`)
            setSendModalCode(null)
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            toast.error(`Invio fallito: ${msg}`)
        } finally {
            setSending(false)
        }
    }

    const filteredSendCustomers = (() => {
        const q = sendCustomerSearch.trim().toLowerCase()
        const list = sendCustomers
        if (!q) return list.slice(0, 20)
        return list
            .filter(c => {
                const name = (c.denominazione || `${c.nome || ''} ${c.cognome || ''}`).toLowerCase()
                return name.includes(q)
                    || (c.email || '').toLowerCase().includes(q)
                    || (c.telefono || '').toLowerCase().includes(q)
            })
            .slice(0, 20)
    })()

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
                code.code_type.toLowerCase().includes(q) ||
                code.customer_email?.toLowerCase().includes(q) ||
                code.customer_phone?.toLowerCase().includes(q)
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
                                    <th className="p-4">Cliente</th>
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
                                        <td className="p-4 text-xs">
                                            {code.customer_email ? (
                                                <>
                                                    <div className="text-theme-text-primary">{code.customer_email}</div>
                                                    {code.customer_phone && (
                                                        <div className="text-theme-text-muted">{code.customer_phone}</div>
                                                    )}
                                                </>
                                            ) : (
                                                <span className="text-theme-text-muted">Pubblico</span>
                                            )}
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
                                                    onClick={() => openDetails(code)}
                                                    className="px-3 py-1 rounded-full text-xs font-medium bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 transition-colors"
                                                >
                                                    Dettagli
                                                </button>
                                                <button
                                                    onClick={() => { setEditingCode(code); setShowDiscountCodeModal(true) }}
                                                    className="px-3 py-1 rounded-full text-xs font-medium bg-theme-bg-secondary text-theme-text-secondary hover:bg-theme-bg-hover transition-colors"
                                                >
                                                    Modifica
                                                </button>
                                                <button
                                                    onClick={() => toggleCodeStatus(code.id, code.status)}
                                                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                                                        code.status === 'active'
                                                            ? 'bg-gray-600 text-white hover:bg-gray-500'
                                                            : code.status === 'deactivated'
                                                            ? 'bg-green-600/80 text-white hover:bg-green-600'
                                                            : 'bg-gray-700 text-gray-500 cursor-not-allowed'
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
                                                    onClick={() => openSendModal(code)}
                                                    title="Invia codice via WhatsApp"
                                                    className="px-3 py-1 rounded-full text-xs font-medium bg-green-600/80 text-white hover:bg-green-600 transition-colors"
                                                >
                                                    Invia
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
                                        <td colSpan={9} className="p-8 text-center text-theme-text-muted">
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

            {detailCode && (
                <div className="fixed inset-0 bg-theme-overlay flex items-center justify-center z-50 p-4" onClick={() => setDetailCode(null)}>
                    <div className="bg-theme-bg-secondary rounded-3xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                        <div className="p-6 border-b border-theme-border flex justify-between items-center sticky top-0 bg-theme-bg-secondary z-10">
                            <div>
                                <h3 className="text-xl font-bold text-theme-text-primary font-mono tracking-wider">{detailCode.code}</h3>
                                <p className="text-sm text-theme-text-muted mt-1">Dettagli codice sconto</p>
                            </div>
                            <button onClick={() => setDetailCode(null)} className="text-theme-text-muted hover:text-theme-text-primary text-3xl leading-none">×</button>
                        </div>

                        <div className="p-6 space-y-6">
                            {/* Metadata grid */}
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <div className="text-xs text-theme-text-muted">Tipo</div>
                                    <div className="text-theme-text-primary font-medium">{detailCode.code_type === 'gift_card' ? 'Gift Card' : 'Codice Sconto'}</div>
                                </div>
                                <div>
                                    <div className="text-xs text-theme-text-muted">Valore</div>
                                    <div className="text-theme-text-primary font-medium">{detailCode.value_type === 'percentage' ? `${detailCode.value_amount}%` : `${detailCode.value_amount.toFixed(2)} €`}</div>
                                </div>
                                <div>
                                    <div className="text-xs text-theme-text-muted">Ambito</div>
                                    <div className="text-theme-text-primary">{formatScopeBadges(detailCode.scope).join(', ')}</div>
                                </div>
                                <div>
                                    <div className="text-xs text-theme-text-muted">Stato</div>
                                    <div>{statusBadge(detailCode.status)}</div>
                                </div>
                                <div>
                                    <div className="text-xs text-theme-text-muted">Valido dal</div>
                                    <div className="text-theme-text-primary">{new Date(detailCode.valid_from).toLocaleDateString('it-IT')}</div>
                                </div>
                                <div>
                                    <div className="text-xs text-theme-text-muted">Valido fino al</div>
                                    <div className="text-theme-text-primary">{new Date(detailCode.valid_until).toLocaleDateString('it-IT')}</div>
                                </div>
                                <div>
                                    <div className="text-xs text-theme-text-muted">Spesa minima</div>
                                    <div className="text-theme-text-primary">{detailCode.minimum_spend ? `${detailCode.minimum_spend.toFixed(2)} €` : 'Nessuna'}</div>
                                </div>
                                <div>
                                    <div className="text-xs text-theme-text-muted">Utilizzabile</div>
                                    <div className="text-theme-text-primary">{detailCode.single_use ? 'Una sola volta' : 'Illimitato'}</div>
                                </div>
                            </div>

                            {/* Customer */}
                            <div className="border-t border-theme-border pt-4">
                                <h4 className="text-sm font-semibold text-theme-text-primary mb-2">Cliente assegnato</h4>
                                {detailCode.customer_email || detailCode.customer_phone ? (
                                    <div className="text-sm space-y-1">
                                        {detailCode.customer_email && (
                                            <div><span className="text-theme-text-muted">Email:</span> <span className="text-theme-text-primary">{detailCode.customer_email}</span></div>
                                        )}
                                        {detailCode.customer_phone && (
                                            <div><span className="text-theme-text-muted">Telefono:</span> <span className="text-theme-text-primary">{detailCode.customer_phone}</span></div>
                                        )}
                                        <p className="text-xs text-amber-400 mt-2">Solo questo cliente può usare il codice (verifica email all'applicazione).</p>
                                    </div>
                                ) : (
                                    <p className="text-sm text-theme-text-muted">Codice pubblico — nessun cliente specifico assegnato.</p>
                                )}
                            </div>

                            {/* Message / usage conditions */}
                            {(detailCode.message || detailCode.usage_conditions) && (
                                <div className="border-t border-theme-border pt-4 space-y-3">
                                    {detailCode.message && (
                                        <div>
                                            <div className="text-xs text-theme-text-muted">Messaggio promozionale</div>
                                            <div className="text-sm text-theme-text-primary italic">{detailCode.message}</div>
                                        </div>
                                    )}
                                    {detailCode.usage_conditions && (
                                        <div>
                                            <div className="text-xs text-theme-text-muted">Condizioni di utilizzo</div>
                                            <div className="text-sm text-theme-text-primary whitespace-pre-wrap">{detailCode.usage_conditions}</div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Usage history */}
                            <div className="border-t border-theme-border pt-4">
                                <h4 className="text-sm font-semibold text-theme-text-primary mb-3">
                                    Storico utilizzi ({detailUsages.length})
                                </h4>
                                {detailLoading ? (
                                    <p className="text-sm text-theme-text-muted">Caricamento...</p>
                                ) : detailUsages.length === 0 ? (
                                    <p className="text-sm text-theme-text-muted">Il codice non è ancora stato utilizzato.</p>
                                ) : (
                                    <div className="space-y-2 max-h-64 overflow-y-auto">
                                        {detailUsages.map(u => (
                                            <div key={u.id} className="flex justify-between items-start text-xs p-2 bg-theme-bg-tertiary rounded">
                                                <div>
                                                    <div className="text-theme-text-primary">{new Date(u.used_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}</div>
                                                    {u.booking_id && (
                                                        <div className="text-theme-text-muted font-mono">Booking: {u.booking_id.substring(0, 8).toUpperCase()}</div>
                                                    )}
                                                    {u.service_type && (
                                                        <div className="text-theme-text-muted">Servizio: {u.service_type}</div>
                                                    )}
                                                </div>
                                                <div className="text-theme-text-primary font-medium">
                                                    {Number(u.discount_applied).toFixed(2)} €
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="border-t border-theme-border pt-4 text-xs text-theme-text-muted">
                                Creato il {new Date(detailCode.created_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}
                            </div>
                        </div>
                    </div>
                </div>
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

            {sendModalCode && (
                <div className="fixed inset-0 bg-theme-overlay flex items-center justify-center z-50 p-4" onClick={() => !sending && setSendModalCode(null)}>
                    <div className="bg-theme-bg-secondary rounded-3xl shadow-xl max-w-2xl w-full p-6 md:p-8 max-h-[95vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-between items-start mb-5">
                            <div>
                                <h3 className="text-xl font-bold text-theme-text-primary">Invia codice via WhatsApp</h3>
                                <p className="text-sm text-theme-text-muted mt-1 font-mono">{sendModalCode.code}</p>
                            </div>
                            <button
                                onClick={() => !sending && setSendModalCode(null)}
                                className="text-theme-text-muted hover:text-theme-text-primary text-3xl leading-none"
                            >×</button>
                        </div>

                        {/* Destinatario: cliente esistente vs numero manuale */}
                        <div className="mb-4">
                            <label className="block text-sm font-semibold text-theme-text-primary mb-2">Destinatario</label>
                            <div className="flex gap-2 mb-3">
                                <button
                                    type="button"
                                    onClick={() => setSendTarget('cliente')}
                                    className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${sendTarget === 'cliente' ? 'bg-dr7-gold text-white' : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover'}`}
                                >
                                    Cliente esistente
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setSendTarget('numero')}
                                    className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${sendTarget === 'numero' ? 'bg-dr7-gold text-white' : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover'}`}
                                >
                                    Numero manuale
                                </button>
                            </div>

                            {sendTarget === 'cliente' && (
                                <div>
                                    {sendSelectedLabel ? (
                                        <div className="flex items-center justify-between gap-2 px-4 py-3 bg-theme-bg-tertiary border border-dr7-gold/40 rounded-lg">
                                            <div className="text-sm text-theme-text-primary truncate">
                                                <span className="text-dr7-gold mr-2">●</span>{sendSelectedLabel}
                                            </div>
                                            <button type="button" onClick={() => { setSendSelectedLabel(''); setSendSelectedPhone('') }} className="text-xs text-theme-text-muted hover:text-red-400 underline shrink-0">
                                                Cambia
                                            </button>
                                        </div>
                                    ) : (
                                        <>
                                            <input
                                                type="text"
                                                value={sendCustomerSearch}
                                                onChange={(e) => setSendCustomerSearch(e.target.value)}
                                                placeholder="Cerca per nome, email o telefono..."
                                                className="w-full px-4 py-3 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors"
                                            />
                                            {filteredSendCustomers.length > 0 && (
                                                <div className="mt-1 max-h-56 overflow-y-auto bg-theme-bg-primary border border-theme-border rounded-lg">
                                                    {filteredSendCustomers.map(c => {
                                                        const name = c.denominazione || `${c.nome || ''} ${c.cognome || ''}`.trim() || c.telefono || 'Cliente'
                                                        return (
                                                            <button
                                                                type="button"
                                                                key={c.id}
                                                                onClick={() => pickSendCustomer(c)}
                                                                className="w-full text-left px-3 py-2 hover:bg-theme-bg-hover border-b border-theme-border/50 last:border-b-0"
                                                            >
                                                                <div className="text-sm text-theme-text-primary font-medium truncate">{name}</div>
                                                                <div className="text-xs text-theme-text-muted truncate">
                                                                    {c.telefono || 'No phone'}{c.email ? ` · ${c.email}` : ''}
                                                                </div>
                                                            </button>
                                                        )
                                                    })}
                                                </div>
                                            )}
                                            {sendCustomerSearch.trim() && filteredSendCustomers.length === 0 && (
                                                <p className="text-xs text-theme-text-muted mt-2">Nessun cliente trovato.</p>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}

                            {sendTarget === 'numero' && (
                                <input
                                    type="tel"
                                    value={sendManualPhone}
                                    onChange={(e) => setSendManualPhone(e.target.value)}
                                    placeholder="es. +39 345 790 5205"
                                    className="w-full px-4 py-3 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors"
                                />
                            )}
                        </div>

                        {/* Messaggio */}
                        <div className="mb-4">
                            <label className="block text-sm font-semibold text-theme-text-primary mb-2">Messaggio</label>
                            <textarea
                                value={sendMessage}
                                onChange={(e) => setSendMessage(e.target.value)}
                                rows={10}
                                className="w-full px-4 py-3 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary text-sm font-mono focus:outline-none focus:border-dr7-gold transition-colors resize-y"
                            />
                            <p className="text-xs text-theme-text-muted mt-1">
                                Modificabile prima dell'invio. Il codice viene inviato come messaggio WhatsApp testuale.
                            </p>
                        </div>

                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setSendModalCode(null)}
                                disabled={sending}
                                className="px-5 py-2 bg-theme-bg-tertiary text-theme-text-secondary rounded-full hover:bg-theme-bg-hover transition-colors disabled:opacity-50"
                            >
                                Annulla
                            </button>
                            <button
                                onClick={confirmSend}
                                disabled={sending}
                                className="px-6 py-2 bg-green-600 text-white font-semibold rounded-full hover:bg-green-700 transition-colors disabled:opacity-50"
                            >
                                {sending ? 'Invio...' : 'Invia WhatsApp'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
