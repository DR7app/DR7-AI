import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import Button from './Button'
import Input from './Input'

// Permission catalog grouped by section. Mirrors the navigation structure
// in AdminDashboard.tsx so the toggles match what the operator will see in
// the sidebar after they accept the invite.
export const PERMISSION_SECTIONS: { name: string; tabs: { key: string; label: string }[] }[] = [
  { name: 'Noleggio', tabs: [
    { key: 'reservations', label: 'Prenotazioni (lista + pagamenti)' },
    { key: 'reservations-preventivi', label: 'Preventivi (solo creazione, niente lista prenotazioni)' },
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
    // 'fleet' permission rimosso 2026-05-22: la tab Gestione Flotta
    // e' stata eliminata, niente da concedere.
    { key: 'gps-keyless', label: 'GPS Flotta' },
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
  ]},
  { name: 'Report', tabs: [
    { key: 'report-noleggio', label: 'Noleggio' },
    { key: 'report-lavaggio', label: 'Lavaggio' },
    { key: 'report-clienti', label: 'Clienti' },
    { key: 'report-penali-danni', label: 'Penali & Danni' },
    { key: 'report-preventivi', label: 'Preventivi' },
    { key: 'report-traffic', label: 'Rendimento Sito' },
    { key: 'report-gmb', label: 'Rendimento Google My Business' },
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
    { key: 'centralina-pro', label: 'Centralina Pro (accesso completo)' },
    { key: 'view-cauzioni-readonly', label: 'View Cauzioni readonly (solo Supercar / Hypercar / Exotic Cars, sola lettura)' },
  ]},
  { name: 'Trustera', tabs: [
    { key: 'trustera', label: 'Trustera' },
  ]},
  { name: 'E.M.T.N.', tabs: [
    { key: 'emtn', label: 'E.M.T.N.' },
  ]},
  // Ruoli speciali — gestiti da hasRole() in useAdminRole. Aggiungere qui
  // un nuovo flag richiede di leggere il tag corrispondente in qualche tab.
  // I ruoli sostituiscono le vecchie allowlist hardcoded (valerio/ilenia/ophe).
  { name: 'Ruoli speciali', tabs: [
    { key: 'role:direzione', label: 'Direzione (superuser, sblocca tutto)' },
    { key: 'role:developer', label: 'Developer (bypass OTP Gestione OTP)' },
    { key: 'role:payment-manager', label: 'Payment Manager (segna fatture pagate)' },
    { key: 'role:stipendio-editor', label: 'Stipendio Editor (Lavaggio)' },
    { key: 'role:sito-direzione', label: 'Sito CMS (no OTP per testi)' },
    { key: 'role:preventivi-admin', label: 'Preventivi Admin (flussi speciali)' },
  ]},
  // hide:X — nasconde elementi UI specifici per QUESTO operatore. Non
  // toglie permessi, toglie solo il bottone/pannello dalla sidebar/header.
  // Utile per collaboratori esterni che non devono vedere allarmi
  // operatore, "I miei orari" (tracciamento orari), ecc.
  { name: 'Nascondi UI (solo per questo operatore)', tabs: [
    { key: 'hide:allarmi', label: 'Nascondi blocco "Allarmi" in sidebar' },
    { key: 'hide:miei-orari', label: 'Nascondi pulsante "I miei orari"' },
    { key: 'hide:richieste-no-cauzione', label: 'Nascondi subtab "Richieste No Cauzione" in Preventivi' },
  ]},
]

const PRESETS: { name: string; permissions: string[] }[] = [
  { name: 'Solo Ore', permissions: ['rilevazione-orari'] },
  { name: 'Calendario + Preventivi', permissions: ['calendar', 'reservations-preventivi', 'hide:allarmi', 'hide:miei-orari', 'hide:richieste-no-cauzione'] },
  { name: 'Direzione (full)', permissions: ['*', 'role:direzione', 'role:payment-manager', 'role:stipendio-editor', 'role:sito-direzione', 'role:preventivi-admin'] },
]

interface Props {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

// Generate a temporary 12-char password admin can share with the operator.
// Mixed case + digits + safe symbols, excludes ambiguous chars (0/O/l/I).
function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&'
  let out = ''
  const arr = new Uint32Array(12)
  crypto.getRandomValues(arr)
  for (let i = 0; i < 12; i++) out += chars[arr[i] % chars.length]
  return out
}

interface CreatedCredentials {
  email: string
  password: string
  nome: string
}

export default function InviteOperatoreModal({ open, onClose, onCreated }: Props) {
  const [email, setEmail] = useState('')
  const [nome, setNome] = useState('')
  const [password, setPassword] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState<CreatedCredentials | null>(null)

  // Auto-generate a temp password when the modal opens for the first time
  // so admin doesn't have to think one up. Still editable.
  useEffect(() => {
    if (open && !password && !created) setPassword(generateTempPassword())
  }, [open, password, created])

  const reset = () => {
    setEmail('')
    setNome('')
    setPassword('')
    setSelected(new Set())
    setSubmitting(false)
    setCreated(null)
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
    const trimmedPassword = password.trim()
    // Temp password is mandatory: NO email-invite flow. Admin shares the
    // generated credentials directly with the operator (WhatsApp / SMS / call).
    if (!trimmedPassword || trimmedPassword.length < 8) {
      toast.error('La password temporanea deve avere almeno 8 caratteri')
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
        body: JSON.stringify({
          email: trimmedEmail,
          nome: trimmedNome,
          permissions,
          password: trimmedPassword,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Creazione operatore fallita')

      toast.success(`Operatore ${trimmedEmail} creato.`)
      // Show the credentials screen instead of closing immediately, so admin
      // can copy them and send them to the operator manually.
      setCreated({ email: trimmedEmail, password: trimmedPassword, nome: trimmedNome })
      onCreated()
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
            <h3 className="text-xl font-bold text-theme-text-primary">{created ? 'Operatore creato' : 'Aggiungi Operatore'}</h3>
            <p className="text-xs text-theme-text-muted mt-0.5">
              {created
                ? 'Account attivo. Condividi le credenziali con l\'operatore — potrà cambiare la password dal proprio profilo dopo il primo accesso.'
                : 'L\'account viene creato subito con una password temporanea (modificabile qui sotto). Niente email di invito: condividi tu email + password all\'operatore.'}
            </p>
          </div>
          <button onClick={handleClose} className="text-theme-text-muted hover:text-theme-text-primary text-2xl leading-none">×</button>
        </div>

        {/* Credentials screen — shown after successful creation */}
        {created && (() => {
          const adminUrl = (typeof window !== 'undefined' ? window.location.origin : 'https://admin.dr7empire.com')
          const credsText = `Ciao ${created.nome},\n\nEcco le tue credenziali DR7 Admin:\nLink: ${adminUrl}\nEmail: ${created.email}\nPassword: ${created.password}\n\nPotrai cambiare la password dal tuo profilo dopo il primo accesso.`
          return (
            <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 space-y-3">
                <div className="text-sm font-semibold text-emerald-400">Credenziali pronte da condividere</div>
                <div className="grid grid-cols-[80px_1fr] gap-2 text-sm">
                  <span className="text-theme-text-muted">Link:</span>
                  <code className="text-theme-text-primary break-all">{adminUrl}</code>
                  <span className="text-theme-text-muted">Email:</span>
                  <code className="text-theme-text-primary break-all">{created.email}</code>
                  <span className="text-theme-text-muted">Password:</span>
                  <code className="text-theme-text-primary break-all font-mono">{created.password}</code>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(credsText)
                    toast.success('Credenziali copiate')
                  }}
                  className="px-3 py-2 rounded-lg bg-dr7-gold text-black text-xs font-semibold hover:opacity-90"
                >
                  Copia messaggio completo
                </button>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(created.password)
                    toast.success('Password copiata')
                  }}
                  className="px-3 py-2 rounded-lg border border-theme-border text-xs text-theme-text-secondary hover:text-theme-text-primary"
                >
                  Copia solo password
                </button>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(credsText)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-2 rounded-lg border border-emerald-500/40 text-xs text-emerald-400 hover:bg-emerald-500/10"
                >
                  Invia su WhatsApp
                </a>
              </div>
              <div className="flex justify-end pt-2">
                <Button onClick={handleClose}>Chiudi</Button>
              </div>
            </div>
          )
        })()}

        {!created && (
        <>
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
          <div>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  label="Password temporanea"
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 8 caratteri"
                  disabled={submitting}
                  autoComplete="new-password"
                />
              </div>
              <button
                type="button"
                onClick={() => setPassword(generateTempPassword())}
                disabled={submitting}
                className="px-3 py-2 rounded-lg border border-theme-border text-xs text-theme-text-secondary hover:text-theme-text-primary disabled:opacity-50"
                title="Genera una nuova password casuale"
              >
                Rigenera
              </button>
            </div>
            <p className="text-[11px] text-theme-text-muted mt-1">
              Auto-generata sicura. Account attivato subito: condividi email + password all'operatore (WhatsApp / SMS / di persona). L'operatore può cambiarla dal profilo dopo il primo accesso.
            </p>
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
            {submitting ? 'Creazione...' : 'Crea Operatore'}
          </Button>
        </div>
        </>
        )}
      </div>
    </div>
  )
}
