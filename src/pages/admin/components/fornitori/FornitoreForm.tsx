import { useState, useEffect } from 'react'
import { supabase } from '../../../../supabaseClient'
import Input from '../Input'
import Select from '../Select'
import Button from '../Button'
import type { Fornitore } from './types'

interface Props {
    fornitore?: Fornitore | null
    onClose: () => void
    onSaved: (f: Fornitore) => void
}

const CATEGORIE = [
    { value: '', label: '-- categoria --' },
    { value: 'carburante', label: 'Carburante' },
    { value: 'ricambi', label: 'Ricambi' },
    { value: 'manutenzione', label: 'Manutenzione' },
    { value: 'pneumatici', label: 'Pneumatici' },
    { value: 'lavaggio_prodotti', label: 'Prodotti lavaggio' },
    { value: 'pulizia', label: 'Pulizia' },
    { value: 'ufficio', label: 'Ufficio' },
    { value: 'utenze', label: 'Utenze' },
    { value: 'consulenze', label: 'Consulenze' },
    { value: 'noleggio_attrezzature', label: 'Noleggio attrezzature' },
    { value: 'altro', label: 'Altro' },
]

const CONDIZIONI = [
    { value: '', label: '-- condizioni --' },
    { value: 'contanti', label: 'Contanti' },
    { value: 'rb_30', label: 'RB 30 gg DF' },
    { value: 'rb_60', label: 'RB 60 gg DF' },
    { value: 'rb_90', label: 'RB 90 gg DF' },
    { value: 'bonifico_30', label: 'Bonifico 30 gg DF' },
    { value: 'bonifico_60', label: 'Bonifico 60 gg DF' },
    { value: 'bonifico_immediato', label: 'Bonifico immediato' },
    { value: 'rid_sdd', label: 'RID / SDD' },
    { value: 'altro', label: 'Altro' },
]

export default function FornitoreForm({ fornitore, onClose, onSaved }: Props) {
    const isEdit = !!fornitore
    const [saving, setSaving] = useState(false)
    const [data, setData] = useState({
        nome: fornitore?.nome || '',
        piva: fornitore?.piva || '',
        referente: fornitore?.referente || '',
        telefono: fornitore?.telefono || '',
        email: fornitore?.email || '',
        iban: fornitore?.iban || '',
        categoria_merce: fornitore?.categoria_merce || '',
        condizioni_pagamento: fornitore?.condizioni_pagamento || '',
        scadenza_default_giorni: fornitore?.scadenza_default_giorni?.toString() || '30',
        indirizzo: fornitore?.indirizzo || '',
        citta: fornitore?.citta || '',
        cap: fornitore?.cap || '',
        provincia: fornitore?.provincia || '',
        note: fornitore?.note || '',
        attivo: fornitore?.attivo ?? true,
    })

    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [onClose])

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!data.nome.trim()) {
            alert('Nome fornitore obbligatorio')
            return
        }
        setSaving(true)
        try {
            const payload = {
                nome: data.nome.trim(),
                piva: data.piva.trim() || null,
                referente: data.referente.trim() || null,
                telefono: data.telefono.trim() || null,
                email: data.email.trim() || null,
                iban: data.iban.trim() || null,
                categoria_merce: data.categoria_merce || null,
                condizioni_pagamento: data.condizioni_pagamento || null,
                scadenza_default_giorni: parseInt(data.scadenza_default_giorni) || 30,
                indirizzo: data.indirizzo.trim() || null,
                citta: data.citta.trim() || null,
                cap: data.cap.trim() || null,
                provincia: data.provincia.trim() || null,
                note: data.note.trim() || null,
                attivo: data.attivo,
            }

            if (isEdit && fornitore) {
                const { data: row, error } = await supabase
                    .from('fornitori')
                    .update(payload)
                    .eq('id', fornitore.id)
                    .select()
                    .single()
                if (error) throw error
                onSaved(row as Fornitore)
            } else {
                const { data: row, error } = await supabase
                    .from('fornitori')
                    .insert(payload)
                    .select()
                    .single()
                if (error) throw error
                onSaved(row as Fornitore)
            }
            onClose()
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            alert('Errore salvataggio: ' + msg)
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
            <div className="bg-theme-bg-secondary rounded-lg border border-theme-border max-w-3xl w-full max-h-[90vh] overflow-auto p-6"
                onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-semibold text-theme-text-primary">
                        {isEdit ? 'Modifica Fornitore' : 'Nuovo Fornitore'}
                    </h3>
                    <button onClick={onClose} className="text-theme-text-muted text-2xl leading-none hover:text-theme-text-primary">×</button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Input label="Nome / Ragione sociale *" required value={data.nome}
                            onChange={e => setData({ ...data, nome: e.target.value })} placeholder="Es: Pneumatici Rossi SRL" />
                        <Input label="P.IVA" value={data.piva}
                            onChange={e => setData({ ...data, piva: e.target.value })} placeholder="01234567890" />
                        <Input label="Referente" value={data.referente}
                            onChange={e => setData({ ...data, referente: e.target.value })} placeholder="Nome cognome" />
                        <Input label="Telefono" value={data.telefono}
                            onChange={e => setData({ ...data, telefono: e.target.value })} />
                        <Input label="Email" type="email" value={data.email}
                            onChange={e => setData({ ...data, email: e.target.value })} />
                        <Input label="IBAN" value={data.iban}
                            onChange={e => setData({ ...data, iban: e.target.value })} placeholder="IT60 X054 2811 1010 0000 0123 456" />
                        <Select label="Categoria merce" value={data.categoria_merce}
                            onChange={e => setData({ ...data, categoria_merce: e.target.value })}
                            options={CATEGORIE} />
                        <Select label="Condizioni pagamento" value={data.condizioni_pagamento}
                            onChange={e => setData({ ...data, condizioni_pagamento: e.target.value })}
                            options={CONDIZIONI} />
                        <Input label="Scadenza default (giorni dalla data fattura)" type="number" min="0"
                            value={data.scadenza_default_giorni}
                            onChange={e => setData({ ...data, scadenza_default_giorni: e.target.value })} />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="md:col-span-2">
                            <Input label="Indirizzo" value={data.indirizzo}
                                onChange={e => setData({ ...data, indirizzo: e.target.value })} />
                        </div>
                        <Input label="Città" value={data.citta}
                            onChange={e => setData({ ...data, citta: e.target.value })} />
                        <div className="grid grid-cols-2 gap-2">
                            <Input label="CAP" value={data.cap}
                                onChange={e => setData({ ...data, cap: e.target.value })} />
                            <Input label="Prov." value={data.provincia}
                                onChange={e => setData({ ...data, provincia: e.target.value })} maxLength={2} />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm text-theme-text-secondary mb-1">Note</label>
                        <textarea
                            value={data.note}
                            onChange={e => setData({ ...data, note: e.target.value })}
                            rows={3}
                            className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
                            placeholder="Note libere sul fornitore"
                        />
                    </div>

                    <label className="flex items-center gap-2 text-sm text-theme-text-primary">
                        <input type="checkbox" checked={data.attivo} onChange={e => setData({ ...data, attivo: e.target.checked })} />
                        Fornitore attivo
                    </label>

                    <div className="flex justify-end gap-2 pt-4 border-t border-theme-border">
                        <Button type="button" variant="secondary" onClick={onClose}>Annulla</Button>
                        <Button type="submit" disabled={saving}>{saving ? 'Salvataggio…' : (isEdit ? 'Aggiorna' : 'Crea')}</Button>
                    </div>
                </form>
            </div>
        </div>
    )
}
