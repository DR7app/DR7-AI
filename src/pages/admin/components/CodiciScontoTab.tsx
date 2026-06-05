import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../supabaseClient'
import Button from './Button'
import DiscountCodeGeneratorModal from './DiscountCodeGeneratorModal'
import { QRCodeSVG } from 'qrcode.react'
import toast from 'react-hot-toast'

// Static accent palette mirrored on the screenshot — keeps each panel
// visually distinct without inventing data.
const SCOPE_COLORS: Record<string, string> = {
    supercar: 'bg-cyan-500',
    lavaggi: 'bg-blue-500',
    noleggio: 'bg-purple-500',
    rental: 'bg-purple-500',
    vip: 'bg-amber-500',
    aziendali: 'bg-emerald-500',
    moto: 'bg-rose-500',
}

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
            `Ciao! 🎁\n\nEcco il tuo codice sconto DR7 di ${valore} su ${scope}:\n\n*${code.code}*\n\nValido fino al ${valido}.${minSpend}\n\nLo puoi usare al check-out su www.dr7.app\n\nGrazie,\nDR7`
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

    // Panoramica metrics derived from real loaded data.
    const metrics = useMemo(() => {
        const now = new Date()
        const codiciAttivi = discountCodes.filter(c => c.status === 'active').length
        const utilizziTotali = discountCodes.reduce((s, c) => s + (c.usage_count || 0), 0)
        const fatturatoGenerato = discountCodes.reduce((s, c) => s + (c.usage_total || 0), 0)
        const scontoMedio = (() => {
            const used = discountCodes.filter(c => (c.usage_count || 0) > 0)
            if (!used.length) return 0
            const avg = used.reduce((s, c) => s + (c.value_amount || 0), 0) / used.length
            return -avg
        })()
        // Conversion rate proxy: % of codes that have at least one usage.
        const usedCount = discountCodes.filter(c => (c.usage_count || 0) > 0).length
        const conversionRate = discountCodes.length > 0
            ? (usedCount / discountCodes.length) * 100
            : 0
        // ROI proxy: fatturato generato / sconto totale concesso (only with
        // value_type=fixed; percentage values can't be summed directly).
        const scontoTotale = discountCodes.reduce(
            (s, c) => s + (c.value_type === 'fixed' ? (c.value_amount || 0) * (c.usage_count || 0) : 0),
            0
        )
        const roi = scontoTotale > 0 ? fatturatoGenerato / scontoTotale : 0

        // Distribuzione per ambito
        const scopeBuckets: Record<string, number> = {}
        discountCodes.forEach(c => {
            const scopes = c.scope && c.scope.length > 0 ? c.scope : ['altri']
            scopes.forEach(s => { scopeBuckets[s] = (scopeBuckets[s] || 0) + 1 })
        })
        const totalScopeWeight = Object.values(scopeBuckets).reduce((s, v) => s + v, 0)
        const distribuzione = Object.entries(scopeBuckets)
            .map(([key, count]) => ({
                key,
                count,
                pct: totalScopeWeight > 0 ? (count / totalScopeWeight) * 100 : 0,
            }))
            .sort((a, b) => b.count - a.count)

        // Top codici per fatturato
        const topByFatturato = [...discountCodes]
            .filter(c => (c.usage_total || 0) > 0)
            .sort((a, b) => (b.usage_total || 0) - (a.usage_total || 0))
            .slice(0, 5)

        // Codici scaduti (informational, used by hero subtitle)
        const expiredSoon = discountCodes.filter(c => {
            if (c.status !== 'active') return false
            const expiry = new Date(c.valid_until)
            const days = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
            return days >= 0 && days <= 7
        }).length

        return {
            codiciAttivi, utilizziTotali, fatturatoGenerato,
            scontoMedio, conversionRate, roi, scontoTotale,
            distribuzione, topByFatturato, expiredSoon,
        }
    }, [discountCodes])

    const fmtEur = (v: number) => `€ ${v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    const fmtEurShort = (v: number) => `€ ${v.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    const scopeLabel = (key: string): string => {
        const map: Record<string, string> = {
            supercar: 'Supercar',
            lavaggi: 'Lavaggio',
            noleggio: 'Noleggio',
            rental: 'Noleggio',
            vip: 'VIP / servizi',
            aziendali: 'Aziendali',
            moto: 'Moto & Scooter',
            altri: 'Altri',
        }
        return map[key] || key
    }

    return (
        <div className="space-y-6">
            {/* Hero header */}
            <div className="rounded-2xl border border-theme-border bg-gradient-to-br from-theme-bg-secondary to-theme-bg-primary p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-start gap-4 min-w-0">
                        <div className="w-12 h-12 rounded-2xl bg-dr7-gold/15 text-dr7-gold flex items-center justify-center shrink-0">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/>
                                <path d="M20 12v4H6a2 2 0 0 0 0 4h12v-4"/>
                                <line x1="12" y1="6" x2="12" y2="6.01"/>
                                <line x1="12" y1="18" x2="12" y2="18.01"/>
                            </svg>
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-xl sm:text-2xl font-semibold text-theme-text-primary">Codici Sconto Marketing</h2>
                            <p className="text-sm text-theme-text-muted mt-1 max-w-2xl">
                                Crea, gestisci e traccia tutti i codici sconto e gift card per aumentare le conversioni.
                                {metrics.expiredSoon > 0 && (
                                    <span className="ml-2 text-amber-400 font-medium">
                                        {metrics.expiredSoon} codici in scadenza nei prossimi 7 giorni.
                                    </span>
                                )}
                            </p>
                        </div>
                    </div>
                    <Button onClick={() => { setEditingCode(null); setShowDiscountCodeModal(true) }}>
                        + Genera Nuovo Codice
                    </Button>
                </div>
            </div>

            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                <KpiCardCS label="Codici Attivi" value={String(metrics.codiciAttivi)} accent="cyan" icon="ticket" />
                <KpiCardCS label="Utilizzi Totali" value={String(metrics.utilizziTotali)} accent="green" icon="check" />
                <KpiCardCS label="Fatturato Generato" value={fmtEurShort(metrics.fatturatoGenerato)} accent="amber" icon="trending" />
                <KpiCardCS label="Sconto Medio" value={`${metrics.scontoMedio === 0 ? '0' : metrics.scontoMedio.toFixed(1)}%`} accent="purple" icon="percent" />
                <KpiCardCS label="Conversion Rate" value={`${metrics.conversionRate.toFixed(1)}%`} accent="green" icon="users" />
                <KpiCardCS label="ROI Stimato" value={metrics.roi > 0 ? `${metrics.roi.toFixed(1)}x` : '—'} accent="gold" icon="zap" />
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

            {/* Side panels + bottom strip — overview & insights */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Distribuzione per Ambito */}
                <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-5 shadow-sm">
                    <h3 className="text-sm font-semibold text-theme-text-primary mb-4">Distribuzione per Ambito</h3>
                    <div className="flex items-center gap-4">
                        <DonutMulti
                            slices={metrics.distribuzione.map(d => ({
                                value: d.count,
                                color: SCOPE_COLORS[d.key] || 'bg-theme-text-muted',
                            }))}
                            total={discountCodes.length}
                        />
                        <ul className="flex-1 space-y-2 text-xs">
                            {metrics.distribuzione.length === 0 && (
                                <li className="text-theme-text-muted">Nessun codice ancora creato.</li>
                            )}
                            {metrics.distribuzione.map(d => (
                                <li key={d.key} className="flex items-center justify-between gap-2">
                                    <span className="flex items-center gap-2 min-w-0">
                                        <span className={`w-2.5 h-2.5 rounded-sm shrink-0 ${SCOPE_COLORS[d.key] || 'bg-theme-text-muted'}`} />
                                        <span className="text-theme-text-secondary truncate">{scopeLabel(d.key)}</span>
                                    </span>
                                    <span className="text-theme-text-primary font-semibold tabular-nums">{Math.round(d.pct)}%</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>

                {/* Performance Codici */}
                <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-semibold text-theme-text-primary">Performance Codici</h3>
                        <span className="text-[10px] uppercase tracking-wider text-theme-text-muted">live</span>
                    </div>
                    <ul className="space-y-3 text-sm">
                        <li className="flex items-center justify-between">
                            <span className="text-theme-text-muted">Fatturato generato</span>
                            <span className="text-theme-text-primary font-semibold">{fmtEur(metrics.fatturatoGenerato)}</span>
                        </li>
                        <li className="flex items-center justify-between">
                            <span className="text-theme-text-muted">Sconto totale concesso</span>
                            <span className="text-amber-400 font-semibold">{fmtEur(metrics.scontoTotale)}</span>
                        </li>
                        <li className="flex items-center justify-between">
                            <span className="text-theme-text-muted">Conversion Rate</span>
                            <span className="text-green-400 font-semibold">{metrics.conversionRate.toFixed(1)}%</span>
                        </li>
                        <li className="flex items-center justify-between">
                            <span className="text-theme-text-muted">Codici utilizzati</span>
                            <span className="text-theme-text-primary font-semibold">
                                {discountCodes.filter(c => (c.usage_count || 0) > 0).length} / {discountCodes.length}
                            </span>
                        </li>
                    </ul>
                </div>

                {/* Top Codici per Fatturato */}
                <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-5 shadow-sm">
                    <h3 className="text-sm font-semibold text-theme-text-primary mb-4">Top Codici per Fatturato</h3>
                    {metrics.topByFatturato.length === 0 ? (
                        <p className="text-xs text-theme-text-muted">Nessun utilizzo registrato.</p>
                    ) : (
                        <ul className="space-y-2.5 text-xs">
                            {metrics.topByFatturato.map(c => (
                                <li key={c.id} className="flex items-center justify-between gap-2">
                                    <span className="font-mono font-semibold text-theme-text-primary truncate">{c.code}</span>
                                    <span className="text-green-400 font-semibold shrink-0">{fmtEur(c.usage_total || 0)}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>

            {/* Bottom strip: Regole / Automazioni / Insights / Azioni Rapide (all decorative) */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <InfoCardCS
                    title="Regole Attive"
                    decorative
                    rows={[
                        { label: 'Sconto compatibili', value: '30%' },
                        { label: 'Massimi codici per cliente', value: 'max 3' },
                        { label: 'Limite globale al mese', value: '€ 30.000' },
                    ]}
                />
                <InfoCardCS
                    title="Automazioni Attive"
                    decorative
                    rows={[
                        { label: 'Invia automaticamente in mail', value: 'ON' },
                        { label: 'Notifica al cliente', value: 'ON' },
                        { label: 'Avvisa quando scaduto', value: 'ON' },
                        { label: 'Blocca codici doppioni', value: 'ON' },
                    ]}
                />
                <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-5 shadow-sm">
                    <h3 className="text-sm font-semibold text-theme-text-primary mb-3 flex items-center gap-2">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-400">
                            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                        </svg>
                        Insights Intelligenti
                    </h3>
                    {metrics.topByFatturato.length > 0 ? (
                        <p className="text-xs text-theme-text-secondary leading-relaxed">
                            Il codice <span className="font-mono font-semibold text-theme-text-primary">{metrics.topByFatturato[0].code}</span>{' '}
                            ha generato {fmtEur(metrics.topByFatturato[0].usage_total || 0)} di fatturato — è il tuo top performer.
                        </p>
                    ) : (
                        <p className="text-xs text-theme-text-muted">Nessun insight disponibile finché i codici non vengono utilizzati.</p>
                    )}
                </div>
                <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-5 shadow-sm">
                    <h3 className="text-sm font-semibold text-theme-text-primary mb-3">Azioni Rapide</h3>
                    <div className="space-y-2">
                        <button
                            onClick={() => { setEditingCode(null); setShowDiscountCodeModal(true) }}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-theme-border bg-theme-bg-primary text-xs font-medium text-theme-text-secondary hover:border-dr7-gold/40 hover:text-theme-text-primary transition-colors"
                        >
                            <span className="text-dr7-gold">+</span>
                            Genera Codice Sconto
                        </button>
                        <button
                            onClick={() => { setEditingCode(null); setShowDiscountCodeModal(true) }}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-theme-border bg-theme-bg-primary text-xs font-medium text-theme-text-secondary hover:border-dr7-gold/40 hover:text-theme-text-primary transition-colors"
                        >
                            <span className="text-purple-400">🎁</span>
                            Genera Gift Card
                        </button>
                        <button
                            disabled
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-theme-border bg-theme-bg-primary text-xs font-medium text-theme-text-muted opacity-60 cursor-not-allowed"
                        >
                            <span>📥</span>
                            Importa Codici
                        </button>
                        <button
                            disabled
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-theme-border bg-theme-bg-primary text-xs font-medium text-theme-text-muted opacity-60 cursor-not-allowed"
                        >
                            <span>📊</span>
                            Esporta Report
                        </button>
                    </div>
                </div>
            </div>

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
                                    value={`https://dr7.app/promo/${selectedCodeForQR.code}`}
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
                                className="px-6 py-2 bg-dr7-gold text-white font-semibold rounded-full hover:bg-[#0A8FA3] transition-colors"
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

/* ── Sub-components for the new Panoramica layout ──────────────── */

function KpiCardCS(props: {
    label: string
    value: string
    accent: 'cyan' | 'green' | 'amber' | 'purple' | 'gold'
    icon: 'ticket' | 'check' | 'trending' | 'percent' | 'users' | 'zap'
}) {
    const accentMap: Record<typeof props.accent, { bg: string; text: string }> = {
        cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-400' },
        green: { bg: 'bg-green-500/10', text: 'text-green-400' },
        amber: { bg: 'bg-amber-500/10', text: 'text-amber-400' },
        purple: { bg: 'bg-purple-500/10', text: 'text-purple-400' },
        gold: { bg: 'bg-dr7-gold/10', text: 'text-dr7-gold' },
    }
    const a = accentMap[props.accent]
    const iconMap: Record<typeof props.icon, React.ReactElement> = {
        ticket: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h18a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4V7a2 2 0 0 1 2-2z"/><line x1="13" y1="5" x2="13" y2="19"/></svg>,
        check: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>,
        trending: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
        percent: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>,
        users: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
        zap: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
    }
    return (
        <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between gap-2 mb-2">
                <span className="text-[11px] text-theme-text-muted uppercase tracking-wider">{props.label}</span>
                <span className={`w-8 h-8 rounded-xl flex items-center justify-center ${a.bg} ${a.text}`}>
                    {iconMap[props.icon]}
                </span>
            </div>
            <p className="text-xl font-bold text-theme-text-primary truncate">{props.value}</p>
        </div>
    )
}

function DonutMulti({ slices, total }: { slices: { value: number; color: string }[]; total: number }) {
    const sum = slices.reduce((s, x) => s + x.value, 0) || 1
    const r = 28
    const c = 2 * Math.PI * r
    let offset = 0
    // Map Tailwind bg-* to a stroke color via a dynamic style — fall back
    // to a CSS variable would be cleaner, but Tailwind palette mirrors
    // are stable enough as inline strokes here.
    const tailwindToHex: Record<string, string> = {
        'bg-cyan-500': '#06b6d4',
        'bg-blue-500': '#3b82f6',
        'bg-purple-500': '#a855f7',
        'bg-amber-500': '#f59e0b',
        'bg-emerald-500': '#10b981',
        'bg-rose-500': '#f43f5e',
        'bg-theme-text-muted': '#9ca3af',
    }
    return (
        <div className="relative w-24 h-24 shrink-0">
            <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
                <circle cx="32" cy="32" r={r} fill="none" stroke="currentColor" strokeWidth="8" className="text-theme-bg-tertiary" />
                {slices.map((s, i) => {
                    const len = (s.value / sum) * c
                    const dasharray = `${len} ${c - len}`
                    const dashoffset = -offset
                    offset += len
                    const stroke = tailwindToHex[s.color] || '#9ca3af'
                    return (
                        <circle
                            key={i}
                            cx="32"
                            cy="32"
                            r={r}
                            fill="none"
                            stroke={stroke}
                            strokeWidth="8"
                            strokeDasharray={dasharray}
                            strokeDashoffset={dashoffset}
                        />
                    )
                })}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xl font-bold text-theme-text-primary leading-none">{total}</span>
                <span className="text-[9px] uppercase tracking-wider text-theme-text-muted mt-0.5">Total</span>
            </div>
        </div>
    )
}

function InfoCardCS({ title, rows, decorative }: {
    title: string
    rows: { label: string; value: string }[]
    decorative?: boolean
}) {
    return (
        <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-theme-text-primary">{title}</h3>
                {decorative && <span className="text-[10px] uppercase tracking-wider text-theme-text-muted">decorativo</span>}
            </div>
            <ul className="space-y-2 text-xs">
                {rows.map((r, i) => (
                    <li key={i} className="flex items-center justify-between gap-2">
                        <span className="text-theme-text-muted">{r.label}</span>
                        <span className="text-theme-text-primary font-semibold">{r.value}</span>
                    </li>
                ))}
            </ul>
        </div>
    )
}
