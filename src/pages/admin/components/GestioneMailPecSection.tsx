// Centralina Pro > Gestione PEC & Email (25/08/2026).
//
// Da qui si decide DA QUALE indirizzo parte la posta del gestionale. Prima
// l'indirizzo email era scritto nelle variabili Netlify (quindi cambiabile solo
// da chi mette le mani sul deploy) e la PEC mittente delle multe era un campo
// che finiva solo stampato nella lettera: l'invio restava sulla casella scritta
// nel codice. "Ho messo la nuova PEC e non funziona" nasceva da li'.
//
// Email  -> centralina_pro_config.config.notifications.email_from
// PEC    -> centralina_pro_config.config.multe_config.pec_mittente (stessa
//           chiave usata dalle multe: un solo posto, non due che si smentiscono)
// Password PEC -> service_secrets, scritta dalla funzione save-pec-password.
//           Non torna mai indietro al browser: si puo' solo sostituire.
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { authFetch } from '../../../utils/authFetch'

const INPUT = 'w-full min-w-0 px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-sm text-theme-text-primary'
const EMAIL_FROM_DEFAULT = 'DR7 <noreply@dr7.app>'

export default function GestioneMailPecSection({ readOnly = false }: { readOnly?: boolean }) {
  const [loading, setLoading] = useState(true)
  const [savingEmail, setSavingEmail] = useState(false)
  const [savingPec, setSavingPec] = useState(false)
  const [emailFrom, setEmailFrom] = useState('')
  const [pecMittente, setPecMittente] = useState('')
  const [pecPassword, setPecPassword] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const { data } = await supabase.from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle()
        const cfg = (data?.config as Record<string, unknown>) || {}
        const notif = (cfg.notifications || {}) as Record<string, unknown>
        const multe = (cfg.multe_config || {}) as Record<string, unknown>
        setEmailFrom(String(notif.email_from || ''))
        setPecMittente(String(multe.pec_mittente || ''))
      } catch {
        /* la sezione resta usabile: i campi partono vuoti */
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  /** Scrive UNA chiave dentro il JSONB condiviso, rileggendolo prima. */
  async function patchConfig(patch: (base: Record<string, unknown>) => Record<string, unknown>): Promise<boolean> {
    const { data: fresh } = await supabase.from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle()
    const base = (fresh?.config as Record<string, unknown>) || {}
    const { data, error } = await supabase
      .from('centralina_pro_config')
      .update({ config: patch(base) })
      .eq('id', 'main')
      .select('id')
    if (error) { toast.error('Errore: ' + error.message); return false }
    if (!data || data.length === 0) {
      toast.error('Riga di configurazione non trovata (centralina_pro_config id=main).')
      return false
    }
    return true
  }

  async function salvaEmail() {
    const v = emailFrom.trim()
    // Ammessi "Nome <indirizzo@dominio>" e "indirizzo@dominio".
    const indirizzo = v.includes('<') ? v.slice(v.indexOf('<') + 1, v.indexOf('>')) : v
    if (v && !/\S+@\S+\.\S+/.test(indirizzo)) {
      toast.error('Indirizzo non valido. Esempi: noreply@dr7.app oppure DR7 <noreply@dr7.app>')
      return
    }
    setSavingEmail(true)
    try {
      const ok = await patchConfig(base => ({
        ...base,
        notifications: { ...((base.notifications as Record<string, unknown>) || {}), email_from: v || null },
      }))
      if (ok) toast.success(v ? 'Mittente email aggiornato' : 'Mittente email riportato al valore di sistema')
    } finally { setSavingEmail(false) }
  }

  async function salvaPec() {
    const addr = pecMittente.trim()
    if (!/\S+@\S+\.\S+/.test(addr)) { toast.error('Indirizzo PEC non valido'); return }
    setSavingPec(true)
    try {
      const ok = await patchConfig(base => ({
        ...base,
        multe_config: { ...((base.multe_config as Record<string, unknown>) || {}), pec_mittente: addr },
      }))
      if (!ok) return

      if (pecPassword.trim()) {
        const res = await authFetch('/.netlify/functions/save-pec-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mittente: addr, password: pecPassword }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data?.success !== true) {
          toast.error('PEC salvata, ma la password non e\' stata registrata: ' + (data?.error || `HTTP ${res.status}`), { duration: 9000 })
          return
        }
        setPecPassword('')
        toast.success('PEC mittente e password aggiornate')
      } else {
        toast.success('PEC mittente aggiornata')
      }
    } finally { setSavingPec(false) }
  }

  if (loading) return <div className="py-4 text-sm text-theme-text-muted">Caricamento…</div>

  return (
    <div className="space-y-6">
      {/* ── EMAIL ─────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-theme-border bg-theme-bg-secondary p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-theme-text-primary">Gestione Email</h3>
            <p className="mt-0.5 text-xs text-theme-text-muted">
              Indirizzo da cui parte la posta del gestionale: conferme, ordini di magazzino, promemoria.
            </p>
          </div>
          {!readOnly && (
            <button
              type="button" onClick={salvaEmail} disabled={savingEmail}
              className="h-9 shrink-0 rounded-lg bg-dr7-gold px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >{savingEmail ? 'Salvataggio…' : 'Salva'}</button>
          )}
        </div>

        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-theme-text-muted">Mittente</label>
          <input
            className={INPUT}
            value={emailFrom}
            onChange={e => setEmailFrom(e.target.value)}
            placeholder={EMAIL_FROM_DEFAULT}
            disabled={readOnly}
          />
          <p className="mt-1 text-[11px] text-theme-text-muted">
            Si scrive <span className="font-mono">Nome &lt;indirizzo@dominio&gt;</span> oppure solo l&apos;indirizzo.
            Lasciandolo vuoto si torna al mittente di sistema (<span className="font-mono">{EMAIL_FROM_DEFAULT}</span>).
          </p>
          <p className="mt-1 text-[11px] text-amber-500">
            Il dominio dell&apos;indirizzo dev&apos;essere verificato su Resend: un dominio non verificato fa rifiutare l&apos;invio.
          </p>
        </div>
      </div>

      {/* ── PEC ───────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-theme-border bg-theme-bg-secondary p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-theme-text-primary">Gestione PEC</h3>
            <p className="mt-0.5 text-xs text-theme-text-muted">
              Casella PEC da cui parte la comunicazione dati conducente all&apos;organo accertatore.
            </p>
          </div>
          {!readOnly && (
            <button
              type="button" onClick={salvaPec} disabled={savingPec}
              className="h-9 shrink-0 rounded-lg bg-dr7-gold px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >{savingPec ? 'Salvataggio…' : 'Salva'}</button>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-theme-text-muted">PEC mittente</label>
            <input
              className={INPUT}
              value={pecMittente}
              onChange={e => setPecMittente(e.target.value)}
              placeholder="nome@legalmail.it"
              disabled={readOnly}
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-theme-text-muted">Password della casella</label>
            <input
              className={INPUT}
              type="password"
              value={pecPassword}
              onChange={e => setPecPassword(e.target.value)}
              placeholder="•••••••• (lascia vuoto per non cambiarla)"
              autoComplete="new-password"
              disabled={readOnly}
            />
          </div>
        </div>

        <p className="text-[11px] text-theme-text-muted">
          Cambiando casella serve anche la sua password: il provider PEC rifiuta un mittente diverso da quello con cui ci si autentica.
          La password viene conservata a parte, in cassaforte, e non viene mai rimostrata: si puo&apos; solo sostituire.
        </p>
        <p className="text-[11px] text-theme-text-muted">
          Lo stesso indirizzo compare come recapito aziendale nella lettera. Il destinatario, invece, si ricava dal verbale
          (Centralina Pro &gt; Gestione Multe per i dati azienda e il destinatario di riserva).
        </p>
      </div>
    </div>
  )
}
