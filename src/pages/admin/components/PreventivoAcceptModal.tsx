import { useState, useEffect, memo } from 'react'
import { createPortal } from 'react-dom'
import CustomerAutocomplete from './CustomerAutocomplete'
import { usePaymentMethods } from '../../../hooks/usePaymentMethods'
import MoneyInput from '../../../components/MoneyInput'
import TelefonoConPrefisso from '../../../components/TelefonoConPrefisso'
import CalcolaCFButton from '../../../components/CalcolaCFButton'
import { supabase } from '../../../supabaseClient'

/**
 * Modal "Accetta preventivo" — same UX pattern as PreventivoRejectModal:
 * opens via window CustomEvent, renders into a portal at document.body so
 * the parent's heavy list view doesn't have to re-render to manage state.
 *
 * Collects: customer (from clienti lead) + payment method.
 * On confirm: parent's onConfirm creates the booking row and marks the
 * preventivo as accettato.
 */

const OPEN_EVENT = 'preventivo-accept-modal:open'

export interface AcceptModalPreventivo {
    id: string
    vehicle_name: string
    pickup_date: string
    dropoff_date: string
    total_final: number | null
    customer_phone?: string | null
}

/**
 * Secondo guidatore — stessi campi del modale prenotazione, cosi' finisce
 * uguale nel contratto (SecondDriver*) e nella firma (ruolo 2_guidatore).
 */
export interface SecondoGuidatoreArgs {
    customer_id: string | null
    name: string
    surname: string
    codice_fiscale: string
    sesso: string
    indirizzo: string
    cap: string
    citta: string
    provincia: string
    birth_date: string
    birth_place: string
    birth_provincia: string
    phone: string
    email: string
    license_type: string
    license_number: string
    license_issued_by: string
    license_issue_date: string
    license_expiry: string
}

/** Garante / fideiussore solidale: fino a 3, come nel modale prenotazione. */
export interface GaranteArgs {
    nome_cognome: string
    codice_fiscale: string
    sesso: string
    indirizzo: string
    cap: string
    citta: string
    provincia: string
    data_nascita: string
    citta_nascita: string
    provincia_nascita: string
    telefono: string
    email: string
}

const GUIDATORE_VUOTO: SecondoGuidatoreArgs = {
    customer_id: null, name: '', surname: '', codice_fiscale: '', sesso: '',
    indirizzo: '', cap: '', citta: '', provincia: '', birth_date: '', birth_place: '',
    birth_provincia: '', phone: '', email: '', license_type: '', license_number: '',
    license_issued_by: '', license_issue_date: '', license_expiry: '',
}

const GARANTE_VUOTO: GaranteArgs = {
    nome_cognome: '', codice_fiscale: '', sesso: '', indirizzo: '', cap: '', citta: '',
    provincia: '', data_nascita: '', citta_nascita: '', provincia_nascita: '',
    telefono: '', email: '',
}

export interface AcceptConfirmArgs {
    preventivo: AcceptModalPreventivo
    customer_id: string
    payment_method: string
    payment_status: 'pending' | 'paid'
    amount_paid_eur: number
    // "Conferma Prenotazione" (red box) — stesso significato di ReservationsTab:
    // la booking non scade dopo 1h, appare in rosso col nome cliente in
    // calendario e fa partire conferma + contratto come una prenotazione.
    confirm_booking: boolean
    /**
     * 09/09/2026: chi guida e chi garantisce si aggiungono QUI, alla
     * conversione. Prima si potevano mettere solo riaprendo la prenotazione,
     * quindi il primo contratto partiva col solo intestatario e la firma non
     * arrivava agli altri.
     */
    second_driver: SecondoGuidatoreArgs | null
    guarantors: GaranteArgs[]
}

/** Imperative open helper. Call from anywhere — no React state involved. */
export function openPreventivoAcceptModal(p: AcceptModalPreventivo) {
    window.dispatchEvent(new CustomEvent<AcceptModalPreventivo>(OPEN_EVENT, { detail: p }))
}

interface Props {
    onConfirm: (args: AcceptConfirmArgs) => Promise<void> | void
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    customers: any[]
}


function PreventivoAcceptModal({ onConfirm, customers }: Props) {
    const adminMethods = usePaymentMethods()
    const PAYMENT_METHODS = adminMethods.map(m => ({ value: m.label, label: m.label }))
    const [preventivo, setPreventivo] = useState<AcceptModalPreventivo | null>(null)
    const [customerId, setCustomerId] = useState('')
    const [paymentMethod, setPaymentMethod] = useState('Contanti')
    const [paymentStatus, setPaymentStatus] = useState<'pending' | 'paid'>('pending')
    const [amountPaid, setAmountPaid] = useState('0')
    const [confirmBooking, setConfirmBooking] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    // Secondo guidatore e garanti: chiusi finche' non servono, cosi' la
    // conversione normale resta corta com'era.
    const [conSecondoGuidatore, setConSecondoGuidatore] = useState(false)
    const [secondoGuidatore, setSecondoGuidatore] = useState<SecondoGuidatoreArgs>({ ...GUIDATORE_VUOTO })
    const [garanti, setGaranti] = useState<GaranteArgs[]>([])

    useEffect(() => {
        function handleOpen(e: Event) {
            const ce = e as CustomEvent<AcceptModalPreventivo>
            if (!ce.detail) return
            setPreventivo(ce.detail)
            setCustomerId('')
            setPaymentMethod('Contanti')
            setPaymentStatus('pending')
            setAmountPaid('0')
            setConfirmBooking(false)
            setSubmitting(false)
            setError(null)
            setConSecondoGuidatore(false)
            setSecondoGuidatore({ ...GUIDATORE_VUOTO })
            setGaranti([])
        }
        window.addEventListener(OPEN_EVENT, handleOpen)
        return () => window.removeEventListener(OPEN_EVENT, handleOpen)
    }, [])

    useEffect(() => {
        if (!preventivo) return
        function handleEsc(e: KeyboardEvent) {
            if (e.key === 'Escape') setPreventivo(null)
        }
        window.addEventListener('keydown', handleEsc)
        return () => window.removeEventListener('keydown', handleEsc)
    }, [preventivo])

    if (!preventivo) return null

    async function handleConfirm() {
        if (!preventivo) return
        if (!customerId) {
            setError('Seleziona un cliente dalla lista')
            return
        }
        if (!paymentMethod) {
            setError('Seleziona un metodo di pagamento')
            return
        }
        if (conSecondoGuidatore && !secondoGuidatore.name.trim() && !secondoGuidatore.surname.trim()) {
            setError('Secondo guidatore: manca il nome. Compila o togli la spunta.')
            return
        }
        if (garanti.some(g => g.nome_cognome.trim() === '')) {
            setError('Garante senza nome: compila o rimuovilo.')
            return
        }
        setSubmitting(true)
        setError(null)
        try {
            const amt = parseFloat(amountPaid) || 0
            await onConfirm({
                preventivo,
                customer_id: customerId,
                payment_method: paymentMethod,
                payment_status: paymentStatus,
                amount_paid_eur: paymentStatus === 'paid' ? (preventivo.total_final ?? 0) : amt,
                // Paid → sempre confermata. Da saldare → solo se la red box è spuntata.
                confirm_booking: paymentStatus === 'paid' ? true : confirmBooking,
                second_driver: conSecondoGuidatore && (secondoGuidatore.name.trim() || secondoGuidatore.surname.trim())
                    ? secondoGuidatore
                    : null,
                guarantors: garanti.filter(g => g.nome_cognome.trim() !== ''),
            })
            setPreventivo(null)
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            setError(msg)
        } finally {
            setSubmitting(false)
        }
    }

    const fmtDate = (iso: string) => {
        try { return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' }) }
        catch { return iso }
    }

    const modal = (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={() => !submitting && setPreventivo(null)}>
            <div className="bg-theme-bg-secondary rounded-lg border border-theme-border max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-semibold text-theme-text-primary">Accetta preventivo</h3>
                    <button onClick={() => !submitting && setPreventivo(null)} className="text-theme-text-muted text-2xl leading-none hover:text-theme-text-primary">×</button>
                </div>

                <div className="bg-theme-bg-tertiary border border-theme-border rounded p-3 mb-4 text-sm">
                    <p className="text-theme-text-primary font-semibold">{preventivo.vehicle_name}</p>
                    <p className="text-theme-text-secondary text-xs">{fmtDate(preventivo.pickup_date)} → {fmtDate(preventivo.dropoff_date)}</p>
                    {preventivo.total_final != null && (
                        <p className="text-dr7-gold font-bold mt-1">€{preventivo.total_final.toFixed(2)}</p>
                    )}
                </div>

                <div className="mb-4">
                    <label className="block text-sm font-medium text-theme-text-secondary mb-1">Cliente *</label>
                    <CustomerAutocomplete
                        customers={customers}
                        selectedCustomerId={customerId}
                        onSelectCustomer={(id) => setCustomerId(id)}
                        placeholder="Cerca per nome, email o telefono..."
                        required
                    />
                </div>

                <div className="mb-4">
                    <label className="block text-sm font-medium text-theme-text-secondary mb-1">Stato pagamento *</label>
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            onClick={() => setPaymentStatus('pending')}
                            className={`px-3 py-2 rounded-lg border text-sm font-semibold transition-colors ${paymentStatus === 'pending' ? 'border-amber-500 bg-amber-500/15 text-amber-300' : 'border-theme-border text-theme-text-secondary hover:border-theme-text-muted'}`}
                        >
                            Da saldare
                        </button>
                        <button
                            type="button"
                            onClick={() => setPaymentStatus('paid')}
                            className={`px-3 py-2 rounded-lg border text-sm font-semibold transition-colors ${paymentStatus === 'paid' ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300' : 'border-theme-border text-theme-text-secondary hover:border-theme-text-muted'}`}
                        >
                            Pagato
                        </button>
                    </div>
                </div>

                <div className="mb-4">
                    <label className="block text-sm font-medium text-theme-text-secondary mb-1">Metodo di pagamento *</label>
                    <select
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value)}
                        className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary text-sm focus:outline-none focus:border-dr7-gold"
                    >
                        {PAYMENT_METHODS.map(pm => (
                            <option key={pm.value} value={pm.value}>{pm.label}</option>
                        ))}
                    </select>
                    {paymentMethod === 'Pay by Link Nexi' && (
                        <p className="text-xs text-theme-text-muted mt-1">Il link Nexi viene generato dopo la creazione della prenotazione.</p>
                    )}
                </div>

                {paymentStatus === 'pending' && (
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-theme-text-secondary mb-1">Acconto incassato (EUR)</label>
                        <MoneyInput
                          min="0"
                          value={amountPaid}
                          onChange={(__v: string) => setAmountPaid(__v)}
                          placeholder="0.00"
                          className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary text-sm focus:outline-none focus:border-dr7-gold"
                        />
                        <p className="text-xs text-theme-text-muted mt-1">Lascia 0 se nulla e' stato ancora pagato.</p>
                    </div>
                )}

                {/* Conferma Prenotazione — stessa red box di ReservationsTab.
                    Solo per "Da saldare": le accettazioni "Pagato" sono già
                    confermate automaticamente. */}
                {paymentStatus === 'pending' && (
                    <div className={`flex items-start gap-2 p-3 rounded-lg border mb-4 ${confirmBooking ? 'border-red-500 bg-red-900/10' : 'border-theme-border'}`}>
                        <input
                            type="checkbox"
                            id="preventivo_confirm_booking"
                            checked={confirmBooking}
                            onChange={(e) => setConfirmBooking(e.target.checked)}
                            className="w-4 h-4 mt-0.5 text-red-600 bg-theme-bg-tertiary border-theme-border-light rounded focus:ring-red-500"
                        />
                        <label htmlFor="preventivo_confirm_booking" className="text-sm text-theme-text-secondary cursor-pointer">
                            <span className="font-semibold text-red-400">Conferma Prenotazione</span>
                            <span className="block text-xs text-theme-text-muted mt-0.5">La prenotazione NON scadrà dopo 1h. In calendario apparirà in rosso con il nome del cliente invece di "Da Saldare". Invia conferma + contratto al cliente.</span>
                        </label>
                    </div>
                )}

                {/* === Secondo guidatore === */}
                <div className={`rounded-lg border mb-4 ${conSecondoGuidatore ? 'border-dr7-gold/40' : 'border-theme-border'}`}>
                    <label className="flex items-start gap-2 p-3 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={conSecondoGuidatore}
                            onChange={(e) => setConSecondoGuidatore(e.target.checked)}
                            className="w-4 h-4 mt-0.5"
                        />
                        <span className="text-sm text-theme-text-secondary">
                            <span className="font-semibold text-theme-text-primary">Secondo guidatore</span>
                            <span className="block text-xs text-theme-text-muted mt-0.5">Finisce nel contratto e riceve la sua firma. Puoi anche sceglierlo fra i clienti gia' registrati.</span>
                        </span>
                    </label>
                    {conSecondoGuidatore && (
                        <div className="px-3 pb-3 space-y-3">
                            <div>
                                <label className="block text-xs text-theme-text-muted mb-1">Cliente gia' registrato (facoltativo)</label>
                                <CustomerAutocomplete
                                    customers={customers}
                                    selectedCustomerId={secondoGuidatore.customer_id || ''}
                                    onSelectCustomer={(id) => {
                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                        const c: any = customers.find((x: any) => x.id === id)
                                        const parti = String(c?.full_name || '').trim().split(' ')
                                        setSecondoGuidatore(prev => ({
                                            ...prev,
                                            customer_id: id || null,
                                            name: parti[0] || prev.name,
                                            surname: parti.slice(1).join(' ') || prev.surname,
                                            email: c?.email || prev.email,
                                            phone: c?.phone || prev.phone,
                                        }))
                                        if (!id) return
                                        // La scheda completa arriva subito dopo: CF, indirizzo, patente.
                                        schedaCliente(id).then(sc => {
                                            if (!sc) return
                                            setSecondoGuidatore(prev => ({
                                                ...prev,
                                                name: sc.nome || prev.name,
                                                surname: sc.cognome || prev.surname,
                                                email: sc.email || prev.email,
                                                phone: sc.telefono || prev.phone,
                                                codice_fiscale: sc.codice_fiscale || prev.codice_fiscale,
                                                sesso: sc.sesso || prev.sesso,
                                                indirizzo: sc.indirizzo || prev.indirizzo,
                                                cap: sc.cap || prev.cap,
                                                citta: sc.citta || prev.citta,
                                                provincia: sc.provincia || prev.provincia,
                                                birth_date: sc.data_nascita || prev.birth_date,
                                                birth_place: sc.luogo_nascita || prev.birth_place,
                                                birth_provincia: sc.provincia_nascita || prev.birth_provincia,
                                                license_type: sc.tipo_patente || prev.license_type,
                                                license_number: sc.numero_patente || prev.license_number,
                                                license_issued_by: sc.emessa_da || prev.license_issued_by,
                                                license_issue_date: sc.data_rilascio_patente || prev.license_issue_date,
                                                license_expiry: sc.scadenza_patente || prev.license_expiry,
                                            }))
                                        })
                                    }}
                                    placeholder="Cerca per nome, email o telefono..."
                                />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <CampoModale label="Nome" value={secondoGuidatore.name} onChange={v => setSecondoGuidatore(p => ({ ...p, name: v }))} />
                                <CampoModale label="Cognome" value={secondoGuidatore.surname} onChange={v => setSecondoGuidatore(p => ({ ...p, surname: v }))} />
                                <div>
                                    <label className="block text-xs text-theme-text-muted mb-1">Codice fiscale</label>
                                    <div className="flex gap-2">
                                        <input
                                            value={secondoGuidatore.codice_fiscale}
                                            onChange={(e) => setSecondoGuidatore(p => ({ ...p, codice_fiscale: e.target.value.toUpperCase() }))}
                                            className="flex-1 min-w-0 bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-sm text-theme-text-primary uppercase focus:outline-none focus:border-dr7-gold"
                                        />
                                        <CalcolaCFButton
                                            className="px-3 py-2 bg-dr7-gold hover:bg-dr7-gold/80 text-white text-xs font-medium rounded whitespace-nowrap"
                                            config={{
                                                getCognome: () => secondoGuidatore.surname,
                                                getNome: () => secondoGuidatore.name,
                                                getDataNascita: () => secondoGuidatore.birth_date,
                                                getSesso: () => secondoGuidatore.sesso,
                                                getLuogoNascita: () => secondoGuidatore.birth_place,
                                                getCodiceFiscale: () => secondoGuidatore.codice_fiscale,
                                                setCodiceFiscale: (v: string) => setSecondoGuidatore(p => ({ ...p, codice_fiscale: v })),
                                                setSesso: (v: string) => setSecondoGuidatore(p => ({ ...p, sesso: v })),
                                                setDataNascita: (v: string) => setSecondoGuidatore(p => ({ ...p, birth_date: v })),
                                                setLuogoNascita: (v: string) => setSecondoGuidatore(p => ({ ...p, birth_place: v })),
                                                setProvinciaNascita: (v: string) => setSecondoGuidatore(p => ({ ...p, birth_provincia: v })),
                                            }}
                                        />
                                    </div>
                                </div>
                                <SessoModale value={secondoGuidatore.sesso} onChange={v => setSecondoGuidatore(p => ({ ...p, sesso: v }))} />
                                <CampoModale label="Data di nascita" type="date" value={secondoGuidatore.birth_date} onChange={v => setSecondoGuidatore(p => ({ ...p, birth_date: v }))} />
                                <CampoModale label="Luogo di nascita" value={secondoGuidatore.birth_place} onChange={v => setSecondoGuidatore(p => ({ ...p, birth_place: v }))} />
                                <CampoModale label="Provincia di nascita" value={secondoGuidatore.birth_provincia} onChange={v => setSecondoGuidatore(p => ({ ...p, birth_provincia: v.toUpperCase() }))} maxLength={2} />
                                <CampoModale label="Indirizzo" value={secondoGuidatore.indirizzo} onChange={v => setSecondoGuidatore(p => ({ ...p, indirizzo: v }))} />
                                <CampoModale label="CAP" value={secondoGuidatore.cap} onChange={v => setSecondoGuidatore(p => ({ ...p, cap: v }))} />
                                <CampoModale label="Citta" value={secondoGuidatore.citta} onChange={v => setSecondoGuidatore(p => ({ ...p, citta: v }))} />
                                <CampoModale label="Provincia" value={secondoGuidatore.provincia} onChange={v => setSecondoGuidatore(p => ({ ...p, provincia: v.toUpperCase() }))} maxLength={2} />
                                <div>
                                    <label className="block text-xs text-theme-text-muted mb-1">Telefono</label>
                                    <TelefonoConPrefisso
                                        value={secondoGuidatore.phone}
                                        onChange={(v: string) => setSecondoGuidatore(p => ({ ...p, phone: v }))}
                                        className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:border-dr7-gold"
                                        selectClassName="bg-theme-bg-tertiary border border-theme-border rounded px-2 py-2 text-sm text-theme-text-primary"
                                        mostraAnteprima={false}
                                    />
                                    <p className="text-[11px] text-theme-text-muted mt-1">Senza numero non riceve il link della firma.</p>
                                </div>
                                <CampoModale label="Email" type="email" value={secondoGuidatore.email} onChange={v => setSecondoGuidatore(p => ({ ...p, email: v }))} />
                                <CampoModale label="Tipo patente" value={secondoGuidatore.license_type} onChange={v => setSecondoGuidatore(p => ({ ...p, license_type: v }))} />
                                <CampoModale label="Numero patente" value={secondoGuidatore.license_number} onChange={v => setSecondoGuidatore(p => ({ ...p, license_number: v }))} />
                                <CampoModale label="Rilasciata da" value={secondoGuidatore.license_issued_by} onChange={v => setSecondoGuidatore(p => ({ ...p, license_issued_by: v }))} />
                                <CampoModale label="Data rilascio" type="date" value={secondoGuidatore.license_issue_date} onChange={v => setSecondoGuidatore(p => ({ ...p, license_issue_date: v }))} />
                                <CampoModale label="Scadenza patente" type="date" value={secondoGuidatore.license_expiry} onChange={v => setSecondoGuidatore(p => ({ ...p, license_expiry: v }))} />
                            </div>
                        </div>
                    )}
                </div>

                {/* === Garanti / fideiussori solidali (max 3) === */}
                <div className="rounded-lg border border-theme-border mb-4 p-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-semibold text-theme-text-primary">Garante / Fideiussore</p>
                            <p className="text-xs text-theme-text-muted">Va nel contratto e firma anche lui. Fino a 3.</p>
                        </div>
                        {garanti.length < 3 && (
                            <button
                                type="button"
                                onClick={() => setGaranti(g => [...g, { ...GARANTE_VUOTO }])}
                                className="px-3 py-1.5 rounded-full bg-theme-bg-tertiary border border-theme-border text-xs font-semibold text-theme-text-primary hover:border-dr7-gold"
                            >
                                + Aggiungi garante
                            </button>
                        )}
                    </div>
                    {garanti.map((g, i) => (
                        <div key={i} className="mt-3 pt-3 border-t border-theme-border">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs uppercase tracking-wide text-theme-text-muted">Garante {i + 1}</span>
                                <button
                                    type="button"
                                    onClick={() => setGaranti(list => list.filter((_, j) => j !== i))}
                                    className="text-[#ff3b30] text-xs hover:underline"
                                >
                                    Rimuovi
                                </button>
                            </div>
                            <div className="mb-3">
                                <label className="block text-xs text-theme-text-muted mb-1">Cliente gia' registrato (facoltativo)</label>
                                <CustomerAutocomplete
                                    customers={customers}
                                    selectedCustomerId={''}
                                    onSelectCustomer={(id) => {
                                        if (!id) return
                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                        const c: any = customers.find((x: any) => x.id === id)
                                        setGaranti(l => l.map((x, j) => j === i ? {
                                            ...x,
                                            nome_cognome: c?.full_name || x.nome_cognome,
                                            email: c?.email || x.email,
                                            telefono: c?.phone || x.telefono,
                                        } : x))
                                        schedaCliente(id).then(sc => {
                                            if (!sc) return
                                            setGaranti(l => l.map((x, j) => j === i ? {
                                                ...x,
                                                nome_cognome: `${sc.nome} ${sc.cognome}`.trim() || x.nome_cognome,
                                                codice_fiscale: sc.codice_fiscale || x.codice_fiscale,
                                                sesso: sc.sesso || x.sesso,
                                                indirizzo: sc.indirizzo || x.indirizzo,
                                                cap: sc.cap || x.cap,
                                                citta: sc.citta || x.citta,
                                                provincia: sc.provincia || x.provincia,
                                                data_nascita: sc.data_nascita || x.data_nascita,
                                                citta_nascita: sc.luogo_nascita || x.citta_nascita,
                                                provincia_nascita: sc.provincia_nascita || x.provincia_nascita,
                                                telefono: sc.telefono || x.telefono,
                                                email: sc.email || x.email,
                                            } : x))
                                        })
                                    }}
                                    placeholder="Cerca per nome, email o telefono..."
                                />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <CampoModale label="Nome e cognome" value={g.nome_cognome} onChange={v => setGaranti(l => l.map((x, j) => j === i ? { ...x, nome_cognome: v } : x))} />
                                <CampoModale label="Codice fiscale" value={g.codice_fiscale} onChange={v => setGaranti(l => l.map((x, j) => j === i ? { ...x, codice_fiscale: v.toUpperCase() } : x))} />
                                <SessoModale value={g.sesso} onChange={v => setGaranti(l => l.map((x, j) => j === i ? { ...x, sesso: v } : x))} />
                                <CampoModale label="Data di nascita" type="date" value={g.data_nascita} onChange={v => setGaranti(l => l.map((x, j) => j === i ? { ...x, data_nascita: v } : x))} />
                                <CampoModale label="Citta di nascita" value={g.citta_nascita} onChange={v => setGaranti(l => l.map((x, j) => j === i ? { ...x, citta_nascita: v } : x))} />
                                <CampoModale label="Provincia di nascita" value={g.provincia_nascita} onChange={v => setGaranti(l => l.map((x, j) => j === i ? { ...x, provincia_nascita: v.toUpperCase() } : x))} maxLength={2} />
                                <CampoModale label="Indirizzo" value={g.indirizzo} onChange={v => setGaranti(l => l.map((x, j) => j === i ? { ...x, indirizzo: v } : x))} />
                                <CampoModale label="CAP" value={g.cap} onChange={v => setGaranti(l => l.map((x, j) => j === i ? { ...x, cap: v } : x))} />
                                <CampoModale label="Citta" value={g.citta} onChange={v => setGaranti(l => l.map((x, j) => j === i ? { ...x, citta: v } : x))} />
                                <CampoModale label="Provincia" value={g.provincia} onChange={v => setGaranti(l => l.map((x, j) => j === i ? { ...x, provincia: v.toUpperCase() } : x))} maxLength={2} />
                                <div>
                                    <label className="block text-xs text-theme-text-muted mb-1">Telefono</label>
                                    <TelefonoConPrefisso
                                        value={g.telefono}
                                        onChange={(v: string) => setGaranti(l => l.map((x, j) => j === i ? { ...x, telefono: v } : x))}
                                        className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:border-dr7-gold"
                                        selectClassName="bg-theme-bg-tertiary border border-theme-border rounded px-2 py-2 text-sm text-theme-text-primary"
                                        mostraAnteprima={false}
                                    />
                                </div>
                                <CampoModale label="Email" type="email" value={g.email} onChange={v => setGaranti(l => l.map((x, j) => j === i ? { ...x, email: v } : x))} />
                            </div>
                        </div>
                    ))}
                </div>

                {error && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded p-2 mb-3 text-red-300 text-sm">
                        {error}
                    </div>
                )}

                <div className="flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={() => setPreventivo(null)}
                        disabled={submitting}
                        className="px-4 py-2 text-sm text-theme-text-muted hover:text-theme-text-primary disabled:opacity-50"
                    >
                        Annulla
                    </button>
                    <button
                        type="button"
                        onClick={handleConfirm}
                        disabled={submitting || !customerId}
                        className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50"
                    >
                        {submitting ? 'Creo prenotazione…' : 'Conferma e crea prenotazione'}
                    </button>
                </div>
            </div>
        </div>
    )

    return createPortal(modal, document.body)
}

/**
 * Scheda cliente completa -> campi del modale. L'elenco del picker ha solo
 * nome/email/telefono (17 colonne, il resto pesava 5 MB): per codice fiscale,
 * indirizzo e patente si legge la riga vera, altrimenti la direzione doveva
 * ricopiare a mano dati che il gestionale ha gia'.
 */
async function schedaCliente(customerId: string): Promise<Record<string, string> | null> {
    try {
        const { data } = await supabase
            .from('customers_extended')
            .select('nome, cognome, email, telefono, codice_fiscale, sesso, indirizzo, numero_civico, codice_postale, citta_residenza, provincia_residenza, data_nascita, luogo_nascita, provincia_nascita, tipo_patente, numero_patente, emessa_da, data_rilascio_patente, scadenza_patente')
            .eq('id', customerId)
            .maybeSingle()
        if (!data) return null
        const c = data as Record<string, unknown>
        const testo = (v: unknown) => (v == null ? '' : String(v))
        const indirizzo = [testo(c.indirizzo), testo(c.numero_civico)].filter(Boolean).join(' ').trim()
        return {
            nome: testo(c.nome),
            cognome: testo(c.cognome),
            email: testo(c.email),
            telefono: testo(c.telefono),
            codice_fiscale: testo(c.codice_fiscale),
            sesso: testo(c.sesso),
            indirizzo,
            cap: testo(c.codice_postale),
            citta: testo(c.citta_residenza),
            provincia: testo(c.provincia_residenza),
            data_nascita: testo(c.data_nascita).slice(0, 10),
            luogo_nascita: testo(c.luogo_nascita),
            provincia_nascita: testo(c.provincia_nascita),
            tipo_patente: testo(c.tipo_patente),
            numero_patente: testo(c.numero_patente),
            emessa_da: testo(c.emessa_da),
            data_rilascio_patente: testo(c.data_rilascio_patente).slice(0, 10),
            scadenza_patente: testo(c.scadenza_patente).slice(0, 10),
        }
    } catch {
        return null
    }
}

/** Campo di testo compatto del modale (stessa grafica degli altri input qui). */
function CampoModale({
    label, value, onChange, type = 'text', maxLength,
}: {
    label: string
    value: string
    onChange: (v: string) => void
    type?: string
    maxLength?: number
}) {
    return (
        <label className="block">
            <span className="block text-xs text-theme-text-muted mb-1">{label}</span>
            <input
                type={type}
                value={value}
                maxLength={maxLength}
                onChange={(e) => onChange(e.target.value)}
                className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:border-dr7-gold"
            />
        </label>
    )
}

function SessoModale({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <label className="block">
            <span className="block text-xs text-theme-text-muted mb-1">Sesso</span>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:border-dr7-gold"
            >
                <option value="">Seleziona...</option>
                <option value="M">Maschio</option>
                <option value="F">Femmina</option>
            </select>
        </label>
    )
}

export default memo(PreventivoAcceptModal)
