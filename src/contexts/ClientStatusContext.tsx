import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../supabaseClient'

export type ClientStatus = 'new' | 'member' | 'elite' | 'dr7_club' | 'blacklist' | 'standard'

export interface ClientStatusMeta {
  status: ClientStatus
  label: string
  badgeClass: string
}

const META: Record<ClientStatus, ClientStatusMeta> = {
  dr7_club:  { status: 'dr7_club',  label: 'DR7 Club',  badgeClass: 'bg-[#C9A96E]/20 text-[#D4B896] border-[#C9A96E]/50' },
  elite:     { status: 'elite',     label: 'Elite',     badgeClass: 'bg-amber-500/20 text-amber-400 border-amber-500/50' },
  member:    { status: 'member',    label: 'Member',    badgeClass: 'bg-blue-500/20 text-blue-400 border-blue-500/50' },
  blacklist: { status: 'blacklist', label: 'Blacklist', badgeClass: 'bg-red-500/20 text-red-400 border-red-500/50' },
  new:       { status: 'new',       label: 'NEW',       badgeClass: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50' },
  standard:  { status: 'standard',  label: 'Standard',  badgeClass: 'bg-theme-bg-tertiary text-theme-text-muted border-theme-border' },
}

export function clientStatusMeta(status: ClientStatus): ClientStatusMeta {
  return META[status]
}

export interface ClientStatusLookupKeys {
  customerId?: string | null
  userId?: string | null
  email?: string | null
  phone?: string | null
}

function normalizePhone(p?: string | null): string | null {
  if (!p) return null
  const digits = p.replace(/\D/g, '')
  if (!digits) return null
  return digits.slice(-9)
}

interface ClientStatusContextValue {
  loading: boolean
  refresh: () => Promise<void>
  lookup: (keys: ClientStatusLookupKeys) => ClientStatus | null
}

const Ctx = createContext<ClientStatusContextValue | undefined>(undefined)

export function useClientStatus() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useClientStatus must be used within ClientStatusProvider')
  return v
}

interface RawCustomer {
  id: string
  user_id: string | null
  email: string | null
  telefono: string | null
  status_cliente: 'standard' | 'member' | 'elite' | 'blacklist' | null
}

export function ClientStatusProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [byCustomerId, setByCustomerId] = useState<Map<string, ClientStatus>>(new Map())
  const [byUserId, setByUserId] = useState<Map<string, ClientStatus>>(new Map())
  const [byEmail, setByEmail] = useState<Map<string, ClientStatus>>(new Map())
  const [byPhone, setByPhone] = useState<Map<string, ClientStatus>>(new Map())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const PAGE = 1000

      const customers: RawCustomer[] = []
      let from = 0
      for (let i = 0; i < 50; i++) {
        const { data, error } = await supabase
          .from('customers_extended')
          .select('id, user_id, email, telefono, status_cliente')
          .range(from, from + PAGE - 1)
        if (error) break
        if (!data || data.length === 0) break
        customers.push(...(data as RawCustomer[]))
        if (data.length < PAGE) break
        from += PAGE
      }

      const dr7UserIds = new Set<string>()
      const dr7Emails = new Set<string>()
      try {
        const res = await fetch('/.netlify/functions/list-club-members')
        if (res.ok) {
          const data = await res.json()
          for (const m of (data.members || [])) {
            if (m.user_id) dr7UserIds.add(m.user_id)
            if (m.email) dr7Emails.add(m.email.toLowerCase())
          }
        }
      } catch { /* ignore */ }

      const bookingCountByUser = new Map<string, number>()
      const bookingCountByEmail = new Map<string, number>()
      try {
        let bkFrom = 0
        for (let i = 0; i < 50; i++) {
          const { data, error } = await supabase
            .from('bookings')
            .select('user_id, customer_email')
            .not('status', 'in', '(cancelled,annullata)')
            .range(bkFrom, bkFrom + PAGE - 1)
          if (error || !data || data.length === 0) break
          for (const b of data) {
            if (b.user_id) bookingCountByUser.set(b.user_id, (bookingCountByUser.get(b.user_id) || 0) + 1)
            if (b.customer_email) {
              const e = b.customer_email.toLowerCase()
              bookingCountByEmail.set(e, (bookingCountByEmail.get(e) || 0) + 1)
            }
          }
          if (data.length < PAGE) break
          bkFrom += PAGE
        }
      } catch { /* ignore */ }

      const idMap = new Map<string, ClientStatus>()
      const userMap = new Map<string, ClientStatus>()
      const emailMap = new Map<string, ClientStatus>()
      const phoneMap = new Map<string, ClientStatus>()

      for (const c of customers) {
        const emailLc = c.email ? c.email.toLowerCase() : null
        const isDr7 = (c.user_id && dr7UserIds.has(c.user_id)) || (emailLc && dr7Emails.has(emailLc))
        const userBkCount = c.user_id ? (bookingCountByUser.get(c.user_id) || 0) : 0
        const emailBkCount = emailLc ? (bookingCountByEmail.get(emailLc) || 0) : 0
        const bkCount = Math.max(userBkCount, emailBkCount)

        let status: ClientStatus
        if (c.status_cliente === 'blacklist') status = 'blacklist'
        else if (isDr7) status = 'dr7_club'
        else if (c.status_cliente === 'elite') status = 'elite'
        else if (c.status_cliente === 'member') status = 'member'
        else if (bkCount <= 1) status = 'new'
        else status = 'standard'

        idMap.set(c.id, status)
        if (c.user_id) userMap.set(c.user_id, status)
        if (emailLc) emailMap.set(emailLc, status)
        const phoneKey = normalizePhone(c.telefono)
        if (phoneKey) phoneMap.set(phoneKey, status)
      }

      for (const uid of dr7UserIds) {
        if (!userMap.has(uid)) userMap.set(uid, 'dr7_club')
      }
      for (const em of dr7Emails) {
        if (!emailMap.has(em)) emailMap.set(em, 'dr7_club')
      }

      setByCustomerId(idMap)
      setByUserId(userMap)
      setByEmail(emailMap)
      setByPhone(phoneMap)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const value = useMemo<ClientStatusContextValue>(() => ({
    loading,
    refresh: load,
    lookup: ({ customerId, userId, email, phone }) => {
      if (customerId) {
        const s = byCustomerId.get(customerId)
        if (s) return s
      }
      if (userId) {
        const s = byUserId.get(userId)
        if (s) return s
      }
      if (email) {
        const s = byEmail.get(email.toLowerCase())
        if (s) return s
      }
      if (phone) {
        const k = normalizePhone(phone)
        if (k) {
          const s = byPhone.get(k)
          if (s) return s
        }
      }
      return null
    },
  }), [loading, load, byCustomerId, byUserId, byEmail, byPhone])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
