import { useState, useEffect, useMemo } from 'react'
import { authFetch } from '../../../utils/authFetch'

interface SiteUser {
  id: string
  email: string
  created_at: string
  email_confirmed_at: string | null
  last_sign_in_at: string | null
  balance: number
  nome: string
  cognome: string
  telefono: string
}

export default function SiteUsersTab() {
  const [users, setUsers] = useState<SiteUser[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortField, setSortField] = useState<'nome' | 'email' | 'created_at' | 'last_sign_in_at' | 'balance'>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }
  const arrow = (field: typeof sortField) => sortField === field ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''

  useEffect(() => { loadUsers() }, [])

  async function loadUsers() {
    setLoading(true)
    try {
      const res = await authFetch('/.netlify/functions/list-site-users')
      const data = await res.json()
      if (data.success && data.users) {
        setUsers(data.users.sort((a: SiteUser, b: SiteUser) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        ))
      }
    } catch (e) {
      console.error('Failed to load site users:', e)
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

    return { total, verificati, nonVerificati, nuoviMese, totalCredit, trend, topCredito }
  }, [users])

  const filtered = (searchQuery.trim()
    ? users.filter(u => {
        const q = searchQuery.toLowerCase()
        return (
          u.email?.toLowerCase().includes(q) ||
          u.nome?.toLowerCase().includes(q) ||
          u.cognome?.toLowerCase().includes(q) ||
          u.telefono?.includes(q)
        )
      })
    : users
  ).sort((a, b) => {
    let va: any, vb: any
    if (sortField === 'nome') {
      va = `${a.nome} ${a.cognome}`.toLowerCase(); vb = `${b.nome} ${b.cognome}`.toLowerCase()
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

      {/* 5 KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard label="Iscritti Totali" value={stats.total} ring="#3B82F6"/>
        <KpiCard label="Verificati" value={stats.verificati} subtitle={`${stats.total > 0 ? Math.round((stats.verificati / stats.total) * 100) : 0}% del totale`} ring="#10B981"/>
        <KpiCard label="Non Verificati" value={stats.nonVerificati} subtitle={`${stats.total > 0 ? Math.round((stats.nonVerificati / stats.total) * 100) : 0}% del totale`} ring="#F59E0B"/>
        <KpiCard label="Nuovi Questo Mese" value={stats.nuoviMese} ring="#A855F7"/>
        <KpiCard label="Credito Totale" value={fmtEur(stats.totalCredit)} ring="#19C2D6"/>
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
          placeholder="Cerca per nome, email, telefono..."
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
                  <th className="py-2.5 px-3 text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider cursor-pointer select-none hover:text-theme-text-primary" onClick={() => toggleSort('nome')}>Nome{arrow('nome')}</th>
                  <th className="py-2.5 px-3 text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider cursor-pointer select-none hover:text-theme-text-primary" onClick={() => toggleSort('email')}>Email{arrow('email')}</th>
                  <th className="py-2.5 px-3 text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider">Telefono</th>
                  <th className="py-2.5 px-3 text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider cursor-pointer select-none hover:text-theme-text-primary" onClick={() => toggleSort('created_at')}>Registrato{arrow('created_at')}</th>
                  <th className="py-2.5 px-3 text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider cursor-pointer select-none hover:text-theme-text-primary" onClick={() => toggleSort('last_sign_in_at')}>Ultimo accesso{arrow('last_sign_in_at')}</th>
                  <th className="py-2.5 px-3 text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider">Verifica</th>
                  <th className="py-2.5 px-3 text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider text-right cursor-pointer select-none hover:text-theme-text-primary" onClick={() => toggleSort('balance')}>Credito{arrow('balance')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => {
                  const fullName = `${u.nome || ''} ${u.cognome || ''}`.trim() || '-'
                  return (
                    <tr key={u.id} className="border-b border-theme-border/50 hover:bg-theme-bg-hover/30">
                      <td className="py-2 px-3 text-theme-text-primary font-medium">{fullName}</td>
                      <td className="py-2 px-3 text-theme-text-muted text-xs truncate max-w-[200px]">{u.email}</td>
                      <td className="py-2 px-3 text-theme-text-muted text-xs">{u.telefono || '-'}</td>
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
                      <td className="py-2 px-3 text-right font-bold text-dr7-gold tabular-nums">{fmtEur(u.balance)}</td>
                    </tr>
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
                  const fullName = `${u.nome || ''} ${u.cognome || ''}`.trim() || u.email
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

function KpiCard({ label, value, subtitle, ring }: { label: string; value: number | string; subtitle?: string; ring: string }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border bg-theme-bg-secondary p-4" style={{ borderColor: `${ring}33` }}>
      <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full blur-2xl pointer-events-none" style={{ background: `${ring}22` }}/>
      <div className="relative">
        <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: `${ring}cc` }}>{label}</div>
        <div className="text-2xl lg:text-3xl font-bold mt-2 tabular-nums" style={{ color: ring }}>{value}</div>
        {subtitle && <div className="text-[11px] text-theme-text-muted mt-1 truncate">{subtitle}</div>}
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
