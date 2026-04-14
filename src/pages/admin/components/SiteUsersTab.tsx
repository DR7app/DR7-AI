import { useState, useEffect } from 'react'
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

  useEffect(() => {
    loadUsers()
  }, [])

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

  const filtered = searchQuery.trim()
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

  const fmtDate = (d: string) =>
    new Date(d).toLocaleString('it-IT', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome',
    })

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-dr7-gold" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-theme-text-primary">Iscritti al Sito</h2>
        <span className="text-3xl font-bold text-dr7-gold">{users.length}</span>
      </div>

      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Cerca per nome, email, telefono..."
        className="w-full px-4 py-2 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:border-dr7-gold"
      />

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-theme-border text-left text-theme-text-muted">
              <th className="py-2 px-3">Nome</th>
              <th className="py-2 px-3">Email</th>
              <th className="py-2 px-3">Telefono</th>
              <th className="py-2 px-3">Registrato il</th>
              <th className="py-2 px-3">Ultimo accesso</th>
              <th className="py-2 px-3">Email</th>
              <th className="py-2 px-3 text-right">Credito</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(u => (
              <tr key={u.id} className="border-b border-theme-border/50 hover:bg-theme-bg-hover/30">
                <td className="py-2 px-3 text-theme-text-primary font-medium">
                  {u.nome || u.cognome ? `${u.nome} ${u.cognome}`.trim() : '-'}
                </td>
                <td className="py-2 px-3 text-theme-text-muted text-xs">{u.email}</td>
                <td className="py-2 px-3 text-theme-text-muted">{u.telefono || '-'}</td>
                <td className="py-2 px-3 text-theme-text-muted text-xs">{fmtDate(u.created_at)}</td>
                <td className="py-2 px-3 text-theme-text-muted text-xs">
                  {u.last_sign_in_at ? fmtDate(u.last_sign_in_at) : '-'}
                </td>
                <td className="py-2 px-3">
                  {u.email_confirmed_at
                    ? <span className="text-green-400 text-xs font-medium">Verificata</span>
                    : <span className="text-red-400 text-xs font-medium">Non verificata</span>
                  }
                </td>
                <td className="py-2 px-3 text-right font-bold text-dr7-gold">€{(u.balance || 0).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <p className="text-center text-theme-text-muted py-8">Nessun utente trovato</p>
      )}
    </div>
  )
}
