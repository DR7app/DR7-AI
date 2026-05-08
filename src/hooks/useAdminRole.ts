import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../supabaseClient'

export interface AdminRole {
  role: 'superadmin' | 'admin'
  canViewFinancials: boolean
  canManageFleet: boolean
  canManageAdmins: boolean
  loading: boolean
  adminName: string | null
  adminId: string | null
  adminEmail: string | null
  permissions: string[]
  hasPermission: (tab: string) => boolean
}

export function useAdminRole(): AdminRole {
  const [role, setRole] = useState<'superadmin' | 'admin'>('admin')
  const [canViewFinancials, setCanViewFinancials] = useState(false)
  const [adminName, setAdminName] = useState<string | null>(null)
  const [adminId, setAdminId] = useState<string | null>(null)
  const [adminEmail, setAdminEmail] = useState<string | null>(null)
  const [permissions, setPermissions] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadAdminRole() {
      try {
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
          setLoading(false)
          return
        }
        setAdminEmail(user.email || null)

        const { data, error } = await supabase
          .from('admins')
          .select('id, role, can_view_financials, nome, permissions')
          .eq('user_id', user.id)
          .single()

        if (error) {
          console.error('Error loading admin role:', error)
          setRole('admin')
          setCanViewFinancials(false)
          setPermissions([])
        } else if (data) {
          setRole(data.role as 'superadmin' | 'admin')
          setCanViewFinancials(data.can_view_financials || false)
          setAdminName(data.nome || null)
          setAdminId(data.id || null)
          const raw = (data as { permissions?: unknown }).permissions
          setPermissions(Array.isArray(raw) ? raw.map(String) : [])
        }
      } catch (err) {
        console.error('Failed to load admin role:', err)
        setRole('admin')
        setCanViewFinancials(false)
        setPermissions([])
      } finally {
        setLoading(false)
      }
    }

    loadAdminRole()
  }, [])

  const canManageFleet = role === 'superadmin'
  const canManageAdmins = role === 'superadmin'

  // Direzione + superadmin always have full access regardless of `permissions`.
  // For everyone else we honor the array; '*' = wildcard full access.
  const isDirezione = useMemo(
    () => ['valerio@dr7.app', 'ilenia@dr7.app'].includes((adminEmail || '').toLowerCase()),
    [adminEmail]
  )

  const hasPermission = useCallback(
    (tab: string): boolean => {
      if (loading) return true // optimistic during initial load
      if (role === 'superadmin' || isDirezione) return true
      if (permissions.includes('*')) return true
      return permissions.includes(tab)
    },
    [loading, role, isDirezione, permissions]
  )

  return {
    role,
    canViewFinancials,
    canManageFleet,
    canManageAdmins,
    loading,
    adminName,
    adminId,
    adminEmail,
    permissions,
    hasPermission,
  }
}
