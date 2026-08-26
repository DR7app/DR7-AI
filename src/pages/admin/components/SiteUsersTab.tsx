import { Fragment, useState, useEffect, useMemo } from 'react'
import { authFetch } from '../../../utils/authFetch'
import NumeroTelefono from '../../../components/NumeroTelefono'

interface SiteUser {
  id: string
  email: string
  created_at: string
  email_confirmed_at: string | null
  last_sign_in_at: string | null
  balance: number
  bonus_benvenuto: boolean
  ha_scheda: boolean
  // Dati compilati in registrazione ma mai finiti nella scheda cliente
  da_recuperare: boolean
  // Anagrafica compilata in fase di registrazione
  tipo_cliente: string
  nazione: string
  nome: string
  cognome: string
  telefono: string
  pec: string
  codice_fiscale: string
  sesso: string
  data_nascita: string
  citta_nascita: string
  provincia_nascita: string
  // Residenza
  indirizzo: string
  numero_civico: string
  codice_postale: string
  citta_residenza: string
  provincia_residenza: string
  // Azienda
  denominazione: string
  partita_iva: string
  codice_destinatario: string
  sede_operativa: string
  rappresentante: string
  rappresentante_cf: string
  rappresentante_ruolo: string
  // Pubblica amministrazione
  ente_ufficio: string
  codice_univoco: string
  source: string
}

// Un iscritto azienda/PA non ha nome e cognome: il suo nome e' la ragione
// sociale. Una sola regola per tabella, ricerca e ordinamento.
const nomeVisibile = (u: { nome?: string; cognome?: string; denominazione?: string; ente_ufficio?: string }) =>
  `${u.nome || ''} ${u.cognome || ''}`.trim()
  || (u.denominazione || '').trim()
  || (u.ente_ufficio || '').trim()

const ETICHETTA_TIPO: Record<string, string> = {
  persona_fisica: 'Persona fisica',
  azienda: 'Azienda',
  pubblica_amministrazione: 'Pubblica amministrazione',
}

const fmtData = (d: string) => {
  if (!d) return ''
  const t = new Date(d)
  if (isNaN(t.getTime())) return d
  return t.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Rome' })
}

// Una riga della scheda: se il dato non c'e', la riga non si stampa.
// Cosi' si vede a colpo d'occhio cosa manca davvero.
function Dato({ etichetta, valore }: { etichetta: string; valore?: string }) {
  if (!valore || !valore.trim()) return null
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">{etichetta}</div>
      <div className="text-xs text-theme-text-primary font-medium break-words">{valore}</div>
    </div>
  )
}

function Scheda({ u }: { u: SiteUser }) {
  const residenza = [
    [u.indirizzo, u.numero_civico].filter(Boolean).join(' '),
    [u.codice_postale, u.citta_residenza].filter(Boolean).join(' '),
    u.provincia_residenza ? `(${u.provincia_residenza})` : '',
    u.nazione,
  ].filter(v => v && v.trim()).join(', ')

  const nascita = [
    fmtData(u.data_nascita),
    [u.citta_nascita, u.provincia_nascita ? `(${u.provincia_nascita})` : ''].filter(Boolean).join(' '),
  ].filter(v => v && v.trim()).join(' — ')

  const vuota = !u.codice_fiscale && !u.telefono && !residenza && !u.denominazione && !u.ente_ufficio

  return (
    <div className="bg-theme-bg-tertiary/40 px-4 py-3 space-y-3">
      {vuota && (
        <p className="text-xs text-amber-300">
          Nessun dato di registrazione salvato per questo iscritto
          {u.ha_scheda ? '' : ' (scheda cliente mai creata)'}.
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2.5">
        <Dato etichetta="Tipo cliente" valore={ETICHETTA_TIPO[u.tipo_cliente] || u.tipo_cliente} />
        <Dato etichetta="Codice fiscale" valore={u.codice_fiscale} />
        <Dato etichetta="Telefono" valore={u.telefono} />
        <Dato etichetta="PEC" valore={u.pec} />

        <Dato etichetta="Sesso" valore={u.sesso} />
        <Dato etichetta="Nascita" valore={nascita} />
        <div className="col-span-2"><Dato etichetta="Residenza" valore={residenza} /></div>

        <Dato etichetta="Denominazione" valore={u.denominazione} />
        <Dato etichetta="Partita IVA" valore={u.partita_iva} />
        <Dato etichetta="Codice destinatario" valore={u.codice_destinatario} />
        <Dato etichetta="Sede operativa" valore={u.sede_operativa} />

        <Dato etichetta="Rappresentante" valore={u.rappresentante} />
        <Dato etichetta="CF rappresentante" valore={u.rappresentante_cf} />
        <Dato etichetta="Ruolo rappresentante" valore={u.rappresentante_ruolo} />

        <Dato etichetta="Ente / Ufficio" valore={u.ente_ufficio} />
        <Dato etichetta="Codice univoco" valore={u.codice_univoco} />

        <Dato etichetta="Provenienza" valore={u.source} />
      </div>
    </div>
  )
}

export default function SiteUsersTab() {
  const [users, setUsers] = useState<SiteUser[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortField, setSortField] = useState<'nome' | 'email' | 'created_at' | 'last_sign_in_at' | 'balance'>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [apertoId, setApertoId] = useState<string | null>(null)
  const [errore, setErrore] = useState('')
  // Accredito dei 10€ di benvenuto: `null` = nessuno in corso, 'tutti' =
  // recupero di massa, altrimenti l'id dell'iscritto sulla singola riga.
  const [accreditando, setAccreditando] = useState<string | null>(null)
  const [esitoBonus, setEsitoBonus] = useState('')
  // Recupero dell'anagrafica dai dati di registrazione (metadati auth).
  const [recuperando, setRecuperando] = useState(false)
  const [esitoRecupero, setEsitoRecupero] = useState('')

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }
  const arrow = (field: typeof sortField) => sortField === field ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''

  useEffect(() => { loadUsers() }, [])

  /**
   * Accredita i 10€ di benvenuto a chi non li ha mai ricevuti.
   * La RPC dietro la function e' idempotente: chi li ha gia' non li riprende.
   */
  async function accreditaBonus(ids: string[], scope: string) {
    if (ids.length === 0) return
    const euro = ids.length * 10
    if (!window.confirm(
      ids.length === 1
        ? 'Accreditare 10 € di credito wallet a questo iscritto?'
        : `Accreditare 10 € a ${ids.length} iscritti senza bonus e con wallet a 0? Totale ${euro} €.`
    )) return
    setAccreditando(scope)
    setEsitoBonus('')
    try {
      const res = await authFetch('/.netlify/functions/grant-welcome-bonus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: ids }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.success !== true) {
        setEsitoBonus(data?.error || `Accredito non riuscito (HTTP ${res.status}).`)
        return
      }
      const parti = [`${data.accreditati} accreditati (${data.euro} €)`]
      if (data.gia_accreditati) parti.push(`${data.gia_accreditati} lo avevano gia'`)
      if (data.errori?.length) parti.push(`${data.errori.length} non riusciti`)
      setEsitoBonus(parti.join(' — '))
      // 26/08/2026 — prima si rileggeva TUTTO l'elenco (decine di secondi per
      // un accredito da 10 €). Il risultato e' noto: si aggiornano solo le
      // righe accreditate, le altre restano dove sono.
      const falliti = new Set<string>((data.errori || []).map((e: any) => e.user_id))
      const toccati = new Set(ids.filter(id => !falliti.has(id)))
      setUsers(prev => prev.map(u => toccati.has(u.id) && !u.bonus_benvenuto
        ? { ...u, bonus_benvenuto: true, balance: (u.balance || 0) + 10 }
        : u))
    } catch (e: any) {
      setEsitoBonus(e?.message || 'Errore di rete durante l\'accredito.')
    } finally {
      setAccreditando(null)
    }
  }

  /**
   * Porta in Clienti tutti gli iscritti al sito.
   *
   * Per ognuno: se la scheda cliente non esiste la CREA, se esiste la
   * completa con i dati che il cliente aveva gia' compilato in
   * registrazione. Finche' la scheda resta vuota, contratti, fatture e
   * messaggi dicono "Gentile Cliente".
   *
   * A blocchi: una sola chiamata per centinaia di iscritti supererebbe il
   * tempo massimo della function e non ne salverebbe nemmeno uno. Se un
   * blocco fallisce gli altri proseguono — meglio 90 schede su 102 che zero.
   *
   * Si riempiono solo i campi vuoti, quindi si puo' rilanciare senza danni.
   */
  async function recuperaAnagrafica(ids: string[]) {
    if (ids.length === 0) return
    if (!window.confirm(
      `Portare ${ids.length} ${ids.length === 1 ? 'iscritto' : 'iscritti'} nella scheda clienti?\n\n`
      + 'Le schede mancanti vengono create, quelle esistenti completate con i dati della registrazione. '
      + 'Si riempiono solo i campi vuoti: nessun dato gia\' presente viene modificato.'
    )) return

    setRecuperando(true)
    setEsitoRecupero('')

    const BLOCCO = 50
    const totale = { create: 0, aggiornati: 0, collegate: 0, gia: 0, campi: 0, rifiutati: 0, falliti: 0 }
    const campiRifiutati = new Set<string>()
    let ultimoErrore = ''

    try {
      for (let da = 0; da < ids.length; da += BLOCCO) {
        const blocco = ids.slice(da, da + BLOCCO)
        setEsitoRecupero(`In corso: ${Math.min(da + blocco.length, ids.length)} di ${ids.length}…`)
        try {
          const res = await authFetch('/.netlify/functions/recupera-anagrafica-iscritti', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userIds: blocco }),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok || data?.success !== true) {
            totale.falliti += blocco.length
            ultimoErrore = data?.error || `HTTP ${res.status}`
            continue
          }
          totale.create += data.create || 0
          totale.aggiornati += data.aggiornati || 0
          totale.collegate += data.collegate || 0
          totale.gia += data.gia_complete || 0
          totale.campi += data.campiScritti || 0
          totale.rifiutati += data.campiRifiutati || 0
          totale.falliti += (data.errori || []).length
          for (const r of data.rifiutati || []) campiRifiutati.add(r.campo)
        } catch (e: any) {
          totale.falliti += blocco.length
          ultimoErrore = e?.message || 'errore di rete'
        }
      }

      const parti: string[] = []
      if (totale.create) parti.push(`${totale.create} schede create`)
      if (totale.aggiornati) parti.push(`${totale.aggiornati} schede completate`)
      if (totale.collegate) parti.push(`${totale.collegate} agganciate all'account`)
      parti.push(`${totale.campi} campi scritti`)
      if (totale.gia) parti.push(`${totale.gia} erano gia' a posto`)
      if (totale.rifiutati) {
        const quali = Array.from(campiRifiutati).join(', ')
        parti.push(`${totale.rifiutati} campi rifiutati dal database${quali ? ` (${quali})` : ''}`)
      }
      if (totale.falliti) parti.push(`${totale.falliti} non riusciti${ultimoErrore ? ` (${ultimoErrore})` : ''}`)
      setEsitoRecupero(parti.join(' — '))
      // I dati sono cambiati sul database: si rilegge l'elenco.
      loadUsers()
    } finally {
      setRecuperando(false)
    }
  }

  async function loadUsers() {
    setLoading(true)
    setErrore('')
    try {
      const res = await authFetch('/.netlify/functions/list-site-users')
      const data = await res.json()
      if (data.success && data.users) {
        setUsers(data.users.sort((a: SiteUser, b: SiteUser) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        ))
      } else {
        // 26/08/2026: prima l'errore veniva ignorato e la tabella restava
        // vuota. Un elenco vuoto sembrava "iscritti cancellati": va detto
        // chiaramente che e' la lettura ad essere fallita.
        setErrore(data.error || 'Impossibile leggere l\'elenco degli iscritti.')
      }
    } catch (e: any) {
      console.error('Failed to load site users:', e)
      setErrore(e?.message || 'Impossibile leggere l\'elenco degli iscritti.')
    } finally {
      setLoading(false)
    }
  }

  // Stats — tutti calcolati dai dati reali (users[]).
  const stats = useMemo(() => {
    const total = users.length
    const verificati = users.filter(u => u.email_confirmed_at).length
    const nonVerificati = total - verificati
    const totalCredit = users.reduce((s, u) => s + (u.balance || 0), 0)

    // Nuovi iscritti questo mese
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const nuoviMese = users.filter(u => new Date(u.created_at) >= monthStart).length

    // Bonus benvenuto mai accreditato + schede senza i dati obbligatori
    const senzaBonus = users.filter(u => !u.bonus_benvenuto).length
    // Accredito in blocco: solo i wallet a zero (gli altri si valutano a mano)
    const senzaBonusAZero = users.filter(u => !u.bonus_benvenuto && (u.balance || 0) === 0).length
    const schedaIncompleta = users.filter(u => !u.codice_fiscale && !u.partita_iva && !u.codice_univoco).length
    // Dati compilati alla registrazione ma mai arrivati nella scheda cliente:
    // e' la differenza fra questo elenco e la tab Clienti.
    const daRecuperare = users.filter(u => u.da_recuperare).length
    // Iscritti che nella tab Clienti non compaiono proprio: la scheda non
    // e' mai stata creata.
    const senzaScheda = users.filter(u => !u.ha_scheda).length

    // Andamento iscrizioni — ultimi 30 giorni
    const day = 1000 * 60 * 60 * 24
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const trend: Array<{ key: string; label: string; count: number }> = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today.getTime() - i * day)
      const key = d.toISOString().slice(0, 10)
      trend.push({ key, label: `${d.getDate()}/${d.getMonth() + 1}`, count: 0 })
    }
    const trendMap = new Map(trend.map(t => [t.key, t]))
    users.forEach(u => {
      const k = new Date(u.created_at).toISOString().slice(0, 10)
      const b = trendMap.get(k)
      if (b) b.count++
    })

    // Top credito clienti
    const topCredito = [...users]
      .filter(u => (u.balance || 0) > 0)
      .sort((a, b) => (b.balance || 0) - (a.balance || 0))
      .slice(0, 5)

    return { total, verificati, nonVerificati, nuoviMese, totalCredit, senzaBonus, senzaBonusAZero, schedaIncompleta, daRecuperare, senzaScheda, trend, topCredito }
  }, [users])

  // 26/08/2026 — questo blocco girava a OGNI render (anche solo aprendo una
  // scheda o premendo un tasto nella ricerca): filtro + ordinamento su tutti
  // gli iscritti, con una data da interpretare per ogni confronto. Ed era una
  // `.sort()` sull'array di stato, quindi ordinava gli iscritti sul posto.
  // Ora si ricalcola solo quando cambiano elenco, ricerca o ordinamento.
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const base = q
      ? users.filter(u => (
          u.email?.toLowerCase().includes(q) ||
          u.nome?.toLowerCase().includes(q) ||
          u.cognome?.toLowerCase().includes(q) ||
          u.denominazione?.toLowerCase().includes(q) ||
          u.ente_ufficio?.toLowerCase().includes(q) ||
          u.codice_fiscale?.toLowerCase().includes(q) ||
          u.partita_iva?.toLowerCase().includes(q) ||
          u.citta_residenza?.toLowerCase().includes(q) ||
          u.telefono?.includes(q)
        ))
      : users
    // Copia: `users` e' lo stato, ordinarlo sul posto lo modificherebbe.
    return [...base].sort((a, b) => {
      let va: any, vb: any
      if (sortField === 'nome') {
        va = nomeVisibile(a).toLowerCase(); vb = nomeVisibile(b).toLowerCase()
        return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
      }
      if (sortField === 'email') {
        va = (a.email || '').toLowerCase(); vb = (b.email || '').toLowerCase()
        return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
      }
      if (sortField === 'balance') {
        va = a.balance || 0; vb = b.balance || 0
      } else {
        va = new Date(a[sortField] || 0).getTime(); vb = new Date(b[sortField] || 0).getTime()
      }
      return sortDir === 'asc' ? va - vb : vb - va
    })
  }, [users, searchQuery, sortField, sortDir])

  const fmtDate = (d: string) =>
    new Date(d).toLocaleString('it-IT', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome',
    })

  const fmtEur = (n: number) => `€${(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-dr7-gold" />
      </div>
    )
  }

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* Hero header */}
      <div className="relative overflow-hidden bg-gradient-to-br from-theme-bg-secondary via-theme-bg-secondary to-theme-bg-tertiary rounded-2xl border border-theme-border p-5 lg:p-6">
        <div className="absolute -top-12 -right-12 w-56 h-56 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"/>
        <div className="absolute -bottom-12 -left-12 w-56 h-56 bg-purple-500/10 rounded-full blur-3xl pointer-events-none"/>
        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-blue-500/10 border border-blue-500/30 grid place-items-center flex-shrink-0">
              <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/>
              </svg>
            </div>
            <div>
              <h2 className="text-xl lg:text-2xl font-bold text-theme-text-primary leading-tight">Iscritti al Sito Clienti</h2>
              <p className="text-xs lg:text-sm text-theme-text-muted mt-0.5">Panoramica di tutti gli utenti registrati al sito</p>
            </div>
          </div>
        </div>
      </div>

      {errore && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3">
          <p className="text-xs text-red-200">
            <span className="font-semibold">Elenco non caricato.</span> Nessun iscritto e' stato cancellato:
            la lettura e' fallita ({errore}). Riprova.
          </p>
          <button
            onClick={loadUsers}
            className="shrink-0 px-3 py-1 rounded-full border border-red-500/40 text-[11px] font-semibold text-red-200 hover:bg-red-500/20"
          >
            Riprova
          </button>
        </div>
      )}

      {esitoBonus && (
        <div className="rounded-xl border border-theme-border bg-theme-bg-secondary px-4 py-3">
          <p className="text-xs text-theme-text-secondary"><span className="font-semibold">Bonus benvenuto:</span> {esitoBonus}</p>
        </div>
      )}

      {esitoRecupero && (
        <div className="rounded-xl border border-theme-border bg-theme-bg-secondary px-4 py-3">
          <p className="text-xs text-theme-text-secondary"><span className="font-semibold">Iscritti in Clienti:</span> {esitoRecupero}</p>
        </div>
      )}

      {/* 5 KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-7 gap-3">
        <KpiCard label="Iscritti Totali" value={stats.total} ring="#3B82F6"/>
        <KpiCard label="Verificati" value={stats.verificati} subtitle={`${stats.total > 0 ? Math.round((stats.verificati / stats.total) * 100) : 0}% del totale`} ring="#10B981"/>
        <KpiCard label="Non Verificati" value={stats.nonVerificati} subtitle={`${stats.total > 0 ? Math.round((stats.nonVerificati / stats.total) * 100) : 0}% del totale`} ring="#F59E0B"/>
        <KpiCard label="Nuovi Questo Mese" value={stats.nuoviMese} ring="#A855F7"/>
        <KpiCard label="Credito Totale" value={fmtEur(stats.totalCredit)} ring="#19C2D6"/>
        {/* 26/08/2026 — la carta diceva quanti erano senza bonus ma non dava
            modo di rimediare: il recupero si faceva a mano sul database. */}
        <KpiCard
          label="Senza Bonus 10€" value={stats.senzaBonus}
          subtitle={`${stats.senzaBonusAZero} con wallet a 0 · ${stats.schedaIncompleta} schede incomplete`} ring="#EF4444"
          // Solo chi ha il wallet a zero: chi ha gia' del credito lo ha
          // ricevuto per altra via e si accredita a mano, riga per riga.
          azione={stats.senzaBonusAZero > 0 ? {
            testo: accreditando === 'tutti' ? 'Accredito…' : `Accredita ${stats.senzaBonusAZero * 10} € ai saldi a 0`,
            disabilitata: accreditando !== null,
            onClick: () => accreditaBonus(
              users.filter(u => !u.bonus_benvenuto && (u.balance || 0) === 0).map(u => u.id),
              'tutti',
            ),
          } : undefined}
        />
        {/* 26/08/2026 — la tab Clienti mostrava "Cliente" e due trattini per
            gente che in registrazione aveva compilato tutto: i dati erano nei
            metadati auth (che questo elenco legge) ma non nella scheda (che la
            tab Clienti legge). Da qui si rimettono al loro posto. */}
        <KpiCard
          label="Non in Clienti" value={stats.daRecuperare}
          subtitle={stats.senzaScheda > 0
            ? `${stats.senzaScheda} senza scheda · ${stats.daRecuperare - stats.senzaScheda} con scheda incompleta`
            : 'schede incomplete rispetto alla registrazione'}
          ring="#F97316"
          azione={stats.daRecuperare > 0 ? {
            testo: recuperando ? 'In corso…' : `Porta ${stats.daRecuperare} iscritti in Clienti`,
            disabilitata: recuperando,
            onClick: () => recuperaAnagrafica(users.filter(u => u.da_recuperare).map(u => u.id)),
          } : undefined}
        />
      </div>

      {/* Search */}
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
        </svg>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Cerca per nome, email, telefono, codice fiscale, citta..."
          className="w-full pl-9 pr-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-full text-theme-text-primary placeholder-theme-text-muted text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all"
        />
      </div>

      {/* Layout: tabella a sinistra + sidebar a destra */}
      <div className="lg:flex lg:gap-4 lg:items-start">
        <div className="lg:flex-1 lg:min-w-0 bg-theme-bg-secondary rounded-2xl border border-theme-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-theme-border bg-theme-bg-tertiary/40 text-left">
                  <th className="py-2.5 px-3 w-px whitespace-nowrap text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider cursor-pointer select-none hover:text-theme-text-primary" onClick={() => toggleSort('nome')}>Nome{arrow('nome')}</th>
                  <th className="py-2.5 px-3 w-full text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider cursor-pointer select-none hover:text-theme-text-primary" onClick={() => toggleSort('email')}>Email{arrow('email')}</th>
                  <th className="py-2.5 px-3 text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider">Telefono</th>
                  <th className="py-2.5 px-3 text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider">Codice fiscale</th>
                  <th className="py-2.5 px-3 text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider">Residenza</th>
                  <th className="py-2.5 px-3 text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider cursor-pointer select-none hover:text-theme-text-primary" onClick={() => toggleSort('created_at')}>Registrato{arrow('created_at')}</th>
                  <th className="py-2.5 px-3 text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider cursor-pointer select-none hover:text-theme-text-primary" onClick={() => toggleSort('last_sign_in_at')}>Ultimo accesso{arrow('last_sign_in_at')}</th>
                  <th className="py-2.5 px-3 text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider">Verifica</th>
                  <th className="py-2.5 px-3 text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider">Bonus 10€</th>
                  <th className="py-2.5 px-3 text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider text-right cursor-pointer select-none hover:text-theme-text-primary" onClick={() => toggleSort('balance')}>Credito{arrow('balance')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => {
                  const fullName = nomeVisibile(u) || '-'
                  const aperto = apertoId === u.id
                  const residenzaBreve = [u.citta_residenza, u.provincia_residenza ? `(${u.provincia_residenza})` : '']
                    .filter(Boolean).join(' ')
                  return (
                    <Fragment key={u.id}>
                      <tr
                        className="border-b border-theme-border/50 hover:bg-theme-bg-hover/30 cursor-pointer"
                        onClick={() => setApertoId(aperto ? null : u.id)}
                      >
                        <td className="py-2 px-3 w-px whitespace-nowrap text-theme-text-primary font-medium">
                          <span className="text-theme-text-muted mr-1.5">{aperto ? '▾' : '▸'}</span>{fullName}
                        </td>
                        <td className="py-2 px-3 w-full max-w-0 truncate text-theme-text-muted text-xs">{u.email}</td>
                        <td className="py-2 px-3 text-theme-text-muted text-xs"><NumeroTelefono valore={u.telefono} vuoto="-" /></td>
                        <td className="py-2 px-3 text-theme-text-muted text-xs font-mono whitespace-nowrap">{u.codice_fiscale || u.partita_iva || '-'}</td>
                        <td className="py-2 px-3 text-theme-text-muted text-xs truncate max-w-[160px]">{residenzaBreve || '-'}</td>
                        <td className="py-2 px-3 text-theme-text-muted text-xs whitespace-nowrap">{fmtDate(u.created_at)}</td>
                        <td className="py-2 px-3 text-theme-text-muted text-xs whitespace-nowrap">
                          {u.last_sign_in_at ? fmtDate(u.last_sign_in_at) : '-'}
                        </td>
                        <td className="py-2 px-3">
                          {u.email_confirmed_at
                            ? <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 uppercase">Verificata</span>
                            : <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/40 uppercase">Non verificata</span>
                          }
                        </td>
                        <td className="py-2 px-3">
                          {u.bonus_benvenuto
                            ? <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 uppercase">Accreditato</span>
                            : (
                              // Il clic non deve aprire/chiudere la scheda della riga.
                              <button
                                onClick={e => { e.stopPropagation(); accreditaBonus([u.id], u.id) }}
                                disabled={accreditando !== null}
                                title="Accredita i 10 € di benvenuto"
                                className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-500/15 text-red-300 border border-red-500/40 uppercase hover:bg-red-500/30 disabled:opacity-50"
                              >
                                {accreditando === u.id ? 'Accredito…' : 'Accredita 10 €'}
                              </button>
                            )
                          }
                        </td>
                        <td className="py-2 px-3 text-right font-bold text-dr7-gold tabular-nums">{fmtEur(u.balance)}</td>
                      </tr>
                      {aperto && (
                        <tr className="border-b border-theme-border/50">
                          <td colSpan={10} className="p-0"><Scheda u={u} /></td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && (
            <p className="text-center text-theme-text-muted py-8 text-sm">Nessun utente trovato</p>
          )}
        </div>

        {/* Right sidebar */}
        <aside className="hidden lg:block w-80 flex-shrink-0 space-y-4 lg:sticky lg:top-4 mt-4 lg:mt-0">
          {/* Verifica donut */}
          <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
            <h3 className="text-xs font-bold text-theme-text-primary uppercase tracking-wider mb-3">Stato verifica</h3>
            <VerifyDonut verificati={stats.verificati} non={stats.nonVerificati} total={stats.total}/>
          </div>

          {/* Andamento iscrizioni */}
          <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-theme-text-primary uppercase tracking-wider">Andamento iscrizioni</h3>
              <span className="text-[10px] text-theme-text-muted">ultimi 30 gg</span>
            </div>
            <TrendBars data={stats.trend}/>
          </div>

          {/* Top credito clienti */}
          <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-theme-text-primary uppercase tracking-wider">Top credito clienti</h3>
              <span className="text-[10px] text-theme-text-muted">top 5</span>
            </div>
            {stats.topCredito.length === 0 ? (
              <div className="text-xs text-theme-text-muted py-3 text-center">Nessun cliente con credito</div>
            ) : (
              <div className="space-y-2">
                {stats.topCredito.map((u, i) => {
                  const palette = ['bg-rose-500/20 text-rose-300 border-rose-500/40', 'bg-amber-500/20 text-amber-300 border-amber-500/40', 'bg-blue-500/20 text-blue-300 border-blue-500/40', 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', 'bg-purple-500/20 text-purple-300 border-purple-500/40']
                  const fullName = nomeVisibile(u) || u.email
                  const initials = fullName.split(/\s+/).map(s => s[0] || '').join('').slice(0, 2).toUpperCase() || '?'
                  return (
                    <div key={u.id} className="flex items-center gap-2.5">
                      <div className={`w-8 h-8 rounded-full grid place-items-center text-[11px] font-bold border flex-shrink-0 ${palette[i % palette.length]}`}>{initials}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-theme-text-primary font-semibold truncate">{fullName}</div>
                        <div className="text-[10px] text-theme-text-muted truncate">{u.email}</div>
                      </div>
                      <div className="text-xs font-bold text-dr7-gold tabular-nums whitespace-nowrap">{fmtEur(u.balance)}</div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

function KpiCard({ label, value, subtitle, ring, azione }: {
  label: string; value: number | string; subtitle?: string; ring: string
  azione?: { testo: string; onClick: () => void; disabilitata?: boolean }
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border bg-theme-bg-secondary p-4" style={{ borderColor: `${ring}33` }}>
      <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full blur-2xl pointer-events-none" style={{ background: `${ring}22` }}/>
      <div className="relative">
        <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: `${ring}cc` }}>{label}</div>
        <div className="text-2xl lg:text-3xl font-bold mt-2 tabular-nums" style={{ color: ring }}>{value}</div>
        {subtitle && <div className="text-[11px] text-theme-text-muted mt-1 truncate">{subtitle}</div>}
        {azione && (
          <button
            onClick={azione.onClick}
            disabled={azione.disabilitata}
            className="mt-2 w-full rounded-lg border px-2 py-1 text-[11px] font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
            style={{ borderColor: `${ring}66`, color: ring, background: `${ring}18` }}
          >
            {azione.testo}
          </button>
        )}
      </div>
    </div>
  )
}

function VerifyDonut({ verificati, non, total }: { verificati: number; non: number; total: number }) {
  if (total === 0) return <div className="text-xs text-theme-text-muted py-3 text-center">Nessun utente</div>
  const r = 15.91549
  const pctV = Math.round((verificati / total) * 100)
  const pctN = 100 - pctV
  return (
    <div className="flex items-center gap-3">
      <div className="relative w-28 h-28 shrink-0">
        <svg className="w-28 h-28 -rotate-90" viewBox="0 0 36 36">
          <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-theme-bg-tertiary"/>
          <circle cx="18" cy="18" r={r} fill="none" strokeWidth="4" stroke="#10B981" strokeDasharray={`${pctV}, 100`}/>
          <circle cx="18" cy="18" r={r} fill="none" strokeWidth="4" stroke="#F59E0B" strokeDasharray={`${pctN}, 100`} strokeDashoffset={-pctV}/>
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-2xl font-bold text-emerald-400 tabular-nums">{pctV}%</div>
          <div className="text-[9px] text-theme-text-muted">verificati</div>
        </div>
      </div>
      <div className="flex-1 space-y-1.5">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500"/>
          <span className="text-theme-text-secondary flex-1">Verificati</span>
          <span className="text-theme-text-primary font-bold tabular-nums">{verificati}</span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="w-2.5 h-2.5 rounded-sm bg-amber-500"/>
          <span className="text-theme-text-secondary flex-1">Non verificati</span>
          <span className="text-theme-text-primary font-bold tabular-nums">{non}</span>
        </div>
        <div className="pt-1.5 border-t border-theme-border flex items-center gap-2 text-[11px]">
          <span className="text-theme-text-muted flex-1">Totale</span>
          <span className="text-theme-text-primary font-bold tabular-nums">{total}</span>
        </div>
      </div>
    </div>
  )
}

function TrendBars({ data }: { data: Array<{ key: string; label: string; count: number }> }) {
  const max = Math.max(...data.map(d => d.count), 1)
  const totalNew = data.reduce((s, d) => s + d.count, 0)
  if (totalNew === 0) {
    return <div className="text-xs text-theme-text-muted py-8 text-center">Nessuna nuova iscrizione negli ultimi 30 giorni</div>
  }
  return (
    <div>
      <div className="flex items-end gap-0.5 h-24">
        {data.map((d, i) => {
          const h = d.count > 0 ? Math.max(6, (d.count / max) * 100) : 0
          const showLabel = i === 0 || i === data.length - 1 || i === Math.floor(data.length / 2)
          return (
            <div key={d.key} className="flex-1 flex flex-col items-center" title={`${d.label}: ${d.count}`}>
              <div className="w-full flex flex-col justify-end h-full">
                {d.count > 0 && (
                  <div
                    className="w-full rounded-sm bg-gradient-to-t from-blue-500/40 to-blue-400 transition-all"
                    style={{ height: `${h}%` }}
                  />
                )}
              </div>
              {showLabel && <div className="text-[8px] text-theme-text-muted mt-0.5 whitespace-nowrap">{d.label}</div>}
            </div>
          )
        })}
      </div>
      <div className="mt-2 pt-2 border-t border-theme-border flex items-center justify-between text-[11px]">
        <span className="text-theme-text-muted">Totale 30 gg</span>
        <span className="text-theme-text-primary font-bold tabular-nums">{totalNew}</span>
      </div>
    </div>
  )
}
