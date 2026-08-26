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
  const [showPecPassword, setShowPecPassword] = useState(false)
  const [pecSmtpHost, setPecSmtpHost] = useState('')
  const [pecSmtpPort, setPecSmtpPort] = useState('')
  // Stato della password in cassaforte: il valore non torna mai al browser,
  // quindi senza questo riquadro il campo che si svuota sembrava un salvataggio
  // fallito. Qui si dice SE c'e', non quale.
  const [pecStato, setPecStato] = useState<{ registrata: boolean; aggiornata_il: string | null; server: string; riconosciuto: boolean } | null>(null)
  // Tendina dei provider: l'elenco arriva dal server (utils/pecServer.ts) cosi'
  // gli hostname stanno in un posto solo. Chi ha la PEC su un dominio proprio
  // sceglie il provider invece di andare a cercare il server SMTP.
  const [providers, setProviders] = useState<Array<{ nome: string; host: string; porta: number }>>([])
  const [pecTest, setPecTest] = useState<{ ok: boolean; msg: string } | null>(null)
  const [testingPec, setTestingPec] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const { data } = await supabase.from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle()
        const cfg = (data?.config as Record<string, unknown>) || {}
        const notif = (cfg.notifications || {}) as Record<string, unknown>
        const multe = (cfg.multe_config || {}) as Record<string, unknown>
        setEmailFrom(String(notif.email_from || ''))
        const addr = String(multe.pec_mittente || '')
        setPecMittente(addr)
        setPecSmtpHost(String(multe.pec_smtp_host || ''))
        setPecSmtpPort(multe.pec_smtp_port ? String(multe.pec_smtp_port) : '')
        if (addr) void caricaStatoPec(addr, String(multe.pec_smtp_host || ''))
        void caricaProviders()
      } catch {
        /* la sezione resta usabile: i campi partono vuoti */
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  /** Chiede al server se la casella ha una password registrata (mai quale). */
  async function caricaStatoPec(addr: string, host: string) {
    try {
      const res = await authFetch('/.netlify/functions/save-pec-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status', mittente: addr, host }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data?.success) {
        setPecStato({
          registrata: !!data.registrata,
          aggiornata_il: data.aggiornata_il || null,
          server: String(data.server || ''),
          riconosciuto: data.riconosciuto !== false,
        })
      } else {
        setPecStato(null)
      }
    } catch {
      setPecStato(null)
    }
  }

  /** Elenco provider PEC noti, per la tendina. */
  async function caricaProviders() {
    try {
      const res = await authFetch('/.netlify/functions/save-pec-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'providers' }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(data?.providers)) setProviders(data.providers)
    } catch {
      /* senza tendina il server si scrive comunque a mano */
    }
  }

  /** Login vero sul server PEC: la prova che le credenziali funzionano. */
  async function provaConnessionePec() {
    const addr = pecMittente.trim()
    if (!/\S+@\S+\.\S+/.test(addr)) { toast.error('Indirizzo PEC non valido'); return }
    setTestingPec(true)
    setPecTest(null)
    try {
      const res = await authFetch('/.netlify/functions/save-pec-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Se c'e' una password appena digitata si prova QUELLA: cosi' si
        // verifica prima di salvare. Altrimenti si prova quella in cassaforte.
        body: JSON.stringify({
          action: 'test',
          mittente: addr,
          password: pecPassword,
          host: pecSmtpHost.trim(),
          port: Number(pecSmtpPort) > 0 ? Number(pecSmtpPort) : undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (data?.success) {
        setPecTest({ ok: true, msg: `Connessione riuscita su ${data.server}:${data.porta} (${data.provider}). Le credenziali funzionano.` })
      } else {
        setPecTest({ ok: false, msg: String(data?.error || `HTTP ${res.status}`) })
      }
    } catch (e) {
      setPecTest({ ok: false, msg: e instanceof Error ? e.message : 'Errore di rete' })
    } finally {
      setTestingPec(false)
    }
  }

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
        multe_config: {
          ...((base.multe_config as Record<string, unknown>) || {}),
          pec_mittente: addr,
          pec_smtp_host: pecSmtpHost.trim() || null,
          pec_smtp_port: Number(pecSmtpPort) > 0 ? Number(pecSmtpPort) : null,
        },
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
        setPecTest(null)
        toast.success('PEC mittente e password aggiornate')
      } else {
        toast.success('PEC mittente aggiornata')
      }
      // Rilettura dal server: il riquadro verde qui sotto e' la prova che la
      // password e' finita davvero in cassaforte.
      await caricaStatoPec(addr, pecSmtpHost.trim())
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
              // Senza questo il riquadro del server restava quello della casella
              // PRECEDENTE: si scriveva la PEC di Poste e sotto continuava a
              // comparire Legalmail, come se il gestionale la ignorasse.
              onBlur={e => { const a = e.target.value.trim(); if (/\S+@\S+\.\S+/.test(a)) void caricaStatoPec(a, pecSmtpHost.trim()) }}
              placeholder="nome@pec.esempio.it"
              disabled={readOnly}
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-theme-text-muted">Password della casella</label>
            <div className="relative">
              <input
                className={`${INPUT} pr-10`}
                type={showPecPassword ? 'text' : 'password'}
                value={pecPassword}
                onChange={e => setPecPassword(e.target.value)}
                placeholder="•••••••• (lascia vuoto per non cambiarla)"
                autoComplete="new-password"
                disabled={readOnly}
              />
              {/* L'occhio mostra solo quello che si sta digitando: la password
                  gia' salvata resta in cassaforte e non torna mai al browser. */}
              <button
                type="button"
                onClick={() => setShowPecPassword(s => !s)}
                aria-label={showPecPassword ? 'Nascondi password' : 'Mostra password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-theme-text-muted hover:text-theme-text-primary transition-colors"
              >
                {showPecPassword ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M1 1l22 22" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
          {/* La tendina esiste perche' il server si deduce dal DOMINIO: una PEC
              Poste su dominio proprio non veniva riconosciuta e restava sul
              server Legalmail di ripiego. Scegliendo il provider si scrive il
              server giusto senza doverne conoscere l'hostname. */}
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-theme-text-muted">Provider della PEC</label>
            <select
              className={INPUT}
              value={pecSmtpHost.trim() ? (providers.some(p => p.host === pecSmtpHost.trim()) ? pecSmtpHost.trim() : 'altro') : 'auto'}
              onChange={e => {
                const v = e.target.value
                if (v === 'auto') { setPecSmtpHost(''); setPecSmtpPort('') }
                else if (v === 'altro') { setPecSmtpHost(''); setPecSmtpPort('') }
                else {
                  const p = providers.find(x => x.host === v)
                  setPecSmtpHost(v)
                  setPecSmtpPort(String(p?.porta || 465))
                }
              }}
              disabled={readOnly}
            >
              <option value="auto">Riconosci dal dominio della casella</option>
              {providers.map(p => (
                <option key={p.host} value={p.host}>{p.nome} — {p.host}</option>
              ))}
              <option value="altro">Altro provider (server a mano)</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-theme-text-muted">Server SMTP della PEC</label>
            <input
              className={INPUT}
              value={pecSmtpHost}
              onChange={e => setPecSmtpHost(e.target.value)}
              placeholder={pecStato?.server ? `${pecStato.server} (${pecStato.riconosciuto ? 'dedotto dal dominio' : 'ripiego: dominio non riconosciuto'})` : 'lascia vuoto: dedotto dal dominio'}
              disabled={readOnly}
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-theme-text-muted">Porta</label>
            <input
              className={INPUT}
              value={pecSmtpPort}
              onChange={e => setPecSmtpPort(e.target.value.replace(/\D/g, ''))}
              placeholder="465"
              inputMode="numeric"
              disabled={readOnly}
            />
          </div>
          <p className="text-[11px] text-theme-text-muted sm:col-span-2">
            Vuoti: il server si ricava dal dominio della casella (Legalmail, Aruba, Postecert, Namirial, Register.it)
            e la porta e&apos; 465. Se la PEC sta su un dominio proprio il dominio non dice il provider: si sceglie
            dalla tendina qui sopra. Si compilano quando il provider ne usa altri — e&apos; il campo da toccare quando il
            gestionale va a un&apos;altra azienda con un&apos;altra PEC. Porta 465 = TLS diretto, 587 e 25 = STARTTLS.
          </p>
        </div>

        {/* Stato + prova: senza questi due il campo password che si svuota
            sembrava un salvataggio andato a vuoto. */}
        <div className="flex flex-wrap items-center gap-2">
          {pecStato?.registrata ? (
            <span className="inline-flex items-center gap-1 rounded border border-green-500/30 bg-green-500/10 px-2 py-1 text-[11px] text-green-500">
              Password registrata per questa casella
              {pecStato.aggiornata_il ? ` — ${new Date(pecStato.aggiornata_il).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}` : ''}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-500">
              Nessuna password registrata per questa casella
            </span>
          )}
          {pecStato?.server && (
            <span className="inline-flex items-center gap-1 rounded border border-theme-border bg-theme-bg-tertiary px-2 py-1 font-mono text-[11px] text-theme-text-muted">
              {pecStato.server}
            </span>
          )}
          {!readOnly && (
            <button
              type="button" onClick={provaConnessionePec} disabled={testingPec}
              className="h-8 rounded-lg border border-theme-border bg-theme-bg-tertiary px-3 text-[11px] font-semibold text-theme-text-primary transition-opacity hover:opacity-90 disabled:opacity-50"
            >{testingPec ? 'Prova in corso…' : 'Prova connessione'}</button>
          )}
        </div>

        {/* Errore classico: nel campo server si scrive il DOMINIO della casella
            (pec.poste.it) invece del server di uscita (mail.postecert.it). Il
            dominio ha solo record MX: come host SMTP non esiste proprio. */}
        {pecSmtpHost.trim() && pecMittente.includes('@') &&
          pecSmtpHost.trim().toLowerCase() === pecMittente.trim().toLowerCase().split('@')[1] && (
          <p className="text-[11px] text-red-500">
            <span className="font-mono">{pecSmtpHost.trim()}</span> e&apos; il dominio della casella, non il server di
            uscita: l&apos;invio non trovera&apos; nessun server a quell&apos;indirizzo. Scegli il provider dalla tendina
            (per Poste: <span className="font-mono">mail.postecert.it</span>) oppure lascia il campo vuoto.
          </p>
        )}

        {/* Il ripiego su Legalmail non deve essere silenzioso: una PEC Poste
            su dominio proprio finiva sul server di InfoCert e l'invio veniva
            rifiutato all'autenticazione, senza che nulla lo dicesse. */}
        {pecStato && !pecStato.riconosciuto && !pecSmtpHost.trim() && (
          <p className="text-[11px] text-amber-500">
            Il dominio di questa casella non e&apos; di un provider riconosciuto: il server resta
            <span className="font-mono"> {pecStato.server}</span> per ripiego, ed e&apos; quasi certo che
            l&apos;autenticazione venga rifiutata. Scegli il provider qui sopra — per una PEC di Poste e&apos;
            Postecert (<span className="font-mono">mail.postecert.it</span>).
          </p>
        )}

        {pecTest && (
          <p className={`text-[11px] ${pecTest.ok ? 'text-green-500' : 'text-red-500'}`}>{pecTest.msg}</p>
        )}

        <p className="text-[11px] text-theme-text-muted">
          Cambiando casella serve anche la sua password: il provider PEC rifiuta un mittente diverso da quello con cui ci si autentica.
          La password viene conservata a parte, in cassaforte, e non viene mai rimostrata: si puo&apos; solo sostituire —
          per questo il campo torna vuoto dopo il salvataggio. La conferma che sia stata registrata e&apos; il riquadro
          verde qui sopra, e &quot;Prova connessione&quot; fa il login vero sul server del provider.
        </p>
        <p className="text-[11px] text-theme-text-muted">
          Lo stesso indirizzo compare come recapito aziendale nella lettera. Il destinatario, invece, si ricava dal verbale
          (Centralina Pro &gt; Gestione Multe per i dati azienda e il destinatario di riserva).
        </p>
      </div>
    </div>
  )
}
