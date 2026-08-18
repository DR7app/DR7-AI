import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'

interface AdminRouteProps {
  children: React.ReactNode
}

export default function AdminRoute({ children }: AdminRouteProps) {
  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)

  useEffect(() => {
    checkAuth()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setAuthorized(false)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function checkAuth() {
    try {
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        setAuthorized(false)
        setLoading(false)
        return
      }

      // 2026-08-18 INCIDENTE: leggere `archived_at` prima che la migrazione
      // fosse eseguita faceva fallire l'INTERA query (colonna inesistente) →
      // admin = null → tutti fuori dal gestionale, direzione compresa.
      // Ora la colonna nuova e' un DI PIU', non una condizione per entrare:
      // se non c'e' ancora, si rilegge senza e si entra come prima.
      let admin: { role?: string; archived_at?: string | null } | null = null
      const { data: withArchive, error: archErr } = await supabase
        .from('admins')
        .select('role, archived_at')
        .eq('user_id', session.user.id)
        .single()
      if (archErr) {
        const { data: legacy } = await supabase
          .from('admins')
          .select('role')
          .eq('user_id', session.user.id)
          .single()
        admin = legacy
      } else {
        admin = withArchive
      }

      // 2026-08-18 (richiesta direzione): un operatore ARCHIVIATO non entra.
      // Prima bastava esistere in `admins` — il campo "Stato" della scheda non
      // era controllato da nessuna parte, quindi un operatore messo
      // "Inattivo" continuava tranquillamente a lavorare nel gestionale.
      // Archiviare conserva riga e storico, ma chiude la porta.
      setAuthorized(!!admin && !admin.archived_at)
    } catch (error) {
      console.error('Auth check error:', error)
      setAuthorized(false)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-dr7-gold text-xl">Loading...</div>
      </div>
    )
  }

  if (!authorized) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
