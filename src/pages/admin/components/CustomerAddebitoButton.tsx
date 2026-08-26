import { useState } from 'react'
import toast from 'react-hot-toast'
import { authFetch } from '../../../utils/authFetch'
import type { NexiCardView } from '../../../utils/nexiCards'
import MoneyInput from '../../../components/MoneyInput'

/**
 * Single "Addebito" control for a customer that owns one or more tokenized
 * cards. Flow: click Addebito → enter amount + causale → CHOOSE the card →
 * confirm. Charges via the addebito flow (nexi-nuovo-addebito →
 * process-pending-addebiti, captureType 'IMPLICIT') = a real DEBIT, never a
 * pre-authorization hold.
 *
 * Used in Scheda Cliente (ReportClienteModal, CustomersTab detail,
 * ClientCardInfoModal).
 */
interface CustomerAddebitoButtonProps {
    cards: NexiCardView[]
    customerEmail?: string | null
    customerName?: string | null
    bookingId?: string | null
    /** Pre-select this card (e.g. the one that paid the booking). */
    defaultContractId?: string | null
    /** Start with the form already open (e.g. when rendered inside a modal). */
    autoOpen?: boolean
    /**
     * 26/08/2026: `compact` rende il controllo come PICCOLO bottone inline
     * (stessa taglia di Pre-autorizza / Elimina) invece della barra a tutta
     * larghezza, e apre il form in un modal sopra la lista. Serve nella tab
     * Nexi, dove un blocco full-width per ogni carta rendeva la pagina
     * illeggibile. Senza la prop il comportamento resta quello di prima.
     */
    compact?: boolean
    onDone?: () => void
}

export default function CustomerAddebitoButton({
    cards, customerEmail, customerName, bookingId, defaultContractId, autoOpen, compact, onDone,
}: CustomerAddebitoButtonProps) {
    const defaultCid = (defaultContractId && cards.some(c => c.contractId === defaultContractId))
        ? defaultContractId
        : (cards.find(c => c.isDefault)?.contractId || cards[0]?.contractId || '')

    const [open, setOpen] = useState(!!autoOpen)
    const [amount, setAmount] = useState('')
    const [causale, setCausale] = useState('')
    // Parametri cascata scelti al momento dell'addebito (per-transazione).
    const [maxAttempts, setMaxAttempts] = useState('')      // vuoto = illimitato
    const [cascadeStepEur, setCascadeStepEur] = useState('300') // scalino €, default 300
    // Carte selezionate per l'addebito. Default: la carta predefinita. Si
    // possono selezionare piu' carte (o tutte): la cascata le prova in ordine.
    const [selected, setSelected] = useState<Record<string, boolean>>(defaultCid ? { [defaultCid]: true } : {})
    const [sending, setSending] = useState(false)

    const cardLabel = (c: NexiCardView) => {
        const pan = c.maskedPan || `…${c.contractId.slice(-6)}`
        const extra = [c.circuit, c.cardType].filter(Boolean).join(' ')
        return `${pan}${extra ? ` — ${extra}` : ''}${c.isDefault ? ' (predefinita)' : ''}`
    }

    // Carte selezionate NELL'ORDINE della lista (la cascata parte dalla prima).
    const orderedSelected = cards.filter(c => selected[c.contractId]).map(c => c.contractId)
    const allSelected = cards.length > 0 && orderedSelected.length === cards.length
    const canSubmit = orderedSelected.length > 0 && !!customerEmail && parseFloat(amount) > 0 && !sending

    const toggleCard = (cid: string) => setSelected(s => ({ ...s, [cid]: !s[cid] }))
    const toggleAll = () => {
        if (allSelected) setSelected(defaultCid ? { [defaultCid]: true } : {})
        else setSelected(Object.fromEntries(cards.map(c => [c.contractId, true])))
    }

    async function submit() {
        if (!customerEmail) { toast.error('Email cliente mancante'); return }
        if (orderedSelected.length === 0) { toast.error('Seleziona almeno una carta'); return }
        const amt = parseFloat(amount)
        if (!amt || amt <= 0) { toast.error('Inserisci un importo valido'); return }

        setSending(true)
        try {
            const res = await authFetch('/.netlify/functions/nexi-nuovo-addebito', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bookingId: bookingId || null,
                    customerName: customerName || '',
                    customerEmail,
                    amount: amt.toFixed(2),
                    causale: causale.trim() || `Addebito - ${customerName || customerEmail}`,
                    contractId: orderedSelected[0],
                    contractIds: orderedSelected.length > 1 ? orderedSelected : undefined,
                    // Cascata scelta per-transazione. Vuoto = default (illimitato / €300).
                    maxAttempts: parseInt(maxAttempts) > 0 ? parseInt(maxAttempts) : undefined,
                    cascadeStepEur: parseFloat(cascadeStepEur) > 0 ? parseFloat(cascadeStepEur) : undefined,
                }),
            })
            const data = await res.json().catch(() => ({}))
            if (res.ok && data.success) {
                toast.success(data.message || 'Addebito programmato')
                setOpen(false)
                setAmount('')
                setCausale('')
                onDone?.()
            } else {
                toast.error(data.error || 'Errore nell\'invio dell\'addebito')
            }
        } catch (err: unknown) {
            toast.error('Errore: ' + (err instanceof Error ? err.message : String(err)))
        } finally {
            setSending(false)
        }
    }

    // Il pulsante Addebito è SEMPRE presente nella scheda cliente. Se il cliente
    // non ha ancora una carta tokenizzata non si può addebitare: il pulsante
    // resta visibile ma disabilitato, con la spiegazione.
    if (cards.length === 0) {
        return (
            <button
                type="button"
                disabled
                title="Nessuna carta salvata: il cliente deve prima pagare online (così la carta viene tokenizzata) per poter essere addebitato."
                className={compact
                    ? 'text-[11px] px-2 py-1 rounded bg-theme-bg-tertiary text-theme-text-muted border border-theme-border cursor-not-allowed whitespace-nowrap'
                    : 'w-full px-3 py-2 rounded-lg text-sm font-semibold bg-theme-bg-tertiary text-theme-text-muted border border-theme-border cursor-not-allowed'}
            >
                {compact ? 'Addebito' : 'Addebito — nessuna carta salvata'}
            </button>
        )
    }

    if (!open) {
        return (
            <button
                onClick={() => setOpen(true)}
                title="Addebita la carta salvata del cliente"
                className={compact
                    ? 'text-[11px] px-2 py-1 rounded bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 whitespace-nowrap'
                    : 'w-full px-3 py-2 rounded-lg text-sm font-semibold bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-700/50 transition-colors'}
            >
                Addebito
            </button>
        )
    }

    const form = (
        <div className="rounded-lg border border-theme-border bg-theme-bg-secondary p-3 space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-theme-text-muted">
                Nuovo addebito — debito immediato
            </div>

            {/* 1) Importo */}
            <div className="flex items-center gap-2">
                <span className="text-theme-text-muted text-sm">€</span>
                <MoneyInput
                  min="0"
                  value={amount}
                  onChange={(__v: string) => setAmount(__v)}
                  placeholder="Importo da addebitare"
                  autoFocus
                  className="flex-1 px-2 py-1.5 rounded-md bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm focus:outline-none focus:border-dr7-gold"
                />
            </div>

            {/* 2) Scelta carta/e — selezione multipla, cascata in ordine */}
            <div>
                <div className="flex items-center justify-between">
                    <label className="text-[11px] text-theme-text-muted">Carta/e da addebitare</label>
                    {cards.length > 1 && (
                        <button type="button" onClick={toggleAll} className="text-[11px] text-dr7-gold hover:underline">
                            {allSelected ? 'Deseleziona tutte' : 'Seleziona tutte'}
                        </button>
                    )}
                </div>
                <div className="mt-1 space-y-1 max-h-40 overflow-y-auto">
                    {cards.map(c => (
                        <label key={c.contractId} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-theme-bg-primary border border-theme-border text-sm cursor-pointer">
                            <input type="checkbox" checked={!!selected[c.contractId]} onChange={() => toggleCard(c.contractId)} className="accent-dr7-gold" />
                            <span className="text-theme-text-primary truncate">{cardLabel(c)}</span>
                        </label>
                    ))}
                </div>
                {orderedSelected.length > 1 && (
                    <div className="text-[10px] text-theme-text-muted mt-1">
                        Cascata: prova in ordine dall'alto e si ferma alla prima carta che accetta (per ogni carta: importo pieno, poi −€{cascadeStepEur || '300'}, e giù di quel passo).
                    </div>
                )}
            </div>

            {/* 3) Cascata: scalino + max tentativi (per-transazione) */}
            <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] text-theme-text-muted">
                    Scalino cascata
                    <div className="relative mt-1">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-theme-text-muted text-sm pointer-events-none">€</span>
                        <input
                            type="number" min="1" step="50" inputMode="decimal"
                            value={cascadeStepEur}
                            onChange={e => setCascadeStepEur(e.target.value)}
                            placeholder="300"
                            className="w-full pl-6 pr-2 py-1.5 rounded-md bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm text-right tabular-nums focus:outline-none focus:border-dr7-gold"
                        />
                    </div>
                </label>
                <label className="text-[11px] text-theme-text-muted">
                    Max tentativi
                    <input
                        type="number" min="1" step="1" inputMode="numeric"
                        value={maxAttempts}
                        onChange={e => setMaxAttempts(e.target.value)}
                        placeholder="illimitato"
                        className="w-full mt-1 px-2 py-1.5 rounded-md bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm text-right tabular-nums focus:outline-none focus:border-dr7-gold"
                    />
                </label>
            </div>
            <div className="text-[10px] text-theme-text-muted -mt-1">
                Prova a scendere di €{cascadeStepEur || '300'} ad ogni rifiuto{parseInt(maxAttempts) > 0 ? `, per max ${parseInt(maxAttempts)} tentativi, poi si ferma` : ' (nessun limite di tentativi)'}.
            </div>

            {/* 4) Causale */}
            <input
                type="text"
                value={causale}
                onChange={e => setCausale(e.target.value)}
                placeholder="Causale (opzionale)"
                className="w-full px-2 py-1.5 rounded-md bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm focus:outline-none focus:border-dr7-gold"
            />

            <div className="flex justify-end gap-2 pt-1">
                <button
                    onClick={() => { setOpen(false); setAmount(''); setCausale('') }}
                    disabled={sending}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover border border-theme-border transition-colors"
                >
                    Annulla
                </button>
                <button
                    onClick={submit}
                    disabled={!canSubmit}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {sending ? 'Invio...' : 'Conferma addebito'}
                </button>
            </div>
        </div>
    )

    if (!compact) return form

    // In compact mode il form vive in un modal: la riga della carta resta
    // alta una riga e il form non spinge in basso tutta la lista.
    return (
        <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4"
            onClick={() => { if (!sending) { setOpen(false); setAmount(''); setCausale('') } }}
        >
            <div
                className="w-full sm:max-w-md max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-xl"
                onClick={e => e.stopPropagation()}
            >
                <div className="px-3 pt-3 pb-1 bg-theme-bg-secondary rounded-t-2xl sm:rounded-t-xl border-x border-t border-theme-border text-sm font-bold text-theme-text-primary">
                    Addebito — {customerName || customerEmail || 'cliente'}
                </div>
                {form}
            </div>
        </div>
    )
}
