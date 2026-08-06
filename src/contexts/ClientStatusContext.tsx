import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../supabaseClient'
import {
  clientStatusColor,
  loadClientStatusConfig,
  normalizeClientStatus,
  type AvvisoLivello,
  type ClientStatusDef,
  type ClientStatusKey,
} from '../utils/clientStatusConfig'

// 'new' = nessuno status assegnato (in configurazione e' la riga 'standard').
// Oltre ai 4 di sistema il tier puo' essere una chiave creata dall'admin in
// Centralina Pro > Status Clienti: da qui in giu' e' una stringa qualsiasi.
export type ClientTier = 'new' | 'member' | 'elite' | 'blacklist' | (string & {})

export interface ClientTierMeta {
  tier: ClientTier
  label: string
  badgeClass: string
  /** Avvertenza configurata in Centralina Pro (vuota = nessuna). */
  avviso: string
  avvisoLivello: AvvisoLivello
  /** Se false il badge non va mostrato nelle liste. */
  badgeVisibile: boolean
  descrizione: string
}

// Il tier 'new' e' lo status 'standard' lato configurazione: stessa cosa vista
// da due punti (qui e' "nessuno status assegnato", in Centralina e' la riga
// personalizzabile "New entry").
const TIER_TO_KEY: Record<ClientTier, ClientStatusKey> = {
  new: 'standard', member: 'member', elite: 'elite', blacklist: 'blacklist',
}

function metaFromDef(tier: ClientTier, def: ClientStatusDef): ClientTierMeta {
  return {
    tier,
    label: def.label,
    badgeClass: clientStatusColor(def.colore).badge,
    avviso: def.avviso,
    avvisoLivello: def.avviso_livello,
    badgeVisibile: def.badge_visibile,
    descrizione: def.descrizione,
  }
}

export const DR7_CLUB_BADGE_CLASS = 'bg-[#C9A96E]/20 text-[#D4B896] border-[#C9A96E]/50'

// Fallback sincrono: usato finche' la config non e' caricata e da chi legge il
// tier fuori dal provider. Sono gli stessi valori di DEFAULT_CLIENT_STATUS.
const DEFAULT_META: Record<ClientTier, ClientTierMeta> = Object.fromEntries(
  (Object.keys(TIER_TO_KEY) as ClientTier[]).map(tier => {
    const def = normalizeClientStatus([]).find(d => d.key === TIER_TO_KEY[tier])!
    return [tier, metaFromDef(tier, def)]
  })
) as Record<ClientTier, ClientTierMeta>

/**
 * Metadati di default (nomi/colori di fabbrica). Preferire `tierMeta` del
 * contesto, che rispetta la personalizzazione fatta in Centralina Pro.
 */
export function clientTierMeta(tier: ClientTier): ClientTierMeta {
  return DEFAULT_META[tier]
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
  setTier: (keys: ClientStatusLookupKeys, tier: ClientTier) => void
  /** Nome/colore/avvertenza come personalizzati in Centralina Pro. */
  tierMeta: (tier: ClientTier) => ClientTierMeta
  /** Configurazione completa (per la sezione di Centralina Pro). */
  statusDefs: ClientStatusDef[]
  /** Ricarica la configurazione dopo un salvataggio in Centralina Pro. */
  refreshStatusConfig: () => Promise<void>
}

const Ctx = createContext<ClientStatusContextValue | undefined>(undefined)

export function useClientStatus() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useClientStatus must be used within ClientStatusProvider')
  return v
}

type RawStatus = 'standard' | 'member' | 'elite' | 'blacklist' | null

interface RawCustomer {
  id: string
  user_id: string | null
  email: string | null
  telefono: string | null
  status: RawStatus
  status_cliente: RawStatus
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
          .select('*')
          .range(from, from + PAGE - 1)
        if (error) {
          console.warn('[ClientStatusContext] customers_extended fetch error:', error)
          break
        }
        if (!data || data.length === 0) break
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const row of data as any[]) {
          customers.push({
            id: row.id,
            user_id: row.user_id ?? null,
            email: row.email ?? null,
            telefono: row.telefono ?? null,
            status: (row.status ?? null) as RawStatus,
            status_cliente: (row.status_cliente ?? null) as RawStatus,
          })
        }
        if (data.length < PAGE) break
        from += PAGE
      }
      console.info('[ClientStatusContext] loaded customers:', customers.length)

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

      const idMap = new Map<string, ClientStatusInfo>()
      const userMap = new Map<string, ClientStatusInfo>()
      const emailMap = new Map<string, ClientStatusInfo>()
      const phoneMap = new Map<string, ClientStatusInfo>()

      for (const c of customers) {
        const emailLc = c.email ? c.email.toLowerCase() : null
        const isDr7 = !!((c.user_id && dr7UserIds.has(c.user_id)) || (emailLc && dr7Emails.has(emailLc)))

        // Schema has two parallel columns (legacy split): CustomersTab writes `status`,
        // ClientiTab writes `status_cliente`. Honour whichever is set.
        const manual: RawStatus = (c.status_cliente && c.status_cliente !== 'standard')
          ? c.status_cliente
          : (c.status && c.status !== 'standard' ? c.status : null)

        let tier: ClientTier
        if (manual === 'blacklist') tier = 'blacklist'
        else if (manual === 'elite') tier = 'elite'
        else if (manual === 'member') tier = 'member'
        else tier = 'new'

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

  // Configurazione status (nomi, colori, avvertenze) da Centralina Pro.
  const [statusDefs, setStatusDefs] = useState<ClientStatusDef[]>(() => normalizeClientStatus([]))
  const refreshStatusConfig = useCallback(async () => {
    setStatusDefs(await loadClientStatusConfig())
  }, [])
  useEffect(() => {
    let alive = true
    loadClientStatusConfig().then(defs => { if (alive) setStatusDefs(defs) })
    return () => { alive = false }
  }, [])

  const tierMeta = useCallback((tier: ClientTier): ClientTierMeta => {
    const def = statusDefs.find(d => d.key === TIER_TO_KEY[tier])
    return def ? metaFromDef(tier, def) : DEFAULT_META[tier]
  }, [statusDefs])

  const setTier = useCallback((keys: ClientStatusLookupKeys, tier: ClientTier) => {
    const apply = <K,>(map: Map<K, ClientStatusInfo>, key: K | null | undefined): Map<K, ClientStatusInfo> => {
      if (!key) return map
      const prev = map.get(key)
      const next = new Map(map)
      next.set(key, { tier, dr7Club: prev?.dr7Club ?? false })
      return next
    }
    if (keys.customerId) setByCustomerId(prev => apply(prev, keys.customerId))
    if (keys.userId) setByUserId(prev => apply(prev, keys.userId))
    if (keys.email) setByEmail(prev => apply(prev, keys.email!.toLowerCase()))
    if (keys.phone) {
      const k = normalizePhone(keys.phone)
      if (k) setByPhone(prev => apply(prev, k))
    }
  }, [])

  const value = useMemo<ClientStatusContextValue>(() => ({
    loading,
    refresh: load,
    setTier,
    tierMeta,
    statusDefs,
    refreshStatusConfig,
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
  }), [loading, load, setTier, tierMeta, statusDefs, refreshStatusConfig, byCustomerId, byUserId, byEmail, byPhone])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
