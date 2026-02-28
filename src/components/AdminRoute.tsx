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
        .select('role')
        .eq('user_id', session.user.id)
        .single()

      setAuthorized(!!admin)
    } catch (error) {
      console.error('Auth check error:', error)
      setAuthorized(false)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen er flex items-center justify-center">
        <div className="text-dr7-gold text-xl">Loading...</div>
      </div>
    )
  }

  if (!authorized) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
