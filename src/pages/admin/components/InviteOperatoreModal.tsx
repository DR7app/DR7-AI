import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import Button from './Button'
import Input from './Input'

// Permission catalog grouped by section. Mirrors the navigation structure
// in AdminDashboard.tsx so the toggles match what the operator will see in
// the sidebar after they accept the invite.
const PERMISSION_SECTIONS: { name: string; tabs: { key: string; label: string }[] }[] = [
  { name: 'Noleggio', tabs: [
    { key: 'reservations', label: 'Prenotazioni / Preventivi' },
    { key: 'calendar', label: 'Calendario' },
    { key: 'contratto', label: 'Contratti' },
    { key: 'gestione-danni', label: 'Danni & Penali' },
    { key: 'gestione-multe', label: 'Multe' },
    { key: 'cargos', label: 'Cargos' },
  ]},
  { name: 'Prime Wash', tabs: [
    { key: 'carwash', label: 'Prenotazioni' },
    { key: 'carwash-calendar', label: 'Calendario' },
    { key: 'carwash-catalog', label: 'Catalogo' },
  ]},
  { name: 'Flotta', tabs: [
    { key: 'vehicles', label: 'Veicoli' },
    { key: 'fleet', label: 'Gestione Flotta' },
    { key: 'gps-keyless', label: 'GPS & Keyless' },
  ]},
  { name: 'Clienti', tabs: [
    { key: 'customers', label: 'Lead' },
    { key: 'customer-wallet', label: 'Credit Wallet' },
    { key: 'site-users', label: 'Iscritti al Sito' },
  ]},
  { name: 'Marketing', tabs: [
    { key: 'birthdays', label: 'Compleanni' },
    { key: 'reviews', label: 'Recensioni' },
    { key: 'marketing-pro', label: 'Messaggi di Sistema Pro' },
    { key: 'campagna-marketing', label: 'Campagna Marketing' },
    { key: 'referral', label: 'Referral' },
    { key: 'codice-sconto', label: 'Codice Sconto' },
    { key: 'maxi-promo-gap', label: 'Maxi Promo Gap' },
    { key: 'promo-incassi', label: 'Promo Incassi' },
  ]},
  { name: 'Report', tabs: [
    { key: 'report-noleggio', label: 'Noleggio' },
    { key: 'report-lavaggio', label: 'Lavaggio' },
    { key: 'report-clienti', label: 'Clienti' },
    { key: 'report-penali-danni', label: 'Penali & Danni' },
    { key: 'report-preventivi', label: 'Preventivi' },
    { key: 'report-traffic', label: 'Rendimento Sito' },
    { key: 'operatori', label: 'Operatori' },
    { key: 'rilevazione-orari', label: 'Rilevazione Orari (Ore)' },
    { key: 'dashboard-kpi', label: 'Dashboard' },
  ]},
  { name: 'Comunicazione', tabs: [
    { key: 'com-email', label: 'E-mail' },
    { key: 'com-pec', label: 'PEC' },
    { key: 'com-whatsapp', label: 'WhatsApp' },
    { key: 'com-sms', label: 'SMS' },
    { key: 'com-chiamate', label: 'Chiamate' },
    { key: 'com-chatgpt', label: 'Chat GPT' },
    { key: 'com-aruba', label: 'Aruba' },
  ]},
  { name: 'Amministrazione', tabs: [
    { key: 'unpaid', label: 'In attesa di pagamento' },
    { key: 'cauzioni', label: 'Cauzioni' },
    { key: 'scadenze', label: 'Scadenze' },
    { key: 'fattura', label: 'Fattura' },
    { key: 'fornitori', label: 'Fornitori' },
    { key: 'nexi', label: 'Nexi' },
    { key: 'gestione-otp', label: 'Gestione OTP' },
    { key: 'verifica-documenti', label: 'Verifica Documenti' },
  ]},
  { name: 'Centralina Pro', tabs: [
    { key: 'centralina-pro', label: 'Centralina Pro' },
  ]},
  { name: 'Trustera', tabs: [
    { key: 'trustera', label: 'Trustera' },
  ]},
  { name: 'E.M.T.N.', tabs: [
    { key: 'emtn', label: 'E.M.T.N.' },
  ]},
]

const PRESETS: { name: string; permissions: string[] }[] = [
  { name: 'Solo Ore', permissions: ['rilevazione-orari'] },
]

interface Props {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

export default function InviteOperatoreModal({ open, onClose, onCreated }: Props) {
  const [email, setEmail] = useState('')
  const [nome, setNome] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)

  const reset = () => {
    setEmail('')
    setNome('')
    setSelected(new Set())
    setSubmitting(false)
  }

  const handleClose = () => {
    if (submitting) return
    reset()
    onClose()
  }

  const togglePermission = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const applyPreset = (perms: string[]) => {
    setSelected(new Set(perms))
  }

  const isSelected = (key: string) => selected.has(key)

  const sectionToggle = (sectionTabs: { key: string }[]) => {
    setSelected(prev => {
      const next = new Set(prev)
      const allOn = sectionTabs.every(t => next.has(t.key))
      if (allOn) {
        for (const t of sectionTabs) next.delete(t.key)
      } else {
        for (const t of sectionTabs) next.add(t.key)
      }
      return next
    })
  }

  const submit = async () => {
    const trimmedEmail = email.trim().toLowerCase()
    const trimmedNome = nome.trim()

    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      toast.error('Inserisci una email valida')
      return
    }
    if (!trimmedNome) {
      toast.error('Inserisci il nome')
      return
    }
    const permissions = Array.from(selected)
    if (permissions.length === 0) {
      toast.error('Seleziona almeno un permesso')
      return
    }

    setSubmitting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const accessToken = session?.access_token
      if (!accessToken) throw new Error('Sessione non valida')

      const res = await fetch('/.netlify/functions/invite-operator', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ email: trimmedEmail, nome: trimmedNome, permissions }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Invio invito fallito')

      toast.success(`Invito inviato a ${trimmedEmail}`)
      reset()
      onCreated()
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const summary = useMemo(() => {
    const n = selected.size
    if (n === 0) return 'Nessun permesso'
    if (n === 1) return '1 permesso'
    return `${n} permessi`
  }, [selected])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-theme-bg-primary border border-theme-border rounded-xl w-full max-w-3xl my-8 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-theme-border">
          <div>
            <h3 className="text-xl font-bold text-theme-text-primary">Aggiungi Operatore</h3>
            <p className="text-xs text-theme-text-muted mt-0.5">L'invitato riceve una email per impostare la propria password.</p>
          </div>
          <button onClick={handleClose} className="text-theme-text-muted hover:text-theme-text-primary text-2xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nome@esempio.com"
              disabled={submitting}
            />
            <Input
              label="Nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Mario Rossi"
              disabled={submitting}
            />
          </div>

          {/* Presets */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-theme-text-muted">Preset:</span>
            {PRESETS.map(p => (
              <button
                key={p.name}
                type="button"
                onClick={() => applyPreset(p.permissions)}
                disabled={submitting}
                className="px-3 py-1 rounded-full text-xs border border-theme-border text-theme-text-secondary hover:border-dr7-gold hover:text-dr7-gold transition-colors disabled:opacity-50"
              >
                {p.name}
              </button>
            ))}
            <span className="ml-auto text-xs font-medium text-theme-text-secondary">{summary}</span>
          </div>

          {/* Permission toggles — one ON/OFF switch per tab. */}
          <div className="space-y-3">
            {PERMISSION_SECTIONS.map(section => {
              const allOn = section.tabs.every(t => isSelected(t.key))
              const someOn = !allOn && section.tabs.some(t => isSelected(t.key))
              return (
                <div key={section.name} className="border border-theme-border rounded-lg p-3 bg-theme-bg-secondary">
                  <button
                    type="button"
                    onClick={() => sectionToggle(section.tabs)}
                    disabled={submitting}
                    className="w-full flex items-center justify-between mb-2 text-left disabled:opacity-50"
                  >
                    <span className="text-sm font-semibold text-theme-text-primary">{section.name}</span>
                    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${allOn ? 'bg-emerald-500/20 text-emerald-500' : someOn ? 'bg-amber-500/20 text-amber-500' : 'bg-theme-bg-hover text-theme-text-muted'}`}>
                      {allOn ? 'tutti ON' : someOn ? 'parziale' : 'tutti OFF'}
                    </span>
                  </button>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                    {section.tabs.map(t => {
                      const on = isSelected(t.key)
                      return (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() => togglePermission(t.key)}
                          disabled={submitting}
                          className="flex items-center justify-between gap-2 px-2 py-2 rounded hover:bg-theme-bg-hover disabled:opacity-50 text-left"
                        >
                          <span className={`text-sm ${on ? 'text-theme-text-primary font-medium' : 'text-theme-text-secondary'}`}>{t.label}</span>
                          <span
                            className={`relative inline-flex flex-shrink-0 items-center w-10 h-5 rounded-full transition-colors ${on ? 'bg-emerald-500' : 'bg-theme-bg-hover border border-theme-border'}`}
                            aria-hidden="true"
                          >
                            <span className={`inline-block w-4 h-4 rounded-full bg-white shadow transform transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-theme-border">
          <Button onClick={handleClose} disabled={submitting} variant="secondary">Annulla</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? 'Invio...' : 'Invia invito'}
          </Button>
        </div>
      </div>
    </div>
  )
}
