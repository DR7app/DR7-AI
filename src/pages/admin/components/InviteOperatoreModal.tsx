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

const ALL_TAB_KEYS = PERMISSION_SECTIONS.flatMap(s => s.tabs.map(t => t.key))

const PRESETS: { name: string; permissions: string[] }[] = [
  { name: 'Tutto', permissions: ['*'] },
  { name: 'Solo Ore', permissions: ['rilevazione-orari'] },
  { name: 'Operatore standard', permissions: ALL_TAB_KEYS.filter(k => !['fattura', 'nexi', 'unpaid', 'cauzioni'].includes(k)) },
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

  const isWildcard = selected.has('*')

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
      // Toggling any specific permission while wildcard is on first clears wildcard.
      if (next.has('*') && key !== '*') next.delete('*')
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const applyPreset = (perms: string[]) => {
    setSelected(new Set(perms))
  }

  const isSelected = (key: string) => selected.has('*') || selected.has(key)

  const sectionToggle = (sectionTabs: { key: string }[]) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has('*')) {
        // Replace wildcard with the specific section being deselected from "all"
        next.delete('*')
        for (const k of ALL_TAB_KEYS) next.add(k)
      }
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
    if (isWildcard) return 'Accesso completo'
    const n = selected.size
    if (n === 0) return 'Nessun permesso'
    if (n === 1) return '1 permesso'
    return `${n} permessi`
  }, [isWildcard, selected])

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

          {/* Permission grid */}
          <div className="space-y-3">
            {PERMISSION_SECTIONS.map(section => {
              const allOn = section.tabs.every(t => isSelected(t.key))
              const someOn = !allOn && section.tabs.some(t => isSelected(t.key))
              return (
                <div key={section.name} className="border border-theme-border rounded-lg p-3 bg-theme-bg-secondary">
                  <div className="flex items-center justify-between mb-2">
                    <button
                      type="button"
                      onClick={() => sectionToggle(section.tabs)}
                      disabled={submitting || isWildcard}
                      className="text-sm font-semibold text-theme-text-primary hover:text-dr7-gold disabled:opacity-50"
                    >
                      {section.name}
                      <span className={`ml-2 text-[10px] uppercase tracking-wider ${allOn ? 'text-emerald-500' : someOn ? 'text-amber-500' : 'text-theme-text-muted'}`}>
                        {allOn ? 'tutti' : someOn ? 'parziale' : 'nessuno'}
                      </span>
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                    {section.tabs.map(t => (
                      <label key={t.key} className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer ${isSelected(t.key) ? 'bg-dr7-gold/10 text-theme-text-primary' : 'text-theme-text-secondary hover:bg-theme-bg-hover'}`}>
                        <input
                          type="checkbox"
                          checked={isSelected(t.key)}
                          onChange={() => togglePermission(t.key)}
                          disabled={submitting || isWildcard}
                          className="w-4 h-4 accent-dr7-gold"
                        />
                        <span>{t.label}</span>
                      </label>
                    ))}
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
