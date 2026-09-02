import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../supabaseClient'

// Role tags stored in admins.permissions[] with the `role:` prefix. Replaces
// the hardcoded `[valerio, ilenia, ophe]` email allowlists that used to sit
// in ~10 admin files. Direzione manages these via OperatoriTab.
//
// ROLE_FAILSAFE is intentional: it guarantees valerio/ilenia can never be
// locked out even if the DB permissions are empty or corrupted, and ophe
// keeps developer access for gestione_otp_* maintenance. Updating these
// requires a deploy on purpose — they are the recovery floor.
export type AdminRoleTag =
  | 'direzione'
  | 'developer'
  | 'bypass-otp'
  | 'otp-admin'
  | 'payment-manager'
  | 'stipendio-editor'
  | 'sito-direzione'
  | 'preventivi-admin'
  // 2026-08-19 (richiesta direzione): chi puo' vedere gli acconti di TUTTI.
  // Di default nessuno tranne la direzione — nemmeno un superadmin: gli
  // incassi personali non sono un dato di gestione condiviso. Questo tag e'
  // la casella che la direzione spunta per fare un'eccezione.
  | 'acconti-tutti'

const ROLE_FAILSAFE: Record<string, ReadonlySet<AdminRoleTag>> = {
  // 2026-05-27: aggiunto 'otp-admin' a tutti e 4 — direzione (v/i/s) e
  // ophe come dev/manutentore. Senza failsafe, il ruolo deve essere
  // assegnato in DB; con failsafe e' garantito da codice come gli altri
  // ruoli. Per togliere il diritto a un futuro membro basta NON includerlo
  // qui (e non aggiungere role:otp-admin in DB).
  'valerio@dr7.app':   new Set(['direzione', 'otp-admin', 'payment-manager', 'stipendio-editor', 'sito-direzione', 'preventivi-admin']),
  'ilenia@dr7.app':    new Set(['direzione', 'otp-admin', 'payment-manager', 'stipendio-editor', 'sito-direzione', 'preventivi-admin']),
  'ophe@dr7.app':      new Set(['developer', 'otp-admin', 'sito-direzione']),
  // Salvatore gestisce il Sito CMS senza OTP — entry diretta in failsafe
  // su richiesta direzione 2026-05-13. Solo `sito-direzione`: bypassa
  // gestione_sito_access + gestione_sito_write; ogni altro OTP resta attivo.
  'salvatore@dr7.app': new Set(['payment-manager', 'stipendio-editor', 'sito-direzione', 'preventivi-admin']),
}

// Tab SELF-SERVICE: ogni operatore loggato le vede senza che la direzione
// debba spuntare il permesso nell'invito. Sono tab dove l'operatore lavora sui
// PROPRI dati (vedi AccontiTab: registra gli acconti che ha incassato lui).
// Per toglierla a un singolo operatore: `hide:<tab>` in admins.permissions.
const UNIVERSAL_TABS: ReadonlySet<string> = new Set(['acconti'])

export interface AdminRole {
  role: 'superadmin' | 'admin'
  canViewFinancials: boolean
  canManageFleet: boolean
  canManageAdmins: boolean
  loading: boolean
  adminName: string | null
  adminId: string | null
  adminEmail: string | null
  /** Avatar URL caricato in Operatori (operatori_persone.avatar_url). null = mostra le iniziali. */
  adminAvatar: string | null
  permissions: string[]
  hasPermission: (tab: string) => boolean
  hasRole: (role: AdminRoleTag) => boolean
}

export function useAdminRole(): AdminRole {
  const [role, setRole] = useState<'superadmin' | 'admin'>('admin')
  const [canViewFinancials, setCanViewFinancials] = useState(false)
  const [adminName, setAdminName] = useState<string | null>(null)
  const [adminId, setAdminId] = useState<string | null>(null)
  const [adminEmail, setAdminEmail] = useState<string | null>(null)
  const [adminAvatar, setAdminAvatar] = useState<string | null>(null)
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

        // 2026-08-18 INCIDENTE: vedi AdminRoute. Se `archived_at` non esiste
        // ancora (migrazione non eseguita) la query fallisce e l'operatore
        // resta senza ruolo e senza permessi. Si ripiega sulla select storica.
        let { data, error } = await supabase
          .from('admins')
          .select('id, role, can_view_financials, nome, permissions, archived_at')
          .eq('user_id', user.id)
          .single()
        if (error) {
          const retry = await supabase
            .from('admins')
            .select('id, role, can_view_financials, nome, permissions')
            .eq('user_id', user.id)
            .single()
          data = retry.data as typeof data
          error = retry.error
        }

        if (error) {
          console.error('Error loading admin role:', error)
          setRole('admin')
          setCanViewFinancials(false)
          setPermissions([])
        } else if (data && (data as { archived_at?: string | null }).archived_at) {
          // Operatore archiviato: nessun ruolo, nessun permesso. AdminRoute lo
          // rimanda al login; questo e' il secondo strato, per i punti che
          // leggono i permessi senza passare dal route guard.
          console.warn('[useAdminRole] Operatore archiviato: accesso negato')
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

          // Carica avatar da operatori_persone (collegato via user_id).
          // Fallback su email se user_id non e' ancora settato.
          // Tabella separata da admins: l'upload avviene da OperatorProfileModal
          // / RilevazioneOrariTab e scrive su operatori_persone.avatar_url.
          //
          // 02/09/2026 - questo blocco era `await`, dentro il try che finisce
          // con `setLoading(false)`: il gestionale teneva ferma la barra
          // laterale, e quindi la prima schermata, per aspettare una FOTO.
          // Due giri di rete in fila, per giunta, perche' la ricerca per email
          // partiva solo dopo quella per user_id.
          //
          // Ora parte per conto suo: il ruolo e i permessi non lo aspettano
          // piu' e l'avatar compare quando arriva. Le due ricerche partono
          // insieme e vince comunque quella per user_id, esattamente come
          // prima (l'email era solo il ripiego).
          void (async () => {
            try {
              const [perUserId, perEmail] = await Promise.all([
                supabase
                  .from('operatori_persone')
                  .select('avatar_url')
                  .eq('user_id', user.id)
                  .maybeSingle(),
                user.email
                  ? supabase
                      .from('operatori_persone')
                      .select('avatar_url')
                      .eq('email', user.email)
                      .maybeSingle()
                  : Promise.resolve({ data: null }),
              ])
              const opRow: { avatar_url?: string | null } | null =
                perUserId.data ?? perEmail.data
              if (opRow?.avatar_url) setAdminAvatar(opRow.avatar_url)
            } catch { /* avatar opzionale, niente blocco se fallisce */ }
          })()
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

  const lowerEmail = (adminEmail || '').toLowerCase()

  const hasRole = useCallback(
    (roleTag: AdminRoleTag): boolean => {
      if (ROLE_FAILSAFE[lowerEmail]?.has(roleTag)) return true
      return permissions.includes(`role:${roleTag}`)
    },
    [lowerEmail, permissions]
  )

  // Direzione + superadmin + developer hanno sempre accesso completo
  // (ophe@dr7.app e' developer/manutentore: serve la stessa visibilita'
  // di Valerio/Ilenia su Operatori, Report, ecc. — il bypass OTP resta
  // scoped via OTP_TAB_DEVELOPERS dove richiesto). Per tutti gli altri
  // si valuta `permissions[]`; '*' = wildcard full access.
  const isDirezione = useMemo(() => hasRole('direzione'), [hasRole])
  const isDeveloper = useMemo(() => hasRole('developer'), [hasRole])

  const hasPermission = useCallback(
    (tab: string): boolean => {
      if (loading) return true // optimistic during initial load
      if (role === 'superadmin' || isDirezione || isDeveloper) return true
      if (permissions.includes('*')) return true
      // 2026-08-03 (richiesta direzione 17/07): le tab SELF-SERVICE sono di
      // TUTTI gli operatori — non passano dai permessi per-operatore perche'
      // servono a lui (registra i propri acconti incassati in giornata).
      // Resta escludibile per il singolo con la hide-key esplicita.
      if (UNIVERSAL_TABS.has(tab) && !permissions.includes(`hide:${tab}`)) return true
      return permissions.includes(tab)
    },
    [loading, role, isDirezione, isDeveloper, permissions]
  )

  return {
    role,
    canViewFinancials,
    canManageFleet,
    canManageAdmins,
    loading,
    adminName,
    adminAvatar,
    adminId,
    adminEmail,
    permissions,
    hasPermission,
    hasRole,
  }
}
