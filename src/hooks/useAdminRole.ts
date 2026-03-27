import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'

export interface AdminRole {
  role: 'superadmin' | 'admin'
  canViewFinancials: boolean
  canManageFleet: boolean
  canManageAdmins: boolean
  loading: boolean
  adminName: string | null
  adminId: string | null
}

export function useAdminRole(): AdminRole {
  const [role, setRole] = useState<'superadmin' | 'admin'>('admin')
  const [canViewFinancials, setCanViewFinancials] = useState(false)
  const [adminName, setAdminName] = useState<string | null>(null)
  const [adminId, setAdminId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadAdminRole() {
      try {
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
          setLoading(false)
          return
        }

        const { data, error } = await supabase
          .from('admins')
          .select('id, role, can_view_financials, nome')
          .eq('user_id', user.id)
          .single()

        if (error) {
          console.error('Error loading admin role:', error)
          // Default to basic admin with no financial access
          setRole('admin')
          setCanViewFinancials(false)
        } else if (data) {
          setRole(data.role as 'superadmin' | 'admin')
          setCanViewFinancials(data.can_view_financials || false)
          setAdminName(data.nome || null)
          setAdminId(data.id || null)
        }
      } catch (err) {
        console.error('Failed to load admin role:', err)
        setRole('admin')
        setCanViewFinancials(false)
      } finally {
        setLoading(false)
      }
    }

    loadAdminRole()
  }, [])

  // Superadmins can manage fleet and admins, regular admins cannot
  const canManageFleet = role === 'superadmin'
  const canManageAdmins = role === 'superadmin'

  return { role, canViewFinancials, canManageFleet, canManageAdmins, loading, adminName, adminId }
}
