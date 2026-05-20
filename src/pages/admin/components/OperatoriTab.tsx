import { Fragment, useMemo, useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { formatAdminLog, formatEntityLabel } from '../../../utils/formatAdminLog'
import OperatoriReportDashboardV2 from './OperatoriReportDashboardV2'
import PayrollPeriodoView from './PayrollPeriodoView'
import InviteOperatoreModal from './InviteOperatoreModal'
import ContrattiOperatoreView from './ContrattiOperatoreView'
import { useAdminRole } from '../../../hooks/useAdminRole'

// 2026-05-18: Rilevazione Orari spostata DENTRO Operatori (sub-view).
// Prima era una top-level tab "Rilevazione Orari" — ora vive insieme
// al Report Orari (Dashboard) e a Contratti, logicamente raggruppata.
const RilevazioneOrariTab = lazy(() => import('./RilevazioneOrariTab'))

// Per-row display: which admin emails get the "Amministratore" label in the
// roster. Email-only failsafe (matches useAdminRole.ROLE_FAILSAFE); when a
// direzione member is added via permissions, the badge still falls back to
// the row's `role` column.
const FAILSAFE_DIREZIONE_EMAILS = new Set(['valerio@dr7.app', 'ilenia@dr7.app'])

// Roster badge: "Amministratore" if either the failsafe email matches OR
// the row has `role:direzione` in permissions. Keeps the per-row label in
// sync when direzione promotes another operator via the Permessi & Ruoli
// editor below.
function isAdminDirezione(a: { email?: string | null; permissions?: string[] | null }): boolean {
  if (FAILSAFE_DIREZIONE_EMAILS.has((a.email || '').toLowerCase())) return true
  const perms = Array.isArray(a.permissions) ? a.permissions : []
  return perms.includes('role:direzione')
}

interface Admin {
  id: string
  email: string
  nome: string | null
  role: string
  sede?: string | null
  reparto?: string | null
  tipo_rapporto?: string | null
  stato?: string | null
  responsabile?: string | null
  contatto_interno?: string | null
  permissions?: string[] | null
}

// Role tags mirror useAdminRole.AdminRoleTag. Direzione can grant these
// to existing operators via the Permessi & Ruoli editor below; failsafe
// in useAdminRole.ROLE_FAILSAFE still covers valerio/ilenia/ophe.
const ROLE_TAG_OPTIONS: { tag: string; label: string; hint: string }[] = [
  { tag: 'role:direzione',         label: 'Direzione',          hint: 'Superuser, sblocca tutto' },
  { tag: 'role:developer',         label: 'Developer',          hint: 'Bypass OTP Gestione OTP' },
  { tag: 'role:payment-manager',   label: 'Payment Manager',    hint: 'Segna fatture pagate' },
  { tag: 'role:stipendio-editor',  label: 'Stipendio Editor',   hint: 'Modifica stipendi Lavaggio' },
  { tag: 'role:sito-direzione',    label: 'Sito CMS',           hint: 'Modifica testi senza OTP' },
  { tag: 'role:preventivi-admin',  label: 'Preventivi Admin',   hint: 'Flussi speciali preventivi' },
]

interface LogEntry {
  id: string
  admin_id: string
  admin_email: string
  admin_name: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details: Record<string, any>
  created_at: string
}

const ACTION_LABELS: Record<string, string> = {
  login: 'Login',
  create_booking: 'Creazione prenotazione',
  edit_booking: 'Modifica prenotazione',
  delete_booking: 'Eliminazione prenotazione',
  generate_contract: 'Generazione contratto',
  resend_contract: 'Re-invio contratto',
  generate_fattura: 'Generazione fattura',
  extend_booking: 'Estensione prenotazione',
  mark_paid: 'Segna pagato',
  create_penalty: 'Creazione penale',
  create_danni: 'Creazione danno',
  create_danni_penali: 'Creazione danno+penale',
  create_carwash: 'Creazione lavaggio',
  delete_carwash: 'Eliminazione lavaggio',
  generate_carwash_fattura: 'Fattura lavaggio',
  create_mechanical: 'Creazione meccanica',
  delete_mechanical: 'Eliminazione meccanica',
  generate_mechanical_fattura: 'Fattura meccanica',
  edit_customer: 'Modifica cliente',
  delete_customer: 'Eliminazione cliente',
  update_customer_status: 'Aggiornamento stato cliente',
  delete_fattura: 'Eliminazione fattura',
  send_sdi: 'Invio SDI',
  send_trustera_document: 'Invio documento Trustera',
  delete_trustera_document: 'Eliminazione documento Trustera',
  mark_extension_paid: 'Segna estensione pagata',
  mark_booking_extensions_paid: 'Segna prenotazione+estensioni pagata',
  mark_all_customer_paid: 'Segna tutto cliente pagato',
  mark_fattura_item_paid: 'Segna voce fattura pagata',
  mark_type_paid: 'Segna tipo pagato',
  partial_payment: 'Pagamento parziale',
  delete_extension: 'Eliminazione estensione',
  delete_unpaid_booking: 'Eliminazione prenotazione non pagata',
  preventivo_created: 'Preventivo creato',
  preventivo_updated: 'Preventivo aggiornato',
  preventivo_sent: 'Preventivo inviato',
  preventivo_converted: 'Preventivo convertito',
  preventivo_deleted: 'Preventivo eliminato',
  preventivo_rejected: 'Preventivo rifiutato',
  whatsapp_sent: 'WhatsApp inviato',
  whatsapp_free_text: 'WhatsApp messaggio libero',
  whatsapp_bulk_send: 'WhatsApp massivo',
  cassa_cauzione: 'Cauzione (cassa)',
  limitation_override_approved: 'Limitazione sbloccata',
  centralina_pro_updated: 'Centralina Pro aggiornata',
}

const ACTION_OPTIONS = Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }))

const ROME_TZ = 'Europe/Rome'

// ─── Formatters ───────────────────────────────────────────────────────────

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('it-IT', { timeZone: ROME_TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString('it-IT', { timeZone: ROME_TZ, day: '2-digit', month: 'short' })
}
function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('it-IT', { timeZone: ROME_TZ, hour: '2-digit', minute: '2-digit' })
}
function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: ROME_TZ })
}
function eur(n: number): string {
  return `€${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function initials(name: string | null, email: string): string {
  const src = (name || email.split('@')[0] || '').trim()
  const parts = src.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return src.slice(0, 2).toUpperCase()
}
function avatarColor(seed: string): string {
  const palette = ['bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-700', 'bg-sky-100 text-sky-700', 'bg-rose-100 text-rose-700', 'bg-violet-100 text-violet-700', 'bg-teal-100 text-teal-700']
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

// ─── KPI / Category classification (15 categories from spec) ──────────────

type KpiKey =
  | 'pratiche' | 'clienti' | 'email' | 'messaggi' | 'pagamenti'
  | 'contratti' | 'noleggi' | 'lavaggi' | 'meccanica' | 'wallet'
  | 'danni' | 'penali' | 'preventivi' | 'login' | 'altri'

interface KpiDef { key: KpiKey; label: string; emoji: string }

const KPI_DEFS: KpiDef[] = [
  { key: 'noleggi',    label: 'Noleggi',     emoji: '🚗' },
  { key: 'contratti',  label: 'Contratti',   emoji: '📄' },
  { key: 'pratiche',   label: 'Pratiche',    emoji: '📂' },
  { key: 'clienti',    label: 'Clienti',     emoji: '👤' },
  { key: 'pagamenti',  label: 'Pagamenti',   emoji: '💶' },
  { key: 'preventivi', label: 'Preventivi',  emoji: '📝' },
  { key: 'lavaggi',    label: 'Lavaggi',     emoji: '🧽' },
  { key: 'meccanica',  label: 'Meccanica',   emoji: '🔧' },
  { key: 'email',      label: 'Email/SDI',   emoji: '📧' },
  { key: 'messaggi',   label: 'Messaggi',    emoji: '💬' },
  { key: 'wallet',     label: 'Wallet',      emoji: '💳' },
  { key: 'danni',      label: 'Danni',       emoji: '⚠️' },
  { key: 'penali',     label: 'Penali',      emoji: '🛑' },
  { key: 'login',      label: 'Accessi',     emoji: '🔑' },
  { key: 'altri',      label: 'Altri',       emoji: '✨' },
]

function classifyAction(action: string): KpiKey {
  if (action === 'login') return 'login'
  if (action.startsWith('preventivo')) return 'preventivi'
  if (action.startsWith('whatsapp')) return 'messaggi'
  if (action.includes('sdi')) return 'email'
  if (action.includes('contract') || action.includes('trustera')) return 'contratti'
  if (action.includes('fattura')) return 'pratiche'
  if (action.includes('paid') || action.includes('payment') || action === 'cassa_cauzione') return 'pagamenti'
  if (action.includes('booking') || action.includes('extension')) return 'noleggi'
  if (action.includes('carwash')) return 'lavaggi'
  if (action.includes('mechanical')) return 'meccanica'
  if (action.includes('customer')) return 'clienti'
  if (action.includes('penalty') || action.includes('penali')) return 'penali'
  if (action.includes('danni')) return 'danni'
  if (action.includes('wallet') || action.includes('topup') || action.includes('credit')) return 'wallet'
  return 'altri'
}

// ─── Amount extraction (heterogeneous fields in details JSON) ─────────────

function extractAmount(log: LogEntry): number {
  const d = log.details || {}
  const candidates = [d.amount, d.total, d.price_total, d.recharge_amount]
  for (const v of candidates) {
    if (v == null) continue
    const n = typeof v === 'number' ? v : parseFloat(String(v))
    if (Number.isFinite(n) && n > 0) return n
  }
  return 0
}

// ─── Period helpers ───────────────────────────────────────────────────────

function startOfMonthISO(d: Date): string {
  const year = d.toLocaleDateString('en-CA', { timeZone: ROME_TZ, year: 'numeric' })
  const month = d.toLocaleDateString('en-CA', { timeZone: ROME_TZ, month: '2-digit' })
  return `${year}-${month}-01`
}
function todayISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: ROME_TZ })
}
function previousMonthRange(): { from: string; to: string } {
  const now = new Date()
  const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastOfPrev = new Date(firstOfThisMonth.getTime() - 24 * 3600_000)
  const firstOfPrev = new Date(lastOfPrev.getFullYear(), lastOfPrev.getMonth(), 1)
  return {
    from: firstOfPrev.toLocaleDateString('en-CA', { timeZone: ROME_TZ }),
    to: lastOfPrev.toLocaleDateString('en-CA', { timeZone: ROME_TZ }),
  }
}

const AGG_HARD_LIMIT = 5000  // cap aggregation fetch to avoid OOM

type OperatoriView = 'dashboard' | 'rilevazione' | 'payroll' | 'audit' | 'contratti'

function OperatoriViewSwitch({ view, setView }: { view: OperatoriView; setView: (v: OperatoriView) => void }) {
  const LABELS: Record<OperatoriView, string> = {
    dashboard: 'Report Orari',
    rilevazione: 'Rilevazione Orari',
    payroll: 'Buste Paga',
    contratti: 'Contratti',
    audit: 'Audit log',
  }
  return (
    <div className="flex justify-end">
      <div className="inline-flex rounded-full border border-theme-border bg-theme-bg-secondary p-0.5 text-xs">
        {(['dashboard', 'rilevazione', 'payroll', 'contratti', 'audit'] as const).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3 py-1.5 rounded-full ${view === v ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'}`}
          >
            {LABELS[v]}
          </button>
        ))}
      </div>
    </div>
  )
}

// 2026-05-20: V1 (OperatoriReportDashboard) rimossa. Resta solo V2.
function DashboardToggle() {
  return <OperatoriReportDashboardV2 />
}

export default function OperatoriTab() {
  const [view, setView] = useState<OperatoriView>('dashboard')

  if (view === 'dashboard') {
    return (
      <div className="space-y-3">
        <OperatoriViewSwitch view={view} setView={setView} />
        <DashboardToggle />
      </div>
    )
  }
  if (view === 'rilevazione') {
    return (
      <div className="space-y-3">
        <OperatoriViewSwitch view={view} setView={setView} />
        <Suspense fallback={<div className="p-6 text-center text-theme-text-muted">Caricamento Rilevazione Orari...</div>}>
          <RilevazioneOrariTab />
        </Suspense>
      </div>
    )
  }
  if (view === 'payroll') {
    return (
      <div className="space-y-3">
        <OperatoriViewSwitch view={view} setView={setView} />
        <PayrollPeriodoView />
      </div>
    )
  }
  if (view === 'contratti') {
    return (
      <div className="space-y-3">
        <OperatoriViewSwitch view={view} setView={setView} />
        <ContrattiOperatoreView />
      </div>
    )
  }
  return <AuditLogView onSwitchView={() => setView('dashboard')} />
}

function AuditLogView({ onSwitchView }: { onSwitchView: () => void }) {
  const { hasRole } = useAdminRole()
  // Keep latest hasRole in a ref so the useCallback bodies below don't have to
  // depend on it (they're memoized on date/filter only and re-creating them on
  // every role-hook re-render would thrash useEffect downstream).
  const hasRoleRef = useRef(hasRole)
  useEffect(() => { hasRoleRef.current = hasRole }, [hasRole])

  const [admins, setAdmins] = useState<Admin[]>([])
  const [selectedAdmin, setSelectedAdmin] = useState<string | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])           // paginated detail
  const [aggLogs, setAggLogs] = useState<LogEntry[]>([])     // all-period logs for stats
  const [prevMonthLogs, setPrevMonthLogs] = useState<LogEntry[]>([])
  const [teamCounts, setTeamCounts] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [logsLoading, setLogsLoading] = useState(false)
  const [, setAggLoading] = useState(false)
  const [aggTruncated, setAggTruncated] = useState(false)
  const [dateFrom, setDateFrom] = useState(startOfMonthISO(new Date()))
  const [dateTo, setDateTo] = useState(todayISO())
  const [actionFilter, setActionFilter] = useState('')
  const [page, setPage] = useState(0)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const PAGE_SIZE = 50

  useEffect(() => {
    loadAdmins()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadLogs = useCallback(async (adminId: string, pageNum: number) => {
    setLogsLoading(true)
    let query = supabase
      .from('admin_activity_log').select('*')
      .eq('admin_id', adminId)
      .order('created_at', { ascending: false })
      .range(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE - 1)
    if (dateFrom) query = query.gte('created_at', new Date(dateFrom).toISOString())
    if (dateTo) {
      const end = new Date(dateTo); end.setHours(23, 59, 59, 999)
      query = query.lte('created_at', end.toISOString())
    }
    if (actionFilter) query = query.eq('action', actionFilter)
    const { data } = await query
    setLogs(data || [])
    setLogsLoading(false)
  }, [dateFrom, dateTo, actionFilter])

  const loadAggregations = useCallback(async (adminId: string) => {
    setAggLoading(true)
    setAggTruncated(false)
    const fromIso = new Date(dateFrom).toISOString()
    const end = new Date(dateTo); end.setHours(23, 59, 59, 999)
    const toIso = end.toISOString()

    // 1. All period logs for selected admin
    const { data: aggData, count } = await supabase
      .from('admin_activity_log')
      .select('*', { count: 'exact' })
      .eq('admin_id', adminId)
      .gte('created_at', fromIso).lte('created_at', toIso)
      .order('created_at', { ascending: false })
      .range(0, AGG_HARD_LIMIT - 1)
    setAggLogs(aggData || [])
    if (count && count > AGG_HARD_LIMIT) setAggTruncated(true)

    // 2. Team comparison: counts per admin in same period.
    //    Solo direzione (Valerio/Ilenia) e developer (ophe — manutentore):
    //    per gli altri non carichiamo nulla cosi' "Vs media team" resta
    //    a "—" (privacy report).
    if (hasRoleRef.current('direzione') || hasRoleRef.current('developer')) {
        const { data: teamData } = await supabase
          .from('admin_activity_log')
          .select('admin_id')
          .gte('created_at', fromIso).lte('created_at', toIso)
          .limit(50000)
        const counts = new Map<string, number>()
        for (const row of teamData || []) {
          counts.set(row.admin_id, (counts.get(row.admin_id) || 0) + 1)
        }
        setTeamCounts(counts)
    } else {
        setTeamCounts(new Map())
    }

    // 3. Previous month for selected admin
    const prev = previousMonthRange()
    const prevEnd = new Date(prev.to); prevEnd.setHours(23, 59, 59, 999)
    const { data: prevData } = await supabase
      .from('admin_activity_log').select('*')
      .eq('admin_id', adminId)
      .gte('created_at', new Date(prev.from).toISOString())
      .lte('created_at', prevEnd.toISOString())
      .limit(AGG_HARD_LIMIT)
    setPrevMonthLogs(prevData || [])

    setAggLoading(false)
  }, [dateFrom, dateTo])

  useEffect(() => {
    if (!selectedAdmin) return
    setPage(0)
    loadLogs(selectedAdmin, 0)
    loadAggregations(selectedAdmin)
  }, [selectedAdmin, dateFrom, dateTo, actionFilter, loadLogs, loadAggregations])

  async function loadAdmins() {
    setLoading(true)
    // Roster sort order: read from centralina_pro_config.config.operatori.roster_order
    // (array of first-names, ordered). Names not in the list go to the end,
    // sorted alphabetically. Falls back to the historical hardcoded order.
    const fallbackOrder = ['Valerio', 'Ilenia', 'Salvatore', 'Ophélie', 'Davide']
    let rosterOrder = fallbackOrder
    try {
      const { data: cfgRow } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()
      const cfg = (cfgRow?.config || {}) as Record<string, unknown>
      const op = (cfg.operatori || {}) as Record<string, unknown>
      const arr = op.roster_order
      if (Array.isArray(arr) && arr.length > 0) rosterOrder = arr.map(String)
    } catch { /* keep fallback */ }

    // Privacy: ognuno vede SOLO il proprio report. Direzione (valerio/
    // ilenia) e developer (ophe — manutentore) vedono i report di tutti.
    const { data: { user } } = await supabase.auth.getUser()
    const myEmail = (user?.email || '').toLowerCase()
    const isDirection = hasRoleRef.current('direzione') || hasRoleRef.current('developer')

    const { data } = await supabase.from('admins').select('id, email, nome, role, sede, reparto, tipo_rapporto, stato, responsabile, contatto_interno, permissions')
    if (data) {
      const filtered = isDirection
        ? data
        : data.filter(a => (a.email || '').toLowerCase() === myEmail)
      filtered.sort((a, b) => {
        const ai = rosterOrder.indexOf(a.nome || '')
        const bi = rosterOrder.indexOf(b.nome || '')
        const aPos = ai === -1 ? 999 : ai
        const bPos = bi === -1 ? 999 : bi
        if (aPos !== bPos) return aPos - bPos
        // Same priority → alphabetical
        return (a.nome || a.email).localeCompare(b.nome || b.email)
      })
      setAdmins(filtered)
      if (!selectedAdmin && filtered.length > 0) setSelectedAdmin(filtered[0].id)
    }
    setLoading(false)
  }

  function handlePageChange(newPage: number) {
    setPage(newPage)
    if (selectedAdmin) loadLogs(selectedAdmin, newPage)
  }

  function setPeriodPreset(preset: 'oggi' | 'mese' | '7gg' | '30gg' | 'mese-prec') {
    const t = todayISO()
    if (preset === 'oggi') { setDateFrom(t); setDateTo(t); return }
    if (preset === 'mese') { setDateFrom(startOfMonthISO(new Date())); setDateTo(t); return }
    if (preset === 'mese-prec') {
      const r = previousMonthRange()
      setDateFrom(r.from); setDateTo(r.to); return
    }
    if (preset === '7gg') {
      const d = new Date(); d.setDate(d.getDate() - 6)
      setDateFrom(d.toLocaleDateString('en-CA', { timeZone: ROME_TZ })); setDateTo(t); return
    }
    if (preset === '30gg') {
      const d = new Date(); d.setDate(d.getDate() - 29)
      setDateFrom(d.toLocaleDateString('en-CA', { timeZone: ROME_TZ })); setDateTo(t); return
    }
  }

  const selected = admins.find(a => a.id === selectedAdmin) || null

  // Only direzione (Valerio + Ilenia by email) can edit operator HR fields
  // — same allowlist as the OTP self-approval.
  const [inviteOpen, setInviteOpen] = useState(false)
  const canEditOperators = hasRole('direzione') || hasRole('developer')

  // Save a single field on the selected admin row + update local state.
  const updateFieldLockRef = useRef(false)
  async function updateOperatorField(adminId: string, field: keyof Admin, value: string) {
    if (updateFieldLockRef.current) return
    updateFieldLockRef.current = true
    try {
      const { error } = await supabase
        .from('admins')
        .update({ [field]: value || null })
        .eq('id', adminId)
      if (error) {
        toast.error(`Salvataggio fallito: ${error.message}`)
        return
      }
      setAdmins(prev => prev.map(a => a.id === adminId ? { ...a, [field]: value || null } : a))
      toast.success('Salvato')
    } finally {
      updateFieldLockRef.current = false
    }
  }

  // Toggle a single role tag on an existing admin. Writes admins.permissions
  // and refreshes local state so the gates that read hasRole() update on
  // next render. Reserved to direzione.
  async function toggleAdminRole(admin: Admin, tag: string) {
    if (!canEditOperators) {
      toast.error('Solo la direzione può modificare i ruoli.')
      return
    }
    const current = Array.isArray(admin.permissions) ? admin.permissions : []
    const next = current.includes(tag) ? current.filter(t => t !== tag) : [...current, tag]
    const { error } = await supabase
      .from('admins')
      .update({ permissions: next })
      .eq('id', admin.id)
    if (error) {
      toast.error(`Salvataggio fallito: ${error.message}`)
      return
    }
    setAdmins(prev => prev.map(a => a.id === admin.id ? { ...a, permissions: next } : a))
    toast.success(current.includes(tag) ? `Rimosso ${tag.replace('role:', '')}` : `Assegnato ${tag.replace('role:', '')}`)
  }

  // ─── Aggregations ────────────────────────────────────────────────────
  const stats = useMemo(() => computeStats(aggLogs), [aggLogs])
  const prevStats = useMemo(() => computeStats(prevMonthLogs), [prevMonthLogs])

  const teamAvg = useMemo(() => {
    if (teamCounts.size === 0) return 0
    let total = 0; let n = 0
    teamCounts.forEach(v => { total += v; n += 1 })
    return n > 0 ? total / n : 0
  }, [teamCounts])

  const myCount = teamCounts.get(selectedAdmin || '') || 0

  // ─── Alerts engine ───────────────────────────────────────────────────
  const alerts = useMemo(() => buildAlerts(aggLogs, stats), [aggLogs, stats])

  // ─── Insight finale ──────────────────────────────────────────────────
  const insight = useMemo(() => buildInsight(stats, prevStats, alerts, teamAvg, myCount), [stats, prevStats, alerts, teamAvg, myCount])

  // ─── Quality score (derived from log patterns) ───────────────────────
  const quality = useMemo(() => buildQuality(aggLogs), [aggLogs])

  function exportCSV() {
    if (!selected) return
    const header = ['Data', 'Ora', 'Azione', 'Tipo Entità', 'ID Entità', 'Importo', 'Dettagli']
    const rows = aggLogs.map(l => [
      formatDay(l.created_at),
      formatTime(l.created_at),
      ACTION_LABELS[l.action] || l.action,
      l.entity_type || '',
      l.entity_id || '',
      String(extractAmount(l) || ''),
      JSON.stringify(l.details || {}).replace(/"/g, '""'),
    ])
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `report-operatore-${selected.nome || selected.email}-${dateFrom}_${dateTo}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function sendToConsulente() {
    if (!selected) return
    const subject = encodeURIComponent(`Report Operatore — ${selected.nome || selected.email} — ${dateFrom} → ${dateTo}`)
    const body = encodeURIComponent(
      `Operatore: ${selected.nome || selected.email}\n` +
      `Periodo: ${dateFrom} → ${dateTo}\n` +
      `Giorni attivi: ${stats.activeDays}\n` +
      `Attività totali: ${stats.totalActivities}\n` +
      `Importo movimentato: ${eur(stats.totalAmount)}\n\n` +
      `Insight: ${insight}\n\n` +
      `(Allegare CSV / PDF — esportazione automatica in arrivo nella Fase C)`
    )
    window.location.href = `mailto:?subject=${subject}&body=${body}`
  }

  if (loading) return <div className="text-theme-text-muted p-8 text-center">Caricamento...</div>

  return (
    <div className="space-y-6">
      {/* ─── Header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-theme-text-primary">Report Operatore</h2>
          <div className="text-xs text-theme-text-muted mt-1">Home / Operatori / Report Operatore</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full border border-theme-border bg-theme-bg-secondary p-0.5 text-xs">
            {([
              { k: 'oggi', l: 'Oggi' },
              { k: '7gg', l: '7 giorni' },
              { k: '30gg', l: '30 giorni' },
              { k: 'mese', l: 'Mese corrente' },
              { k: 'mese-prec', l: 'Mese prec.' },
            ] as const).map(p => (
              <button key={p.k} onClick={() => setPeriodPreset(p.k)} className="px-3 py-1.5 rounded-full text-theme-text-secondary hover:bg-theme-bg-hover transition-colors">{p.l}</button>
            ))}
          </div>
          <div className="inline-flex rounded-full border border-theme-border bg-theme-bg-secondary p-0.5 text-xs">
            <button onClick={onSwitchView} className="px-3 py-1.5 rounded-full text-theme-text-secondary hover:bg-theme-bg-hover">Dashboard</button>
            <button className="px-3 py-1.5 rounded-full bg-dr7-gold text-black font-semibold">Audit log</button>
          </div>
          <button onClick={exportCSV} disabled={!selected || aggLogs.length === 0} className="px-4 py-2 text-sm rounded-full bg-dr7-gold text-black font-medium hover:opacity-90 disabled:opacity-30 transition-opacity">Esporta CSV</button>
          <button onClick={() => window.print()} disabled={!selected} className="px-4 py-2 text-sm rounded-full border border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover transition-colors disabled:opacity-30">Stampa / PDF</button>
        </div>
      </div>

      {/* Direzione-only: roster sort + KPI exclusion config */}
      {canEditOperators && <RosterConfigEditor admins={admins} />}

      {/* ─── Operator switcher ──────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {admins.map(admin => {
          const active = selectedAdmin === admin.id
          return (
            <button key={admin.id} onClick={() => setSelectedAdmin(admin.id)}
              className={`flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border transition-all ${active ? 'bg-dr7-gold/10 border-dr7-gold text-theme-text-primary' : 'bg-theme-bg-secondary border-theme-border text-theme-text-secondary hover:border-dr7-gold/50'}`}>
              <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${avatarColor(admin.id)}`}>{initials(admin.nome, admin.email)}</span>
              <span className="text-sm font-medium">{admin.nome || admin.email.split('@')[0]}</span>
              <span className="text-[10px] uppercase tracking-wider opacity-70">{
                isAdminDirezione(admin)
                  ? 'Amministratore'
                  : admin.role
              }</span>
            </button>
          )
        })}
        {canEditOperators && (
          <button
            onClick={() => setInviteOpen(true)}
            className="flex items-center gap-2 px-3 py-1 rounded-full border border-dashed border-dr7-gold/60 text-dr7-gold hover:bg-dr7-gold/10 transition-colors"
            title="Invita un nuovo operatore via email"
          >
            <span className="text-base leading-none">+</span>
            <span className="text-sm font-medium">Aggiungi Operatore</span>
          </button>
        )}
      </div>
      <InviteOperatoreModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onCreated={() => loadAdmins()}
      />

      {selected && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ─── LEFT: main column ─────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-6">

            {/* SECTION 1 — TESTATA OPERATORE */}
            <Section title="Testata operatore" subtitle="Identità e contatti">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className={`w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold ${avatarColor(selected.id)}`}>{initials(selected.nome, selected.email)}</div>
                <div className="flex-1">
                  <div className="text-2xl font-bold text-theme-text-primary">{selected.nome || selected.email.split('@')[0]}</div>
                  <div className="text-sm text-theme-text-secondary">{
                    isAdminDirezione(selected)
                      ? 'Amministratore'
                      : selected.role === 'superadmin' ? 'Superadmin' : 'Operatore'
                  }</div>
                  <div className="text-xs text-theme-text-muted mt-0.5">{selected.email}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-theme-text-muted">Periodo</div>
                  <div className="text-sm font-medium text-theme-text-primary">{dateFrom} → {dateTo}</div>
                  {aggTruncated && <div className="text-[10px] text-amber-500 mt-1">⚠ Aggregazione limitata a {AGG_HARD_LIMIT} eventi</div>}
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 text-xs">
                <ProfileFieldEditable label="Sede"            value={selected.sede}             placeholder="es. Cagliari"                  canEdit={canEditOperators} onSave={(v) => updateOperatorField(selected.id, 'sede', v)} />
                <ProfileFieldEditable label="Reparto"         value={selected.reparto}          placeholder="es. Direzione"                 canEdit={canEditOperators} onSave={(v) => updateOperatorField(selected.id, 'reparto', v)} />
                <ProfileFieldEditable label="Tipo rapporto"   value={selected.tipo_rapporto}    placeholder="Dipendente / Collaboratore…"   canEdit={canEditOperators} onSave={(v) => updateOperatorField(selected.id, 'tipo_rapporto', v)} />
                <ProfileFieldEditable label="Stato"           value={selected.stato || 'Attivo'} placeholder="Attivo / Sospeso / Inattivo" canEdit={canEditOperators} onSave={(v) => updateOperatorField(selected.id, 'stato', v)} />
                <ProfileFieldEditable label="Responsabile"    value={selected.responsabile}     placeholder="Nome responsabile"             canEdit={canEditOperators} onSave={(v) => updateOperatorField(selected.id, 'responsabile', v)} />
                <ProfileFieldEditable label="Contatto interno" value={selected.contatto_interno} placeholder="Telefono interno"             canEdit={canEditOperators} onSave={(v) => updateOperatorField(selected.id, 'contatto_interno', v)} />
                <ProfileField label="Foto profilo" value="Iniziali" />
                <ProfileField label="ID interno" value={selected.id.slice(0, 8)} />
              </div>

              {/* Permessi & Ruoli — editabile solo dalla direzione */}
              {canEditOperators && (
                <div className="mt-6 border-t border-theme-border pt-5">
                  <h4 className="text-sm font-semibold text-theme-text-primary mb-1">Permessi & Ruoli</h4>
                  <p className="text-[12px] text-theme-text-muted mb-3">
                    Assegna i ruoli speciali a questo operatore. I gate nel resto dell&apos;admin
                    (Fatture, Stipendi, Sito CMS, OTP, ecc.) usano <code className="text-[11px] bg-theme-bg-tertiary px-1 rounded">hasRole()</code>.
                    Il failsafe per valerio/ilenia/ophe resta nel codice — non puoi escluderli da qui.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {ROLE_TAG_OPTIONS.map(opt => {
                      const currentPerms = Array.isArray(selected.permissions) ? selected.permissions : []
                      const checked = currentPerms.includes(opt.tag)
                      return (
                        <label key={opt.tag} className="flex items-start gap-2 px-3 py-2 rounded-md border border-theme-border bg-theme-bg-primary cursor-pointer hover:border-dr7-gold/40 transition-colors">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleAdminRole(selected, opt.tag)}
                            className="mt-0.5"
                          />
                          <div className="min-w-0">
                            <div className="text-[13px] font-medium text-theme-text-primary">{opt.label}</div>
                            <div className="text-[11px] text-theme-text-muted">{opt.hint}</div>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}
            </Section>

            {/* SECTION 2 — KPI PRINCIPALI */}
            <Section title="KPI principali" subtitle={`Totale: ${stats.totalActivities} attività · ${stats.activeDays} giorni attivi`}>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {KPI_DEFS.map(c => (
                  <KpiTile key={c.key} label={c.label} emoji={c.emoji} value={stats.byCategory.get(c.key) || 0} />
                ))}
              </div>
            </Section>

            {/* SECTION 3 — PRESENZE E ORE LAVORATE
                Le ore non si ricavano piu' dal log attivita' (induceva in
                errore: ore "stimate" comparivano anche per giorni in cui
                l'admin non aveva timbrato). Per gli orari reali vai su
                Report -> Rilevazione Orari, che legge timesheet_entries. */}
            <Section title="Presenze e ore lavorate" subtitle="Le ore reali si gestiscono in Rilevazione Orari (manuale)">
              <div className="bg-theme-bg-secondary border border-theme-border rounded p-4 text-sm text-theme-text-secondary">
                Per vedere o registrare gli orari (entrata, pause, uscita), apri
                <strong className="text-theme-text-primary"> Report → Rilevazione Orari</strong>{' '}
                oppure clicca sull'icona orologio "I miei orari" nella sidebar.
                Solo Valerio e Ilenia vedono i report di tutti gli operatori; gli
                altri admin vedono solo i propri.
              </div>
            </Section>

            {/* SECTION 4 — PRODUTTIVITÀ */}
            <Section title="Produttività" subtitle={stats.peakDay ? `Picco: ${formatDay(stats.peakDay.day + 'T12:00:00')} con ${stats.peakDay.count} attività` : 'Distribuzione attività per giorno'}>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4 text-xs">
                <StatTile label="Media giornaliera" value={stats.activeDays > 0 ? (stats.totalActivities / stats.activeDays).toFixed(1) : '0.0'} hint="attività/giorno" />
                <StatTile label="Vs media team" value={teamAvg > 0 ? `${((myCount / teamAvg - 1) * 100).toFixed(0)}%` : '—'} hint={`team: ${teamAvg.toFixed(0)} att.`} />
                <StatTile label="Vs mese prec." value={prevStats.totalActivities > 0 ? `${((stats.totalActivities / prevStats.totalActivities - 1) * 100).toFixed(0)}%` : '—'} hint={`prec: ${prevStats.totalActivities} att.`} />
              </div>
              <ProductivityChart days={stats.days} />
              <div className="mt-3 text-xs text-theme-text-muted">
                Tempo medio di gestione pratica e tempo medio di risposta cliente: <span className="text-amber-500">disponibile in Fase C</span> (richiede tracciamento eventi start/end).
              </div>
            </Section>

            {/* SECTION 5 — QUALITÀ DEL LAVORO */}
            <Section title="Qualità del lavoro" subtitle="Score derivato da pattern del log (errori non tracciati esplicitamente)">
              <div className="flex items-center gap-4 mb-4">
                <div className={`px-4 py-2 rounded-full text-sm font-semibold ${qualityBadgeClass(quality.label)}`}>{quality.label}</div>
                <div className="flex-1 h-2 bg-theme-bg-tertiary rounded-full overflow-hidden">
                  <div className="h-full bg-dr7-gold" style={{ width: `${quality.score}%` }} />
                </div>
                <div className="text-sm font-medium text-theme-text-primary">{quality.score}/100</div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <QualityRow label="Eliminazioni post-creazione" value={quality.deletes} />
                <QualityRow label="Modifiche multiple" value={quality.repeatedEdits} />
                <QualityRow label="Annullamenti" value={quality.cancellations} />
                <QualityRow label="Pratiche riaperte" value={0} tag="Fase C" />
                <QualityRow label="Reclami collegati" value={0} tag="Fase C" />
                <QualityRow label="Doppie lavorazioni" value={0} tag="Fase C" />
              </div>
            </Section>

            {/* SECTION 6 — SEZIONE ECONOMICA */}
            <Section title="Attività economiche gestite" subtitle={`Totale movimentato: ${eur(stats.totalAmount)}`}>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 text-xs">
                <EconomicTile label="Incassi (segna pagato)" value={stats.economic.incassi} />
                <EconomicTile label="Pagamenti parziali" value={stats.economic.parziali} />
                <EconomicTile label="Wallet caricati" value={stats.economic.wallet} />
                <EconomicTile label="Cauzioni cassa" value={stats.economic.cauzioni} />
                <EconomicTile label="Penali applicate" value={stats.economic.penali} />
                <EconomicTile label="Danni registrati" value={stats.economic.danni} />
                <EconomicTile label="Fatture generate" value={stats.economic.fatture} />
                <EconomicTile label="Preventivi inviati" value={stats.economic.preventivi} />
              </div>
              <div className="mt-3 text-xs text-theme-text-muted">
                Insoluti aperti / recuperati e rimborsi: <span className="text-amber-500">disponibili in Fase C</span> (richiedono join con tabelle insoluti & rimborsi).
              </div>
            </Section>

            {/* SECTION 7 — rimossa: il cross-check usava ore stimate dal log
                attivita', che la direzione ha chiesto di non mostrare. Le ore
                reali sono in Rilevazione Orari. */}

            {/* SECTION 8 — INSIGHT FINALE AUTOMATICO */}
            <Section title="Insight automatico" subtitle="Sintesi generata dai KPI del periodo">
              <div className="bg-dr7-gold/10 border border-dr7-gold/30 rounded-xl p-4">
                <div className="text-base text-theme-text-primary leading-relaxed">{insight}</div>
              </div>
            </Section>

            {/* SECTION 9 — BLOCCO CONSULENTE DEL LAVORO */}
            <Section title="Dati paghe e consulente del lavoro" subtitle="Esportazione mensile e invio automatico — completi nella Fase C">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <PayrollRow label="Mese di riferimento" value={dateFrom.slice(0, 7)} />
                <PayrollRow label="Dipendente" value={selected.nome || selected.email} />
                <PayrollRow label="Sede" value="—" tag="Fase B" />
                <PayrollRow label="Giorni lavorati" value={String(stats.activeDays)} />
                <PayrollRow label="Ore ordinarie" value="—" tag="Fase C" />
                <PayrollRow label="Straordinari" value="—" tag="Fase C" />
                <PayrollRow label="Assenze" value="—" tag="Fase C" />
                <PayrollRow label="Ferie" value="—" tag="Fase C" />
                <PayrollRow label="Permessi" value="—" tag="Fase C" />
                <PayrollRow label="Malattia" value="—" tag="Fase C" />
                <PayrollRow label="Stato invio consulente" value="Da inviare" tag="Fase C" />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={exportCSV} className="px-3 py-2 text-xs rounded-lg border border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover transition-colors">Esporta riepilogo CSV</button>
                <button onClick={sendToConsulente} className="px-3 py-2 text-xs rounded-lg border border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover transition-colors">Invia bozza consulente</button>
                <span className="text-xs text-theme-text-muted self-center">Invio automatico mensile in arrivo (Fase C)</span>
              </div>
            </Section>

            {/* SECTION 10 — TIMELINE ATTIVITÀ (long, at end) */}
            <Section title="Timeline attività operative" subtitle="Log dettagliato con cliente, veicolo, pratica collegata">
              <div className="flex flex-wrap gap-2 mb-3">
                <div>
                  <label className="block text-[10px] font-medium text-theme-text-muted mb-1">Da</label>
                  <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="px-2 py-1.5 bg-theme-input-bg border border-theme-input-border rounded-full text-theme-text-primary text-xs focus:outline-none focus:border-dr7-gold" />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-theme-text-muted mb-1">A</label>
                  <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="px-2 py-1.5 bg-theme-input-bg border border-theme-input-border rounded-full text-theme-text-primary text-xs focus:outline-none focus:border-dr7-gold" />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-theme-text-muted mb-1">Azione</label>
                  <select value={actionFilter} onChange={e => setActionFilter(e.target.value)} className="px-2 py-1.5 bg-theme-input-bg border border-theme-input-border rounded-full text-theme-text-primary text-xs focus:outline-none focus:border-dr7-gold">
                    <option value="">Tutte</option>
                    {ACTION_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
              </div>
              {logsLoading ? <div className="text-theme-text-muted text-center py-8">Caricamento log...</div> :
                logs.length === 0 ? <div className="text-theme-text-muted text-center py-8">Nessuna attività trovata.</div> :
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-theme-border text-theme-text-muted text-left">
                          <th className="py-3 px-3 font-medium">Data/Ora</th>
                          <th className="py-3 px-3 font-medium">Azione</th>
                          <th className="py-3 px-3 font-medium">Dettaglio</th>
                          <th className="py-3 px-3 font-medium">Importo</th>
                          <th className="py-3 px-3 font-medium w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {logs.map(log => {
                          const { title, meta } = formatAdminLog(log)
                          const entityLabel = formatEntityLabel(log)
                          const isExpanded = expandedIds.has(log.id)
                          const hasDetails = log.details && Object.keys(log.details).length > 0
                          const amt = extractAmount(log)
                          return (
                            <Fragment key={log.id}>
                              <tr onClick={() => {
                                if (!hasDetails) return
                                setExpandedIds(prev => { const n = new Set(prev); if (n.has(log.id)) n.delete(log.id); else n.add(log.id); return n })
                              }} className={`border-b border-theme-border/50 transition-colors ${hasDetails ? 'cursor-pointer hover:bg-theme-bg-hover' : ''}`}>
                                <td className="py-3 px-3 whitespace-nowrap text-theme-text-secondary align-top">{formatDateTime(log.created_at)}</td>
                                <td className="py-3 px-3 align-top"><span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-dr7-gold/10 text-dr7-gold">{title}</span></td>
                                <td className="py-3 px-3 text-theme-text-secondary align-top">
                                  {meta && <div className="text-sm">{meta}</div>}
                                  {entityLabel && <div className="text-xs text-theme-text-muted mt-0.5 font-mono">{entityLabel}</div>}
                                  {!meta && !entityLabel && <span className="text-theme-text-muted">—</span>}
                                </td>
                                <td className="py-3 px-3 text-right whitespace-nowrap text-theme-text-secondary align-top">{amt > 0 ? eur(amt) : '—'}</td>
                                <td className="py-3 px-3 text-theme-text-muted align-top text-xs">{hasDetails && (isExpanded ? '▾' : '▸')}</td>
                              </tr>
                              {isExpanded && hasDetails && (
                                <tr className="border-b border-theme-border/50 bg-theme-bg-tertiary/30">
                                  <td colSpan={5} className="py-2 px-3"><pre className="text-xs text-theme-text-muted font-mono whitespace-pre-wrap break-all">{JSON.stringify(log.details, null, 2)}</pre></td>
                                </tr>
                              )}
                            </Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between mt-4">
                    <button onClick={() => handlePageChange(page - 1)} disabled={page === 0} className="px-4 py-2 text-sm rounded-full border border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors">Precedente</button>
                    <span className="text-sm text-theme-text-muted">Pagina {page + 1}</span>
                    <button onClick={() => handlePageChange(page + 1)} disabled={logs.length < PAGE_SIZE} className="px-4 py-2 text-sm rounded-full border border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors">Successiva</button>
                  </div>
                </>
              }
            </Section>
          </div>

          {/* ─── RIGHT: sidebar ─────────────────────────────────────── */}
          <div className="space-y-6">

            {/* SECTION — STATO OPERATORE (fase B placeholder) */}
            <Section title="Stato operatore">
              <div className="space-y-2 text-sm">
                <SummaryRow label="Stato" value="Attivo" />
                <SummaryRow label="Tipo rapporto" value="Da configurare" />
                <SummaryRow label="Ore contrattuali/sett." value="Da configurare" />
                <SummaryRow label="Ultimo accesso" value={logs[0] ? formatDateTime(logs[0].created_at) : '—'} />
              </div>
              <div className="mt-3 text-[10px] text-theme-text-muted">Profilo HR completo in Fase B</div>
            </Section>

            {/* ALERT */}
            <Section title="Alert e anomalie" subtitle={alerts.length === 0 ? 'Nessuna anomalia rilevata' : `${alerts.length} segnalazione/i`}>
              {alerts.length === 0 ?
                <div className="text-theme-text-muted text-sm py-2">✓ Tutto regolare nel periodo.</div> :
                <div className="space-y-2">{alerts.map((a, i) => <AlertItem key={i} severity={a.severity} title={a.title} detail={a.detail} />)}</div>
              }
            </Section>

            {/* RIEPILOGO PERIODO */}
            <Section title="Riepilogo periodo">
              <SummaryRow label="Periodo" value={`${dateFrom} → ${dateTo}`} />
              <SummaryRow label="Giorni attivi" value={String(stats.activeDays)} />
              <SummaryRow label="Attività totali" value={String(stats.totalActivities)} />
              <SummaryRow label="Movimentato" value={eur(stats.totalAmount)} />
              <SummaryRow label="Media team" value={`${teamAvg.toFixed(0)} att.`} />
              <SummaryRow label="Mese precedente" value={`${prevStats.totalActivities} att.`} />
            </Section>

            {/* DISTRIBUZIONE */}
            <Section title="Distribuzione attività">
              <DistributionList byCategory={stats.byCategory} total={stats.totalActivities} />
            </Section>

            {/* AZIONI RAPIDE */}
            <Section title="Azioni rapide">
              <div className="space-y-2">
                <ActionRow label="Esporta CSV" emoji="⬇" onClick={exportCSV} disabled={aggLogs.length === 0} />
                <ActionRow label="Stampa / PDF" emoji="🖨" onClick={() => window.print()} />
                <ActionRow label="Invia bozza consulente" emoji="📨" onClick={sendToConsulente} />
                <ActionRow label="Aggiorna dati" emoji="↻" onClick={() => { if (selectedAdmin) { loadLogs(selectedAdmin, page); loadAggregations(selectedAdmin) } }} />
                <ActionRow label="Filtra solo login" emoji="🔑" onClick={() => setActionFilter('login')} />
                <ActionRow label="Reset filtri" emoji="✕" onClick={() => { setActionFilter(''); setPeriodPreset('mese') }} />
                <ActionRow label="Apri mese precedente" emoji="◀" onClick={() => setPeriodPreset('mese-prec')} />
                <div className="pt-2 mt-2 border-t border-theme-border/40 space-y-1 text-[10px] text-theme-text-muted">
                  <div>Aggiungi nota interna · <span className="text-amber-500">Fase C</span></div>
                  <div>Approva ore · <span className="text-amber-500">Fase C</span></div>
                  <div>Correggi timbratura · <span className="text-amber-500">Fase C</span></div>
                  <div>Confronta operatori · <span className="text-amber-500">Fase C</span></div>
                </div>
              </div>
            </Section>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Aggregation logic ────────────────────────────────────────────────────

interface DayAgg { day: string; first: string; last: string; count: number; hours: number }
interface EconomicAgg { incassi: number; parziali: number; wallet: number; cauzioni: number; penali: number; danni: number; fatture: number; preventivi: number }
interface Stats {
  byCategory: Map<KpiKey, number>
  days: DayAgg[]
  totalHours: number
  totalActivities: number
  activeDays: number
  avgPerDay: number
  peakDay: { day: string; count: number } | null
  totalAmount: number
  economic: EconomicAgg
}

function computeStats(logs: LogEntry[]): Stats {
  const byDay = new Map<string, { first: string; last: string; count: number }>()
  const byCategory = new Map<KpiKey, number>()
  const economic: EconomicAgg = { incassi: 0, parziali: 0, wallet: 0, cauzioni: 0, penali: 0, danni: 0, fatture: 0, preventivi: 0 }
  let totalAmount = 0

  for (const log of logs) {
    const k = dayKey(log.created_at)
    const cur = byDay.get(k)
    if (!cur) byDay.set(k, { first: log.created_at, last: log.created_at, count: 1 })
    else {
      if (log.created_at < cur.first) cur.first = log.created_at
      if (log.created_at > cur.last) cur.last = log.created_at
      cur.count += 1
    }
    const cat = classifyAction(log.action)
    byCategory.set(cat, (byCategory.get(cat) || 0) + 1)

    const amt = extractAmount(log)
    if (amt > 0) {
      totalAmount += amt
      if (log.action === 'mark_paid' || log.action === 'mark_extension_paid' || log.action === 'mark_all_customer_paid' || log.action === 'mark_fattura_item_paid' || log.action === 'mark_type_paid') economic.incassi += amt
      else if (log.action === 'partial_payment') economic.parziali += amt
      else if (log.action === 'cassa_cauzione') economic.cauzioni += amt
      else if (log.action.includes('wallet') || log.action.includes('topup')) economic.wallet += amt
      else if (log.action.includes('penalt') || log.action.includes('penali')) economic.penali += amt
      else if (log.action.includes('danni')) economic.danni += amt
      else if (log.action.includes('fattura')) economic.fatture += amt
      else if (log.action.startsWith('preventivo')) economic.preventivi += amt
    }
  }

  const days: DayAgg[] = Array.from(byDay.entries()).map(([day, v]) => {
    const ms = new Date(v.last).getTime() - new Date(v.first).getTime()
    const hours = Math.min(12, Math.max(0, ms / 3_600_000))
    return { day, first: v.first, last: v.last, count: v.count, hours }
  }).sort((a, b) => b.day.localeCompare(a.day))

  const totalHours = days.reduce((s, d) => s + d.hours, 0)
  const totalActivities = logs.length
  const activeDays = days.length
  const avgPerDay = activeDays > 0 ? totalActivities / activeDays : 0
  const peakDay = days.reduce<{ day: string; count: number } | null>((max, d) => !max || d.count > max.count ? { day: d.day, count: d.count } : max, null)

  return { byCategory, days, totalHours, totalActivities, activeDays, avgPerDay, peakDay, totalAmount, economic }
}

// ─── Alert engine ─────────────────────────────────────────────────────────

interface Alert { severity: 'low' | 'med' | 'high'; title: string; detail: string }

function buildAlerts(logs: LogEntry[], stats: Stats): Alert[] {
  const alerts: Alert[] = []

  // Off-hours activity (before 6 or after 22 Rome)
  const offHours = logs.filter(l => {
    const t = new Date(l.created_at).toLocaleString('en-GB', { timeZone: ROME_TZ, hour: '2-digit', hour12: false })
    const h = parseInt(t, 10)
    return h < 6 || h >= 22
  }).length
  if (offHours > 0) alerts.push({ severity: offHours > 5 ? 'med' : 'low', title: 'Attività fuori orario', detail: `${offHours} azione/i prima delle 06:00 o dopo le 22:00 (Europe/Rome)` })

  // Excessive deletes in single day
  const deletesByDay = new Map<string, number>()
  for (const l of logs) {
    if (!l.action.includes('delete')) continue
    const k = dayKey(l.created_at)
    deletesByDay.set(k, (deletesByDay.get(k) || 0) + 1)
  }
  let maxDeletes = 0; let deleteDay = ''
  deletesByDay.forEach((v, k) => { if (v > maxDeletes) { maxDeletes = v; deleteDay = k } })
  if (maxDeletes >= 5) alerts.push({ severity: 'high', title: 'Molte eliminazioni concentrate', detail: `${maxDeletes} eliminazioni il ${deleteDay}` })
  else if (maxDeletes >= 3) alerts.push({ severity: 'med', title: 'Eliminazioni elevate', detail: `${maxDeletes} eliminazioni il ${deleteDay}` })

  // Low activity day (<2 actions but >0)
  const lowDays = stats.days.filter(d => d.count <= 2 && d.hours < 1).length
  if (lowDays >= 3) alerts.push({ severity: 'low', title: 'Giornate a bassa attività', detail: `${lowDays} giorni con ≤2 azioni e <1 h stimata` })

  // High hours / no commensurate activity
  const noiseDays = stats.days.filter(d => d.hours >= 6 && d.count <= 5).length
  if (noiseDays > 0) alerts.push({ severity: 'med', title: 'Ore alte / poche attività', detail: `${noiseDays} giorno/i con ≥6 h ma ≤5 azioni — possibile incoerenza` })

  // Penali/danni voids
  const penaltyDeletes = logs.filter(l => l.action === 'delete_penalty' || (l.action === 'edit_booking' && l.details?.changes?.includes?.('penalty'))).length
  if (penaltyDeletes > 0) alerts.push({ severity: 'med', title: 'Penali rimosse/modificate', detail: `${penaltyDeletes} azione/i sensibili` })

  // Mass-send WhatsApp
  const bulks = logs.filter(l => l.action === 'whatsapp_bulk_send').length
  if (bulks > 5) alerts.push({ severity: 'low', title: 'Invii massivi frequenti', detail: `${bulks} invii WhatsApp massivi nel periodo` })

  return alerts
}

// ─── Quality scoring ──────────────────────────────────────────────────────

interface Quality { score: number; label: 'Ottimo' | 'Buono' | 'Sufficiente' | 'Critico'; deletes: number; repeatedEdits: number; cancellations: number }

function buildQuality(logs: LogEntry[]): Quality {
  const deletes = logs.filter(l => l.action.includes('delete')).length
  const cancellations = logs.filter(l => l.action.includes('cancel') || l.action === 'preventivo_rejected').length
  // Repeated edits: same entity_id edited 3+ times
  const editCounts = new Map<string, number>()
  for (const l of logs) {
    if (!l.action.includes('edit')) continue
    if (!l.entity_id) continue
    editCounts.set(l.entity_id, (editCounts.get(l.entity_id) || 0) + 1)
  }
  let repeatedEdits = 0
  editCounts.forEach(v => { if (v >= 3) repeatedEdits += 1 })

  // Score formula: start at 100, subtract for negative signals
  let score = 100
  score -= Math.min(30, deletes * 2)
  score -= Math.min(20, cancellations * 3)
  score -= Math.min(20, repeatedEdits * 5)
  if (score < 0) score = 0

  const label: Quality['label'] = score >= 85 ? 'Ottimo' : score >= 70 ? 'Buono' : score >= 50 ? 'Sufficiente' : 'Critico'
  return { score, label, deletes, repeatedEdits, cancellations }
}

function qualityBadgeClass(label: Quality['label']): string {
  if (label === 'Ottimo') return 'bg-emerald-100 text-emerald-700'
  if (label === 'Buono') return 'bg-sky-100 text-sky-700'
  if (label === 'Sufficiente') return 'bg-amber-100 text-amber-700'
  return 'bg-rose-100 text-rose-700'
}

// ─── Insight builder ──────────────────────────────────────────────────────

function buildInsight(stats: Stats, prev: Stats, alerts: Alert[], teamAvg: number, myCount: number): string {
  if (stats.totalActivities === 0) return 'Nessuna attività registrata nel periodo selezionato.'

  const productive = stats.activeDays > 0 && (stats.totalActivities / stats.activeDays) >= 8
  const consistent = stats.activeDays >= 15
  const vsTeam = teamAvg > 0 ? myCount / teamAvg : 1
  const vsPrev = prev.totalActivities > 0 ? stats.totalActivities / prev.totalActivities : 1
  const highSeverityAlerts = alerts.filter(a => a.severity === 'high').length
  const medSeverityAlerts = alerts.filter(a => a.severity === 'med').length

  if (productive && consistent && vsTeam > 1.2 && highSeverityAlerts === 0)
    return `Operatore molto produttivo e regolare: ${stats.totalActivities} attività in ${stats.activeDays} giorni, ${(vsTeam * 100 - 100).toFixed(0)}% sopra la media team.`
  if (highSeverityAlerts > 0)
    return `Da monitorare: ${highSeverityAlerts} anomalia/e ad alta priorità rilevata/e nel periodo. Verificare la sezione Alert.`
  if (medSeverityAlerts > 0 && productive)
    return `Alta produttività ma ${medSeverityAlerts} segnalazione/i operativa/e — buon volume con alcuni pattern da rivedere.`
  if (productive && vsPrev > 1.2)
    return `Trend positivo: produttività in crescita del ${(vsPrev * 100 - 100).toFixed(0)}% rispetto al mese precedente.`
  if (!productive && consistent)
    return `Buona presenza ma bassa produttività media (${(stats.totalActivities / Math.max(1, stats.activeDays)).toFixed(1)} att./giorno). Verificare distribuzione del lavoro.`
  if (vsTeam < 0.7 && consistent)
    return `Operatore presente ma sotto la media team (${(vsTeam * 100).toFixed(0)}% del team). Possibile redistribuzione carico.`
  if (stats.activeDays < 5)
    return `Periodo con presenza ridotta: ${stats.activeDays} giorni attivi. Verificare ferie/permessi.`
  return `Operatore regolare: ${stats.totalActivities} attività in ${stats.activeDays} giorni.`
}

// ─── Subcomponents ────────────────────────────────────────────────────────

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-theme-bg-secondary border border-theme-border rounded-2xl p-5">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-theme-text-primary">{title}</h3>
        {subtitle && <div className="text-xs text-theme-text-muted mt-0.5">{subtitle}</div>}
      </div>
      {children}
    </div>
  )
}

function StatTile({ label, value, suffix, hint }: { label: string; value: string; suffix?: string; hint?: string }) {
  return (
    <div className="bg-theme-bg-tertiary/40 border border-theme-border rounded-xl p-3">
      <div className="text-xs text-theme-text-muted">{label}</div>
      <div className="text-xl font-bold text-theme-text-primary mt-1">
        {value}
        {suffix && <span className="text-base font-medium text-theme-text-secondary ml-1">{suffix}</span>}
      </div>
      {hint && <div className="text-[11px] text-theme-text-muted mt-1">{hint}</div>}
    </div>
  )
}

function KpiTile({ label, emoji, value }: { label: string; emoji: string; value: number }) {
  return (
    <div className="bg-theme-bg-tertiary/40 border border-theme-border rounded-xl p-3 text-center">
      <div className="text-xl">{emoji}</div>
      <div className="text-xl font-bold text-theme-text-primary mt-1">{value}</div>
      <div className="text-[11px] text-theme-text-muted mt-0.5">{label}</div>
    </div>
  )
}

function EconomicTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-theme-bg-tertiary/40 border border-theme-border rounded-xl p-3">
      <div className="text-[11px] text-theme-text-muted">{label}</div>
      <div className="text-base font-bold text-theme-text-primary mt-1">{value > 0 ? eur(value) : '—'}</div>
    </div>
  )
}

function ProfileField({ label, value, tag }: { label: string; value: string; tag?: string }) {
  return (
    <div className="bg-theme-bg-tertiary/40 border border-theme-border rounded-lg px-3 py-2">
      <div className="text-[10px] text-theme-text-muted uppercase tracking-wider">{label}</div>
      <div className="text-sm text-theme-text-primary mt-0.5">{value}</div>
      {tag && <div className="text-[9px] text-amber-500 mt-0.5">{tag}</div>}
    </div>
  )
}

/** Inline-editable variant of ProfileField. Click value → input → blur/Enter to save.
 *  `canEdit` from caller (only direzione should be able to write). */
function ProfileFieldEditable({
  label, value, placeholder, onSave, canEdit,
}: {
  label: string
  value: string | null | undefined
  placeholder?: string
  onSave: (next: string) => Promise<void> | void
  canEdit: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value || '')
  const [saving, setSaving] = useState(false)
  const commitLockRef = useRef(false)
  useEffect(() => { setDraft(value || '') }, [value])

  async function commit() {
    if (commitLockRef.current) return
    if (!canEdit) { setEditing(false); return }
    if ((draft || '').trim() === (value || '').trim()) { setEditing(false); return }
    commitLockRef.current = true
    setSaving(true)
    try {
      await onSave(draft.trim())
      setEditing(false)
    } finally {
      setSaving(false)
      commitLockRef.current = false
    }
  }

  return (
    <div className={`bg-theme-bg-tertiary/40 border border-theme-border rounded-lg px-3 py-2 ${canEdit ? 'cursor-text hover:border-dr7-gold/40' : ''}`}>
      <div className="text-[10px] text-theme-text-muted uppercase tracking-wider">{label}</div>
      {editing && canEdit ? (
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value || ''); setEditing(false) } }}
          disabled={saving}
          placeholder={placeholder || ''}
          className="w-full bg-transparent text-sm text-theme-text-primary mt-0.5 border-b border-dr7-gold focus:outline-none px-0 py-0.5"
        />
      ) : (
        <button
          type="button"
          onClick={() => canEdit && setEditing(true)}
          disabled={!canEdit}
          className={`block text-left w-full text-sm mt-0.5 ${value ? 'text-theme-text-primary' : 'text-theme-text-muted italic'} ${canEdit ? '' : 'cursor-default'}`}
        >
          {value || placeholder || '—'}
        </button>
      )}
    </div>
  )
}

function PayrollRow({ label, value, tag }: { label: string; value: string; tag?: string }) {
  return (
    <div className="bg-theme-bg-tertiary/30 border border-theme-border rounded-lg px-3 py-2">
      <div className="text-[10px] text-theme-text-muted uppercase tracking-wider">{label}</div>
      <div className="text-sm text-theme-text-primary mt-0.5">{value}</div>
      {tag && <div className="text-[9px] text-amber-500 mt-0.5">{tag}</div>}
    </div>
  )
}

function QualityRow({ label, value, tag }: { label: string; value: number; tag?: string }) {
  return (
    <div className="flex items-center justify-between bg-theme-bg-tertiary/30 border border-theme-border rounded-lg px-3 py-2">
      <span className="text-theme-text-muted">{label}</span>
      <span className="flex items-center gap-2">
        <span className={`text-sm font-medium ${value > 0 ? 'text-amber-500' : 'text-theme-text-primary'}`}>{value}</span>
        {tag && <span className="text-[9px] text-theme-text-muted">{tag}</span>}
      </span>
    </div>
  )
}

function ProductivityChart({ days }: { days: DayAgg[] }) {
  if (days.length === 0) return <div className="text-theme-text-muted text-sm py-4">Nessun dato.</div>
  const ordered = [...days].reverse()
  const max = Math.max(...ordered.map(d => d.count), 1)
  return (
    <div className="flex items-end gap-1.5 h-40">
      {ordered.map(d => {
        const h = (d.count / max) * 100
        return (
          <div key={d.day} className="flex-1 flex flex-col items-center justify-end min-w-0" title={`${d.day}: ${d.count} attività`}>
            <div className="text-[10px] text-theme-text-muted">{d.count}</div>
            <div className="w-full bg-dr7-gold/70 hover:bg-dr7-gold rounded-t transition-colors" style={{ height: `${h}%`, minHeight: '4px' }} />
            <div className="text-[10px] text-theme-text-muted mt-1 truncate">{d.day.slice(5)}</div>
          </div>
        )
      })}
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-theme-border/40 last:border-b-0 text-sm">
      <span className="text-theme-text-muted">{label}</span>
      <span className="text-theme-text-primary font-medium text-right">{value}</span>
    </div>
  )
}

function DistributionList({ byCategory, total }: { byCategory: Map<KpiKey, number>; total: number }) {
  if (total === 0) return <div className="text-theme-text-muted text-sm">Nessuna attività.</div>
  return (
    <div className="space-y-2">
      {KPI_DEFS.filter(c => (byCategory.get(c.key) || 0) > 0).map(c => {
        const v = byCategory.get(c.key) || 0
        const pct = total > 0 ? (v / total) * 100 : 0
        return (
          <div key={c.key}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-theme-text-secondary">{c.emoji} {c.label}</span>
              <span className="text-theme-text-muted">{v} · {pct.toFixed(0)}%</span>
            </div>
            <div className="h-1.5 bg-theme-bg-tertiary rounded-full overflow-hidden">
              <div className="h-full bg-dr7-gold" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ActionRow({ label, emoji, onClick, disabled }: { label: string; emoji: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-theme-border text-sm text-theme-text-secondary hover:bg-theme-bg-hover hover:border-dr7-gold/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
      <span className="flex items-center gap-2"><span>{emoji}</span><span>{label}</span></span>
      <span className="text-theme-text-muted">›</span>
    </button>
  )
}

function AlertItem({ severity, title, detail }: { severity: 'low' | 'med' | 'high'; title: string; detail: string }) {
  const cls = severity === 'high' ? 'border-rose-300 bg-rose-50 text-rose-800' : severity === 'med' ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-sky-300 bg-sky-50 text-sky-800'
  const icon = severity === 'high' ? '🛑' : severity === 'med' ? '⚠' : 'ℹ'
  return (
    <div className={`border rounded-lg px-3 py-2 ${cls}`}>
      <div className="flex items-start gap-2">
        <span className="text-base leading-tight">{icon}</span>
        <div className="flex-1">
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-xs opacity-80 mt-0.5">{detail}</div>
        </div>
      </div>
    </div>
  )
}

// ─── RosterConfigEditor ──────────────────────────────────────────────────
// Direzione-only. Two side-by-side controls:
// 1) Ordine roster — `centralina_pro_config.config.operatori.roster_order`
//    Array of first-names. Drag-style up/down to reorder. Loaded admins
//    are listed first; names not in the source roster can still be in
//    the order list (kept around for ex-members).
// 2) Esclusi KPI — `centralina_pro_config.config.kpi.excluded_operator_emails`
//    Array of emails whose preventivi are filtered out of the Dashboard
//    KPI rollups (test/dev accounts).
function RosterConfigEditor({ admins }: { admins: Admin[] }) {
  const fallbackOrder = ['Valerio', 'Ilenia', 'Salvatore', 'Ophélie', 'Davide']
  const fallbackKpiExcluded = ['ophe@dr7.app']

  const [order, setOrder] = useState<string[]>(fallbackOrder)
  const [savedOrder, setSavedOrder] = useState<string[]>(fallbackOrder)
  const [kpiExcluded, setKpiExcluded] = useState<string[]>(fallbackKpiExcluded)
  const [savedKpiExcluded, setSavedKpiExcluded] = useState<string[]>(fallbackKpiExcluded)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [newOrderName, setNewOrderName] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()
      if (cancelled) return
      const cfg = (data?.config || {}) as Record<string, unknown>
      const op = (cfg.operatori || {}) as Record<string, unknown>
      if (Array.isArray(op.roster_order) && op.roster_order.length > 0) {
        const v = op.roster_order.map(String)
        setOrder(v); setSavedOrder(v)
      }
      const kpi = (cfg.kpi || {}) as Record<string, unknown>
      if (Array.isArray(kpi.excluded_operator_emails)) {
        const v = kpi.excluded_operator_emails.map(String)
        setKpiExcluded(v); setSavedKpiExcluded(v)
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  const orderDirty = JSON.stringify(order) !== JSON.stringify(savedOrder)
  const kpiDirty = JSON.stringify(kpiExcluded) !== JSON.stringify(savedKpiExcluded)
  const dirty = orderDirty || kpiDirty

  const moveOrder = (i: number, dir: -1 | 1) => {
    const next = [...order]; const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    setOrder(next)
  }
  const addToOrder = () => {
    const v = newOrderName.trim()
    if (!v || order.includes(v)) return
    setOrder([...order, v])
    setNewOrderName('')
  }
  const removeFromOrder = (i: number) => setOrder(order.filter((_, idx) => idx !== i))

  const toggleKpiExcluded = (email: string) => {
    const e = email.toLowerCase()
    setKpiExcluded(prev => prev.includes(e) ? prev.filter(x => x !== e) : [...prev, e])
  }

  const save = async () => {
    if (!dirty || saving) return
    setSaving(true)
    try {
      const { data: existing } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()
      const cfg = (existing?.config || {}) as Record<string, unknown>
      const nextCfg = {
        ...cfg,
        operatori: { ...(cfg.operatori || {} as Record<string, unknown>), roster_order: order },
        kpi:       { ...(cfg.kpi || {} as Record<string, unknown>),       excluded_operator_emails: kpiExcluded },
      }
      const { error } = await supabase
        .from('centralina_pro_config')
        .upsert({ id: 'main', config: nextCfg }, { onConflict: 'id' })
      if (error) throw error
      setSavedOrder(order)
      setSavedKpiExcluded(kpiExcluded)
      toast.success('Configurazione roster salvata')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Errore sconosciuto'
      toast.error(`Errore salvataggio: ${msg}`)
    } finally {
      setSaving(false)
    }
  }

  // Admins not yet listed in roster_order — surface as quick-add chips.
  const missingFromOrder = admins
    .map(a => a.nome || '')
    .filter(n => n && !order.includes(n))

  return (
    <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-5 shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-dr7-gold/15 text-dr7-gold flex items-center justify-center shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12"/>
              <line x1="3" y1="6" x2="21" y2="6"/>
              <line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-theme-text-primary">Configurazione roster</h3>
            <p className="text-[12px] text-theme-text-muted">Ordine di visualizzazione + esclusione operatori dai KPI Dashboard.</p>
          </div>
        </div>
        <span className="text-[11px] text-theme-text-muted">{expanded ? '−' : '+'}</span>
      </button>

      {expanded && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Roster order */}
          <div>
            <h4 className="text-[13px] font-semibold text-theme-text-primary mb-2">Ordine roster (per nome)</h4>
            <div className="space-y-1.5">
              {order.map((name, i) => (
                <div key={`${name}-${i}`} className="flex items-center gap-2 bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5">
                  <span className="text-[11px] text-theme-text-muted w-5 text-right">{i + 1}.</span>
                  <span className="flex-1 text-[13px] text-theme-text-primary">{name}</span>
                  <button onClick={() => moveOrder(i, -1)} disabled={i === 0} className="w-6 h-6 rounded text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30">↑</button>
                  <button onClick={() => moveOrder(i, 1)} disabled={i === order.length - 1} className="w-6 h-6 rounded text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30">↓</button>
                  <button onClick={() => removeFromOrder(i)} className="w-6 h-6 rounded text-red-500 hover:bg-red-500/10 text-sm">×</button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={newOrderName}
                onChange={e => setNewOrderName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addToOrder() } }}
                placeholder="Aggiungi nome…"
                disabled={loading}
                className="flex-1 bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[12px]"
              />
              <button onClick={addToOrder} disabled={!newOrderName.trim()} className="px-3 py-1.5 rounded-md border border-theme-border text-[12px] disabled:opacity-40">+</button>
            </div>
            {missingFromOrder.length > 0 && (
              <div className="mt-2 text-[11px] text-theme-text-muted">
                Non in ordine: {missingFromOrder.map(n => (
                  <button key={n} onClick={() => { setOrder([...order, n]) }} className="ml-1 underline hover:text-theme-text-primary">{n}</button>
                ))}
              </div>
            )}
            <p className="text-[11px] text-theme-text-muted mt-2">
              Nomi non in lista finiscono in coda, ordinati alfabeticamente.
            </p>
          </div>

          {/* KPI exclusion */}
          <div>
            <h4 className="text-[13px] font-semibold text-theme-text-primary mb-2">Esclusi dai KPI (preventivi)</h4>
            <p className="text-[11px] text-theme-text-muted mb-2">
              Spunta gli operatori da escludere dal rollup mensile (account dev/test).
            </p>
            <div className="space-y-1">
              {admins.map(a => {
                const checked = kpiExcluded.includes((a.email || '').toLowerCase())
                return (
                  <label key={a.id} className="flex items-center gap-2 bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 cursor-pointer hover:border-dr7-gold/40">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleKpiExcluded(a.email || '')}
                    />
                    <span className="text-[13px] text-theme-text-primary">{a.nome || a.email.split('@')[0]}</span>
                    <span className="text-[11px] text-theme-text-muted ml-auto">{a.email}</span>
                  </label>
                )
              })}
            </div>
          </div>

          {/* Save bar — spans both columns */}
          <div className="md:col-span-2 flex justify-end pt-2 border-t border-theme-border">
            <button
              onClick={save}
              disabled={!dirty || saving || loading}
              className="px-4 py-1.5 rounded-md bg-dr7-gold text-white text-[12px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
            >{saving ? 'Salvataggio…' : 'Salva configurazione'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
