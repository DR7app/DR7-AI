import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'

interface UserProfile {
  user_id: string
  full_name: string | null
  phone: string | null
  role: 'admin' | 'staff' | 'viewer'
  created_at: string
}

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

      const { data: profile, error } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('user_id', session.user.id)
        .single<UserProfile>()

      if (error || !profile) {
        setAuthorized(false)
      } else {
        const allowedRoles = ['admin', 'staff', 'viewer']
        setAuthorized(allowedRoles.includes(profile.role))
      }
    } catch (error) {
      console.error('Auth check error:', error)
      setAuthorized(false)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-theme-bg-primaryer flex items-center justify-center">
        <div className="text-dr7-gold text-xl">Loading...</div>
      </div>
    )
  }

  if (!authorized) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
