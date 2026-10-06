// 2026-07-13: Calendario Immondizia — gestione ritiri raccolta differenziata
// (ricorrenti settimanali o date specifiche) + promemoria serale (cron
// immondizia-reminder-cron). Coordinato col calendario dell'operatore.
import { useState, useEffect } from 'react'
import { ScheletroTabella } from '../../../components/Scheletro'
import { supabase } from '../../../supabaseClient'
import toast from 'react-hot-toast'
import EuropeanDateInput from '../../../components/EuropeanDateInput'

interface ImmondiziaRule {
  id: string
  tipo_rifiuto: string
  mode: 'weekly' | 'date'
  day_of_week: number | null
  pickup_date: string | null
  reminder_enabled: boolean
  active: boolean
  note: string | null
}

// Messaggio WhatsApp del ritiro: e' una ricorrenza di Messaggi di Sistema Pro
// (trigger on_schedule). Qui si modifica la stessa riga, senza passare dalla
// tab Pro: testo, giorni, ora, destinatari e acceso/spento.
interface MessaggioRitiro {
  id: string
  label: string
  message_body: string
  is_enabled: boolean
  target_days_of_week: string | null
  send_hour: number | null
  send_minute: number | null
  recipient_phones: string | null
}

// Lunedi' per primo, come in un calendario; il valore resta 0 = domenica.
const ORDINE_GIORNI = [1, 2, 3, 4, 5, 6, 0]

const GIORNI = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato']
const TIPI_RIFIUTO = ['Organico', 'Plastica/Lattine', 'Carta/Cartone', 'Vetro', 'Secco/Indifferenziato', 'Ingombranti', 'Verde/Sfalci']

export default function ImmondiziaTab() {
  const [rules, setRules] = useState<ImmondiziaRule[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // form
  const [tipo, setTipo] = useState(TIPI_RIFIUTO[0])
  const [mode, setMode] = useState<'weekly' | 'date'>('weekly')
  const [dow, setDow] = useState(1) // Lunedì
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')

  const load = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('immondizia_calendario')
      .select('*')
      .order('mode', { ascending: true })
      .order('day_of_week', { ascending: true })
      .order('pickup_date', { ascending: true })
    if (error) { toast.error('Errore caricamento: ' + error.message); setRules([]) }
    else setRules((data || []) as ImmondiziaRule[])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const [messaggi, setMessaggi] = useState<MessaggioRitiro[]>([])
  const [salvataggioMsg, setSalvataggioMsg] = useState<string | null>(null)
  const caricaMessaggi = async () => {
    const { data, error } = await supabase
      .from('system_messages')
      .select('id, label, message_body, is_enabled, target_days_of_week, send_hour, send_minute, recipient_phones')
      .eq('trigger_event', 'on_schedule')
      .or('label.ilike.%spazzatura%,label.ilike.%immondizia%,label.ilike.%rifiut%,message_key.ilike.%spazzatura%,message_key.ilike.%immondizia%')
      .order('label', { ascending: true })
    if (error) { toast.error('Errore caricamento messaggio: ' + error.message); return }
    setMessaggi((data || []) as MessaggioRitiro[])
  }
  useEffect(() => { caricaMessaggi() }, [])

  const modificaMsg = (id: string, campi: Partial<MessaggioRitiro>) =>
    setMessaggi(prev => prev.map(m => m.id === id ? { ...m, ...campi } : m))

  const giorniDi = (m: MessaggioRitiro) =>
    String(m.target_days_of_week ?? '').split(',').map(x => x.trim()).filter(x => x !== '').map(Number)

  const toggleGiorno = (m: MessaggioRitiro, g: number) => {
    const attuali = giorniDi(m)
    const nuovi = attuali.includes(g) ? attuali.filter(x => x !== g) : [...attuali, g]
    modificaMsg(m.id, { target_days_of_week: nuovi.sort((a, b) => a - b).join(',') })
  }

  const salvaMessaggio = async (m: MessaggioRitiro) => {
    if (!m.message_body.trim()) { toast.error('Il testo del messaggio non puo\' essere vuoto'); return }
    if (giorniDi(m).length === 0) { toast.error('Seleziona almeno un giorno'); return }
    setSalvataggioMsg(m.id)
    const { data, error } = await supabase
      .from('system_messages')
      .update({
        message_body: m.message_body,
        is_enabled: m.is_enabled,
        target_days_of_week: m.target_days_of_week,
        send_hour: m.send_hour ?? 9,
        send_minute: m.send_minute ?? 0,
        recipient_phones: (m.recipient_phones || '').trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', m.id)
      .select('id')
    setSalvataggioMsg(null)
    if (error) { toast.error('Errore: ' + error.message); return }
    if (!data || data.length === 0) { toast.error('Nessuna riga aggiornata (permessi?)'); return }
    toast.success('Messaggio salvato')
    caricaMessaggi()
  }

  const add = async () => {
    if (mode === 'date' && !date) { toast.error('Seleziona una data'); return }
    setSaving(true)
    const { error } = await supabase.from('immondizia_calendario').insert({
      tipo_rifiuto: tipo,
      mode,
      day_of_week: mode === 'weekly' ? dow : null,
      pickup_date: mode === 'date' ? date : null,
      note: note.trim() || null,
    })
    setSaving(false)
    if (error) { toast.error('Errore: ' + error.message); return }
    toast.success('Ritiro aggiunto')
    setNote(''); setDate('')
    load()
  }

  const toggleActive = async (r: ImmondiziaRule) => {
    const { error } = await supabase.from('immondizia_calendario').update({ active: !r.active }).eq('id', r.id)
    if (error) { toast.error('Errore: ' + error.message); return }
    setRules(prev => prev.map(x => x.id === r.id ? { ...x, active: !x.active } : x))
  }
  const toggleReminder = async (r: ImmondiziaRule) => {
    const { error } = await supabase.from('immondizia_calendario').update({ reminder_enabled: !r.reminder_enabled }).eq('id', r.id)
    if (error) { toast.error('Errore: ' + error.message); return }
    setRules(prev => prev.map(x => x.id === r.id ? { ...x, reminder_enabled: !x.reminder_enabled } : x))
  }
  const remove = async (r: ImmondiziaRule) => {
    if (!confirm(`Eliminare il ritiro "${r.tipo_rifiuto}"?`)) return
    const { error } = await supabase.from('immondizia_calendario').delete().eq('id', r.id)
    if (error) { toast.error('Errore: ' + error.message); return }
    setRules(prev => prev.filter(x => x.id !== r.id))
  }

  const weekly = rules.filter(r => r.mode === 'weekly')
  const dates = rules.filter(r => r.mode === 'date')

  const describe = (r: ImmondiziaRule) =>
    r.mode === 'weekly'
      ? `Ogni ${GIORNI[r.day_of_week ?? 0]}`
      : (r.pickup_date ? new Date(r.pickup_date + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }) : '—')

  const RuleRow = ({ r }: { r: ImmondiziaRule }) => (
    <div className={`flex items-center justify-between gap-3 px-4 py-3 rounded-lg border ${r.active ? 'border-theme-border bg-theme-bg-secondary' : 'border-theme-border/50 bg-theme-bg-secondary/40 opacity-60'}`}>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-theme-text-primary truncate">{r.tipo_rifiuto}</div>
        <div className="text-xs text-theme-text-muted">{describe(r)}{r.note ? ` · ${r.note}` : ''}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button onClick={() => toggleReminder(r)} title="Promemoria serale del giorno prima"
          className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.reminder_enabled ? 'bg-emerald-600/20 text-emerald-400' : 'bg-gray-600/20 text-gray-400'}`}>
          {r.reminder_enabled ? 'Promemoria ON' : 'Promemoria OFF'}
        </button>
        <button onClick={() => toggleActive(r)} className={`w-10 h-5 rounded-full relative transition-colors ${r.active ? 'bg-green-500' : 'bg-gray-600'}`}>
          <span className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all ${r.active ? 'left-5' : 'left-0.5'}`} />
        </button>
        <button onClick={() => remove(r)} className="text-xs text-red-400 hover:text-red-300">Elimina</button>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl sm:text-3xl font-semibold text-theme-text-primary tracking-tight">Calendario Immondizia</h2>
        <p className="text-sm text-theme-text-muted mt-1">Ritiri raccolta differenziata + promemoria. Coordinato col calendario dell'operatore.</p>
      </div>

      {/* Aggiungi */}
      <div className="p-4 rounded-xl border border-theme-border bg-theme-bg-secondary space-y-3">
        <h3 className="text-sm font-semibold text-theme-text-primary">Aggiungi ritiro</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-theme-text-muted block mb-1">Tipo rifiuto</label>
            <select value={tipo} onChange={e => setTipo(e.target.value)} className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary">
              {TIPI_RIFIUTO.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-theme-text-muted block mb-1">Ricorrenza</label>
            <select value={mode} onChange={e => setMode(e.target.value as 'weekly' | 'date')} className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary">
              <option value="weekly">Settimanale (giorno fisso)</option>
              <option value="date">Data specifica</option>
            </select>
          </div>
          {mode === 'weekly' ? (
            <div>
              <label className="text-xs text-theme-text-muted block mb-1">Giorno</label>
              <select value={dow} onChange={e => setDow(Number(e.target.value))} className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary">
                {GIORNI.map((g, i) => <option key={i} value={i}>{g}</option>)}
              </select>
            </div>
          ) : (
            <div>
              <label className="text-xs text-theme-text-muted block mb-1">Data</label>
              <EuropeanDateInput value={date} onChange={(__v: string) => setDate(__v)} className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary" />
            </div>
          )}
          <div>
            <label className="text-xs text-theme-text-muted block mb-1">Note (opzionale)</label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="es. esporre entro le 6:00" className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary" />
          </div>
        </div>
        <button onClick={add} disabled={saving} className="px-4 py-2 rounded-lg bg-dr7-gold text-black text-sm font-semibold disabled:opacity-50">
          {saving ? 'Salvataggio…' : '+ Aggiungi ritiro'}
        </button>
      </div>

      {/* Messaggio WhatsApp del ritiro */}
      <div className="p-4 rounded-xl border border-theme-border bg-theme-bg-secondary space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-theme-text-primary">Messaggio WhatsApp del ritiro</h3>
          <p className="text-xs text-theme-text-muted mt-0.5">Lo stesso messaggio di Messaggi di Sistema Pro: le modifiche fatte qui valgono anche li'.</p>
        </div>
        {messaggi.length === 0 ? (
          <p className="text-xs text-theme-text-muted">Nessun messaggio programmato collegato. Crealo in Messaggi di Sistema Pro come ricorrenza con "spazzatura" nel titolo.</p>
        ) : messaggi.map(m => (
          <div key={m.id} className="space-y-3 p-3 rounded-lg border border-theme-border bg-theme-bg-tertiary/40">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-theme-text-primary truncate">{m.label}</div>
              <button onClick={() => modificaMsg(m.id, { is_enabled: !m.is_enabled })} title={m.is_enabled ? 'Invio attivo' : 'Invio spento'}
                className={`w-10 h-5 rounded-full relative transition-colors shrink-0 ${m.is_enabled ? 'bg-green-500' : 'bg-gray-600'}`}>
                <span className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all ${m.is_enabled ? 'left-5' : 'left-0.5'}`} />
              </button>
            </div>
            <div>
              <label className="text-xs text-theme-text-muted block mb-1">Testo</label>
              <textarea value={m.message_body} onChange={e => modificaMsg(m.id, { message_body: e.target.value })} rows={7}
                className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary" />
            </div>
            <div>
              <label className="text-xs text-theme-text-muted block mb-1">Giorni di invio</label>
              <div className="flex flex-wrap gap-1.5">
                {ORDINE_GIORNI.map(g => {
                  const on = giorniDi(m).includes(g)
                  return (
                    <button key={g} onClick={() => toggleGiorno(m, g)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium border ${on ? 'bg-dr7-gold text-black border-dr7-gold' : 'bg-theme-bg-tertiary text-theme-text-muted border-theme-border'}`}>
                      {GIORNI[g]}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-theme-text-muted block mb-1">Ora di invio (Roma)</label>
                <div className="flex items-center gap-1">
                  <select value={m.send_hour ?? 9} onChange={e => modificaMsg(m.id, { send_hour: Number(e.target.value) })}
                    className="bg-theme-bg-tertiary border border-theme-border rounded-lg px-2 py-2 text-sm text-theme-text-primary">
                    {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}</option>)}
                  </select>
                  <span className="text-sm text-theme-text-muted">:</span>
                  <select value={m.send_minute ?? 0} onChange={e => modificaMsg(m.id, { send_minute: Number(e.target.value) })}
                    className="bg-theme-bg-tertiary border border-theme-border rounded-lg px-2 py-2 text-sm text-theme-text-primary">
                    {Array.from({ length: 12 }, (_, i) => i * 5).map(x => <option key={x} value={x}>{String(x).padStart(2, '0')}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-theme-text-muted block mb-1">Destinatari (telefoni, separati da virgola)</label>
                <input value={m.recipient_phones ?? ''} onChange={e => modificaMsg(m.id, { recipient_phones: e.target.value })}
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary" />
              </div>
            </div>
            <button onClick={() => salvaMessaggio(m)} disabled={salvataggioMsg === m.id}
              className="px-4 py-2 rounded-lg bg-dr7-gold text-black text-sm font-semibold disabled:opacity-50">
              {salvataggioMsg === m.id ? 'Salvataggio…' : 'Salva messaggio'}
            </button>
          </div>
        ))}
      </div>

      {loading ? (
        <ScheletroTabella righe={6} colonne={4} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h3 className="text-sm font-bold text-theme-text-primary mb-2">Ritiri settimanali</h3>
            <div className="space-y-2">
              {weekly.length === 0 ? <p className="text-xs text-theme-text-muted">Nessun ritiro settimanale.</p> : weekly.map(r => <RuleRow key={r.id} r={r} />)}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-bold text-theme-text-primary mb-2">Date specifiche</h3>
            <div className="space-y-2">
              {dates.length === 0 ? <p className="text-xs text-theme-text-muted">Nessuna data specifica.</p> : dates.map(r => <RuleRow key={r.id} r={r} />)}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
