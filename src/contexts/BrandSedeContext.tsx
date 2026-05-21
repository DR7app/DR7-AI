/**
 * BrandSedeContext — multi-tenant scope for the admin UI.
 *
 * Loads the current admin's brand_id + sede_id from the `admins` row at
 * login, then exposes:
 *   - currentBrand / currentSede: resolved objects (not just ids)
 *   - availableSedi: every sede in this brand (used by the header picker)
 *   - selectedSedeId: what the operator is currently viewing — can differ
 *     from their "home" sede if they're direzione and switched to another,
 *     or 'ALL' to mean "vista cross-sede" (direzione only)
 *   - switchSede(id | 'ALL'): change the picker
 *   - isPlatformOwner: true for the DR7 brand admin who can see every brand
 *   - isBrandDirezione: can switch sedi within their own brand
 *
 * Reads stay scoped to the operator's `brand_id` via Supabase RLS (Phase 2
 * — not yet deployed). For now the context is purely informational and
 * doesn't filter queries. Once components migrate to use it explicitly
 * (Phase 3) the data isolation becomes effective.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../supabaseClient'

export interface Brand {
  id: string
  name: string
  slug: string | null
  owner_email: string | null
  subdomain: string | null
  is_active: boolean
  settings: Record<string, unknown>
}

export interface Sede {
  id: string
  brand_id: string
  name: string
  address: string | null
  city: string | null
  phone: string | null
  is_primary: boolean
  is_active: boolean
}

export interface BrandSedeContextValue {
  loading: boolean
  currentBrand: Brand | null
  homeSede: Sede | null // operator's permanent sede (from admins row)
  selectedSedeId: string | 'ALL'
  selectedSede: Sede | null // resolved sede if selectedSedeId !== 'ALL'
  availableSedi: Sede[]
  isPlatformOwner: boolean
  isBrandDirezione: boolean
  canSwitchSede: boolean
  switchSede: (sedeId: string | 'ALL') => void
  refresh: () => Promise<void>
}

const BrandSedeContext = createContext<BrandSedeContextValue | null>(null)

const STORAGE_KEY = 'dr7.selectedSedeId'

export function BrandSedeProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [currentBrand, setCurrentBrand] = useState<Brand | null>(null)
  const [homeSede, setHomeSede] = useState<Sede | null>(null)
  const [availableSedi, setAvailableSedi] = useState<Sede[]>([])
  const [isBrandDirezione, setIsBrandDirezione] = useState(false)
  const [isPlatformOwner, setIsPlatformOwner] = useState(false)
  // selectedSedeId persisted in localStorage so refresh keeps the picker
  // state. Defaults to the operator's home sede.
  const [selectedSedeId, setSelectedSedeId] = useState<string | 'ALL'>(() => {
    if (typeof window === 'undefined') return ''
    return localStorage.getItem(STORAGE_KEY) || ''
  })

  const loadContext = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setCurrentBrand(null); setHomeSede(null); setAvailableSedi([])
        return
      }

      // Phase 2 multi-tenant: brand_id/sede_id su admins + tabelle
      // brands/sedi non sono ancora deployate. Le tre query qui sotto
      // sono best-effort: se la colonna/tabella manca, prendiamo il
      // fallback single-tenant DR7 invece di sporcare la console di 400/404.

      // 1. admins row: prova select esteso, fallback al subset minimale.
      type AdminRow = {
        id?: string
        brand_id?: string | null
        sede_id?: string | null
        role?: string | null
        permissions?: unknown
      }
      let admin: AdminRow | null = null
      {
        const { data, error } = await supabase
          .from('admins')
          .select('id, brand_id, sede_id, role, permissions')
          .eq('user_id', user.id)
          .maybeSingle()
        if (error) {
          // Probabile: colonne brand_id/sede_id non ancora presenti.
          // Riprova con i soli campi che esistono di sicuro.
          const fallback = await supabase
            .from('admins')
            .select('id, role, permissions')
            .eq('user_id', user.id)
            .maybeSingle()
          admin = (fallback.data as AdminRow) || null
        } else {
          admin = (data as AdminRow) || null
        }
      }

      const brandId = (admin?.brand_id as string) || 'dr7_empire'
      const sedeId = (admin?.sede_id as string) || null
      const perms: string[] = Array.isArray(admin?.permissions)
        ? (admin!.permissions as unknown[]).map(String)
        : []
      const role = (admin?.role as string) || 'admin'

      // Brand direzione = full sede-switching power within this brand.
      // Platform owner = can see across all brands (only DR7 admins for now).
      const isDirez = role === 'superadmin'
        || perms.includes('*')
        || perms.includes('role:direzione')
      const isPlatform = brandId === 'dr7_empire' && isDirez

      setIsBrandDirezione(isDirez)
      setIsPlatformOwner(isPlatform)

      // 2. brands row — silenzia 404 se la tabella non esiste.
      try {
        const { data: brand, error } = await supabase
          .from('brands')
          .select('id, name, slug, owner_email, subdomain, is_active, settings')
          .eq('id', brandId)
          .maybeSingle()
        if (!error && brand) setCurrentBrand(brand as unknown as Brand)
      } catch { /* tabella brands non esiste ancora */ }

      // 3. sedi — stesso pattern.
      let sediList: Sede[] = []
      try {
        const { data: sedi, error } = await supabase
          .from('sedi')
          .select('id, brand_id, name, address, city, phone, is_primary, is_active')
          .eq('brand_id', brandId)
          .order('is_primary', { ascending: false })
          .order('name', { ascending: true })
        if (!error && sedi) sediList = sedi as unknown as Sede[]
      } catch { /* tabella sedi non esiste ancora */ }

      setAvailableSedi(sediList)
      const home = sediList.find(s => s.id === sedeId) || sediList.find(s => s.is_primary) || sediList[0] || null
      setHomeSede(home)

      // 4. Resolve selectedSedeId
      const persisted = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
      const isValidPersisted = persisted && (persisted === 'ALL' ? isDirez : sediList.some(s => s.id === persisted))
      if (isValidPersisted) {
        setSelectedSedeId(persisted as string | 'ALL')
      } else {
        setSelectedSedeId(home?.id || '')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadContext()
    // Refresh on auth change so the right brand/sede is loaded after login
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
        loadContext()
      }
    })
    return () => { sub.subscription.unsubscribe() }
  }, [loadContext])

  const switchSede = useCallback((id: string | 'ALL') => {
    setSelectedSedeId(id)
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, id)
    }
  }, [])

  const selectedSede = useMemo(
    () => availableSedi.find(s => s.id === selectedSedeId) || null,
    [availableSedi, selectedSedeId]
  )

  const value: BrandSedeContextValue = {
    loading,
    currentBrand,
    homeSede,
    selectedSedeId,
    selectedSede,
    availableSedi,
    isPlatformOwner,
    isBrandDirezione,
    canSwitchSede: isBrandDirezione && availableSedi.length > 1,
    switchSede,
    refresh: loadContext,
  }

  return (
    <BrandSedeContext.Provider value={value}>
      {children}
    </BrandSedeContext.Provider>
  )
}

export function useBrandSede(): BrandSedeContextValue {
  const ctx = useContext(BrandSedeContext)
  if (!ctx) {
    throw new Error('useBrandSede must be used inside BrandSedeProvider')
  }
  return ctx
}

/**
 * Optional helper for components that just need the current brand_id /
 * sede_id (e.g. to add a `.eq()` filter on a Supabase query). Returns
 * undefined for "ALL" so callers can skip the filter when direzione
 * is browsing cross-sede.
 */
export function useBrandSedeScope(): { brandId: string | undefined; sedeId: string | undefined } {
  const { currentBrand, selectedSedeId } = useBrandSede()
  return {
    brandId: currentBrand?.id,
    sedeId: selectedSedeId === 'ALL' ? undefined : selectedSedeId || undefined,
  }
}
