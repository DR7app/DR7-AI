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

      const { data: admin } = await supabase
        .from('admins')
        .select('role, archived_at')
        .eq('user_id', session.user.id)
        .single()

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
