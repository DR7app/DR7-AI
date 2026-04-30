import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../supabaseClient'

export type ClientTier = 'new' | 'member' | 'elite' | 'blacklist' | 'standard'

export interface ClientTierMeta {
  tier: ClientTier
  label: string
  badgeClass: string
}

const TIER_META: Record<ClientTier, ClientTierMeta> = {
  elite:     { tier: 'elite',     label: 'Elite',     badgeClass: 'bg-amber-500/20 text-amber-400 border-amber-500/50' },
  member:    { tier: 'member',    label: 'Member',    badgeClass: 'bg-blue-500/20 text-blue-400 border-blue-500/50' },
  blacklist: { tier: 'blacklist', label: 'Blacklist', badgeClass: 'bg-red-500/20 text-red-400 border-red-500/50' },
  new:       { tier: 'new',       label: 'New entry', badgeClass: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50' },
  standard:  { tier: 'standard',  label: 'Standard',  badgeClass: 'bg-theme-bg-tertiary text-theme-text-muted border-theme-border' },
}

export const DR7_CLUB_BADGE_CLASS = 'bg-[#C9A96E]/20 text-[#D4B896] border-[#C9A96E]/50'

export function clientTierMeta(tier: ClientTier): ClientTierMeta {
  return TIER_META[tier]
}

export interface ClientStatusInfo {
  tier: ClientTier
  dr7Club: boolean
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
  lookup: (keys: ClientStatusLookupKeys) => ClientStatusInfo | null
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
  const [byCustomerId, setByCustomerId] = useState<Map<string, ClientStatusInfo>>(new Map())
  const [byUserId, setByUserId] = useState<Map<string, ClientStatusInfo>>(new Map())
  const [byEmail, setByEmail] = useState<Map<string, ClientStatusInfo>>(new Map())
  const [byPhone, setByPhone] = useState<Map<string, ClientStatusInfo>>(new Map())

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

      const idMap = new Map<string, ClientStatusInfo>()
      const userMap = new Map<string, ClientStatusInfo>()
      const emailMap = new Map<string, ClientStatusInfo>()
      const phoneMap = new Map<string, ClientStatusInfo>()

      for (const c of customers) {
        const emailLc = c.email ? c.email.toLowerCase() : null
        const isDr7 = !!((c.user_id && dr7UserIds.has(c.user_id)) || (emailLc && dr7Emails.has(emailLc)))
        const userBkCount = c.user_id ? (bookingCountByUser.get(c.user_id) || 0) : 0
        const emailBkCount = emailLc ? (bookingCountByEmail.get(emailLc) || 0) : 0
        const bkCount = Math.max(userBkCount, emailBkCount)

        let tier: ClientTier
        if (c.status_cliente === 'blacklist') tier = 'blacklist'
        else if (c.status_cliente === 'elite') tier = 'elite'
        else if (c.status_cliente === 'member') tier = 'member'
        else if (bkCount <= 1) tier = 'new'
        else tier = 'standard'

        const info: ClientStatusInfo = { tier, dr7Club: isDr7 }
        idMap.set(c.id, info)
        if (c.user_id) userMap.set(c.user_id, info)
        if (emailLc) emailMap.set(emailLc, info)
        const phoneKey = normalizePhone(c.telefono)
        if (phoneKey) phoneMap.set(phoneKey, info)
      }

      for (const uid of dr7UserIds) {
        if (!userMap.has(uid)) userMap.set(uid, { tier: 'new', dr7Club: true })
      }
      for (const em of dr7Emails) {
        if (!emailMap.has(em)) emailMap.set(em, { tier: 'new', dr7Club: true })
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
