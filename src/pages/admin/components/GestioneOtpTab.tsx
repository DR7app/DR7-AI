/**
 * GestioneOtpTab
 *
 * Top-level admin tab listing every OTP-protected limitation override.
 * Admin can toggle is_required per row → useLimitationOverride hook
 * auto-bypasses disabled codes on next request. Realtime sub keeps
 * every open browser session in sync.
 */
import { useEffect, useState } from 'react'
import { supabase } from '../../../supabaseClient'
import toast from 'react-hot-toast'
import { reloadOtpConfig } from '../../../utils/otpConfigCache'

interface OtpRow {
    id: string
    label: string
    reason: string
    used_in: string
    is_required: boolean
    sort_order: number
}

export default function GestioneOtpTab() {
    const [rows, setRows] = useState<OtpRow[]>([])
    const [loading, setLoading] = useState(true)
    const [savingId, setSavingId] = useState<string | null>(null)
    const [editing, setEditing] = useState<Record<string, Partial<OtpRow>>>({})
    const [showCreate, setShowCreate] = useState(false)
    const [creating, setCreating] = useState(false)
    const [newRow, setNewRow] = useState<{ id: string; label: string; used_in: string; reason: string }>({
        id: '', label: '', used_in: '', reason: '',
    })

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            const { data, error } = await supabase
                .from('system_otp_overrides')
                .select('*')
                .order('sort_order', { ascending: true })
            if (cancelled) return
            if (error) {
                toast.error('Errore caricamento OTP: ' + error.message)
            } else {
                setRows((data || []) as OtpRow[])
            }
            setLoading(false)
        })()
        const channel = supabase
            .channel('gestione-otp-overrides')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'system_otp_overrides' }, async () => {
                const { data } = await supabase
                    .from('system_otp_overrides')
                    .select('*')
                    .order('sort_order', { ascending: true })
                if (!cancelled) setRows((data || []) as OtpRow[])
            })
            .subscribe()
        return () => { cancelled = true; supabase.removeChannel(channel) }
    }, [])

    const setField = (id: string, key: keyof OtpRow, value: OtpRow[keyof OtpRow]) => {
        setEditing(prev => ({ ...prev, [id]: { ...prev[id], [key]: value } }))
    }

    const valueOf = <K extends keyof OtpRow>(row: OtpRow, key: K): OtpRow[K] => {
        const e = editing[row.id]?.[key]
        return (e !== undefined ? e : row[key]) as OtpRow[K]
    }

    const isDirty = (row: OtpRow): boolean => {
        const e = editing[row.id]
        if (!e) return false
        return Object.keys(e).some(k => e[k as keyof OtpRow] !== row[k as keyof OtpRow])
    }

    const save = async (row: OtpRow) => {
        const e = editing[row.id]
        if (!e) return
        setSavingId(row.id)
        const { error } = await supabase
            .from('system_otp_overrides')
            .update({ ...e, updated_at: new Date().toISOString() })
            .eq('id', row.id)
        setSavingId(null)
        if (error) {
            toast.error('Salvataggio fallito: ' + error.message)
            return
        }
        toast.success('Salvato')
        setRows(prev => prev.map(r => (r.id === row.id ? ({ ...r, ...e } as OtpRow) : r)))
        setEditing(prev => { const n = { ...prev }; delete n[row.id]; return n })
        await reloadOtpConfig()
    }

    const toggleRequired = async (row: OtpRow) => {
        const next = !row.is_required
        setSavingId(row.id)
        const { error } = await supabase
            .from('system_otp_overrides')
            .update({ is_required: next, updated_at: new Date().toISOString() })
            .eq('id', row.id)
        setSavingId(null)
        if (error) {
            toast.error('Toggle fallito: ' + error.message)
            return
        }
        setRows(prev => prev.map(r => (r.id === row.id ? { ...r, is_required: next } : r)))
        await reloadOtpConfig()
    }

    const slugifyId = (raw: string) =>
        raw.toLowerCase().trim().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80)

    const createNew = async () => {
        const id = slugifyId(newRow.id || newRow.label)
        if (!id) { toast.error('Inserisci un ID o una label'); return }
        if (!newRow.label.trim()) { toast.error('Inserisci una label'); return }
        if (rows.some(r => r.id === id)) { toast.error(`OTP con id "${id}" esiste già`); return }
        setCreating(true)
        const maxOrder = rows.reduce((m, r) => Math.max(m, r.sort_order || 0), 0)
        const { error } = await supabase
            .from('system_otp_overrides')
            .insert({
                id,
                label: newRow.label.trim(),
                used_in: newRow.used_in.trim() || '—',
                reason: newRow.reason.trim() || '—',
                is_required: true,
                sort_order: maxOrder + 10,
            })
        setCreating(false)
        if (error) {
            toast.error('Creazione fallita: ' + error.message)
            return
        }
        toast.success(`OTP "${id}" creato`)
        setNewRow({ id: '', label: '', used_in: '', reason: '' })
        setShowCreate(false)
        await reloadOtpConfig()
    }

    const removeRow = async (row: OtpRow) => {
        if (!confirm(`Eliminare l'OTP "${row.label}" (${row.id})?\n\nLa limitazione corrispondente non verrà più protetta da OTP nel codice che la richiede.`)) return
        setSavingId(row.id)
        const { error } = await supabase
            .from('system_otp_overrides')
            .delete()
            .eq('id', row.id)
        setSavingId(null)
        if (error) {
            toast.error('Eliminazione fallita: ' + error.message)
            return
        }
        toast.success('Eliminato')
        setRows(prev => prev.filter(r => r.id !== row.id))
        await reloadOtpConfig()
    }

    const requiredCount = rows.filter(r => r.is_required).length
    const disabledCount = rows.length - requiredCount

    return (
        <div className="space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h2 className="text-xl font-semibold text-theme-text-primary">Gestione OTP</h2>
                    <p className="text-sm text-theme-text-muted mt-1 max-w-2xl">
                        Controlla quali blocchi di sistema richiedono autorizzazione OTP del direttore.
                        Disattivare un OTP fa sì che la limitazione venga superata automaticamente la prossima volta che si verifica.
                    </p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                    <span className="px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/30 text-green-400">{requiredCount} OTP attivi</span>
                    <span className="px-3 py-1.5 rounded-full bg-theme-bg-tertiary border border-theme-border text-theme-text-muted">{disabledCount} disattivati</span>
                    <button
                        type="button"
                        onClick={() => setShowCreate(v => !v)}
                        className="px-3 py-1.5 rounded-full bg-dr7-gold text-white font-semibold hover:opacity-90"
                    >
                        {showCreate ? 'Annulla' : '+ Aggiungi OTP'}
                    </button>
                </div>
            </div>

            {showCreate && (
                <div className="rounded-lg border border-dr7-gold/30 bg-dr7-gold/5 p-4 space-y-3">
                    <h3 className="text-sm font-semibold text-theme-text-primary">Nuovo OTP</h3>
                    <p className="text-xs text-theme-text-muted">
                        L'OTP viene salvato come riga in <code className="bg-theme-bg-tertiary px-1 rounded">system_otp_overrides</code>.
                        Per attivarsi su un'azione admin il codice deve chiamare <code className="bg-theme-bg-tertiary px-1 rounded">requestOverride('{newRow.id || 'tuo_id'}', '...')</code> nel relativo punto del frontend.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="text-xs text-theme-text-muted">
                            ID univoco (snake_case)
                            <input
                                type="text"
                                value={newRow.id}
                                onChange={e => setNewRow(r => ({ ...r, id: e.target.value }))}
                                placeholder="es. blocca_modifica_dopo_pagamento"
                                className="mt-1 w-full px-2 py-1.5 rounded bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm"
                            />
                        </label>
                        <label className="text-xs text-theme-text-muted">
                            Label (mostrata nel modal OTP)
                            <input
                                type="text"
                                value={newRow.label}
                                onChange={e => setNewRow(r => ({ ...r, label: e.target.value }))}
                                placeholder="es. Modifica dopo pagamento"
                                className="mt-1 w-full px-2 py-1.5 rounded bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm"
                            />
                        </label>
                        <label className="text-xs text-theme-text-muted sm:col-span-2">
                            Dove suona
                            <input
                                type="text"
                                value={newRow.used_in}
                                onChange={e => setNewRow(r => ({ ...r, used_in: e.target.value }))}
                                placeholder="es. Tab Prenotazioni > tasto Modifica"
                                className="mt-1 w-full px-2 py-1.5 rounded bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm"
                            />
                        </label>
                        <label className="text-xs text-theme-text-muted sm:col-span-2">
                            Motivo (mostrato all'admin che chiede l'OTP)
                            <textarea
                                rows={2}
                                value={newRow.reason}
                                onChange={e => setNewRow(r => ({ ...r, reason: e.target.value }))}
                                placeholder="es. Modificare un noleggio dopo l'incasso richiede approvazione direzionale."
                                className="mt-1 w-full px-2 py-1.5 rounded bg-theme-bg-primary border border-theme-border text-theme-text-secondary text-sm"
                            />
                        </label>
                    </div>
                    <div className="flex justify-end gap-2">
                        <button
                            onClick={() => { setShowCreate(false); setNewRow({ id: '', label: '', used_in: '', reason: '' }) }}
                            disabled={creating}
                            className="px-3 py-1.5 rounded-full text-xs font-medium bg-theme-bg-tertiary text-theme-text-muted hover:text-theme-text-primary"
                        >
                            Annulla
                        </button>
                        <button
                            onClick={createNew}
                            disabled={creating}
                            className="px-3 py-1.5 rounded-full text-xs font-semibold bg-dr7-gold text-white hover:opacity-90 disabled:opacity-50"
                        >
                            {creating ? 'Creazione…' : 'Crea OTP'}
                        </button>
                    </div>
                </div>
            )}

            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-300">
                ⚠ Disattivare un OTP riduce la sicurezza: la limitazione corrispondente verrà bypassata silenziosamente.
                L’azione resta tracciata nel log audit (con flag <code className="bg-theme-bg-tertiary px-1 rounded">limitation_override_bypassed</code>).
            </div>

            {loading ? (
                <p className="text-sm text-theme-text-muted">Caricamento…</p>
            ) : rows.length === 0 ? (
                <div className="p-4 rounded-lg border border-amber-500/30 bg-amber-500/5 text-sm text-amber-300">
                    Nessuna riga in <code>system_otp_overrides</code>. Esegui la migration{' '}
                    <code className="bg-theme-bg-tertiary px-1 rounded">20260428_system_otp_overrides.sql</code> in Supabase.
                </div>
            ) : (
                <ul className="space-y-3">
                    {rows.map(row => {
                        const dirty = isDirty(row)
                        const saving = savingId === row.id
                        const required = valueOf(row, 'is_required')
                        return (
                            <li key={row.id} className={`rounded-lg border p-4 ${required ? 'border-theme-border bg-theme-bg-tertiary/40' : 'border-theme-border/40 bg-theme-bg-tertiary/10'}`}>
                                <div className="flex items-start justify-between gap-3 mb-3">
                                    <div className="flex-1 min-w-0">
                                        <input
                                            type="text"
                                            value={String(valueOf(row, 'label'))}
                                            onChange={e => setField(row.id, 'label', e.target.value)}
                                            className="w-full bg-transparent text-sm font-semibold text-theme-text-primary border-b border-transparent focus:border-dr7-gold focus:outline-none px-0 py-0.5"
                                        />
                                        <span className="text-[10px] uppercase tracking-wider text-theme-text-muted">{row.id}</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => toggleRequired(row)}
                                        disabled={saving}
                                        aria-label={required ? 'Disattiva OTP' : 'Attiva OTP'}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${required ? 'bg-dr7-gold' : 'bg-theme-bg-secondary border border-theme-border'} ${saving ? 'opacity-50 cursor-wait' : ''}`}
                                    >
                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${required ? 'translate-x-6' : 'translate-x-1'}`} />
                                    </button>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-y-1.5 gap-x-3 text-xs items-start">
                                    <span className="text-theme-text-muted">Dove suona</span>
                                    <input
                                        type="text"
                                        value={String(valueOf(row, 'used_in'))}
                                        onChange={e => setField(row.id, 'used_in', e.target.value)}
                                        className="w-full px-2 py-1 rounded bg-theme-bg-primary border border-theme-border text-theme-text-primary"
                                    />

                                    <span className="text-theme-text-muted">Motivo OTP</span>
                                    <textarea
                                        value={String(valueOf(row, 'reason'))}
                                        onChange={e => setField(row.id, 'reason', e.target.value)}
                                        rows={2}
                                        className="w-full px-2 py-1 rounded bg-theme-bg-primary border border-theme-border text-theme-text-secondary"
                                    />
                                </div>

                                <div className="mt-3 flex items-center justify-between gap-2">
                                    <button
                                        onClick={() => removeRow(row)}
                                        disabled={saving}
                                        className="px-3 py-1.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 disabled:opacity-50"
                                    >
                                        Elimina
                                    </button>
                                    {dirty && (
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => setEditing(prev => { const n = { ...prev }; delete n[row.id]; return n })}
                                                disabled={saving}
                                                className="px-3 py-1.5 rounded-full text-xs font-medium bg-theme-bg-tertiary text-theme-text-muted hover:text-theme-text-primary"
                                            >
                                                Annulla
                                            </button>
                                            <button
                                                onClick={() => save(row)}
                                                disabled={saving}
                                                className="px-3 py-1.5 rounded-full text-xs font-semibold bg-dr7-gold text-white hover:opacity-90 disabled:opacity-50"
                                            >
                                                {saving ? 'Salvataggio…' : 'Salva'}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </li>
                        )
                    })}
                </ul>
            )}
        </div>
    )
}
