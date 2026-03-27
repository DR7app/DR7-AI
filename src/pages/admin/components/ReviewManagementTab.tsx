import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../supabaseClient'
import toast from 'react-hot-toast'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReviewCandidate {
  id: string
  source_record_id: string
  customer_name: string
  customer_email: string | null
  customer_phone: string | null
  service_type: 'RENTAL' | 'WASH'
  eligibility_status: 'ELIGIBLE' | 'TO_REVIEW' | 'EXCLUDED'
  review_risk: 'GREEN' | 'YELLOW' | 'RED'
  send_status: 'TO_SEND' | 'SENT' | 'EXCLUDED' | 'FAILED' | 'BLOCKED'
  exclusion_reason_code: string | null
  exclusion_reason_text: string | null
  contact_available_email: boolean
  contact_available_whatsapp: boolean
  is_internal_record: boolean
  created_at: string
  updated_at: string
}

interface DashboardStats {
  eligible: number
  to_review: number
  excluded: number
  to_send: number
  sent: number
  failed: number
}

interface ReviewSettings {
  auto_send_rental: boolean
  auto_send_wash: boolean
  auto_channel_rental: 'EMAIL' | 'WHATSAPP' | 'BOTH' | 'DISABLED'
  auto_channel_wash: 'EMAIL' | 'WHATSAPP' | 'BOTH' | 'DISABLED'
  wash_delay_minutes: number
  require_manual_confirm_yellow: boolean
}

interface ReviewTemplate {
  id: string
  template_key: string
  subject: string | null
  body: string
}

type TabKey = 'ELIGIBLE' | 'TO_REVIEW' | 'EXCLUDED'

const NETLIFY_BASE = '/.netlify/functions'

const DEFAULT_SETTINGS: ReviewSettings = {
  auto_send_rental: false,
  auto_send_wash: false,
  auto_channel_rental: 'DISABLED',
  auto_channel_wash: 'DISABLED',
  wash_delay_minutes: 30,
  require_manual_confirm_yellow: true,
}

const TEMPLATE_KEYS = ['RENTAL_EMAIL', 'RENTAL_WHATSAPP', 'WASH_EMAIL', 'WASH_WHATSAPP'] as const
const TEMPLATE_LABELS: Record<string, string> = {
  RENTAL_EMAIL: 'Email Noleggio',
  RENTAL_WHATSAPP: 'WhatsApp Noleggio',
  WASH_EMAIL: 'Email Lavaggio',
  WASH_WHATSAPP: 'WhatsApp Lavaggio',
}
const PLACEHOLDERS = ['{{customer_name}}', '{{review_link}}']

// ── Component ─────────────────────────────────────────────────────────────────

export default function ReviewManagementTab() {
  // Data state
  const [candidates, setCandidates] = useState<ReviewCandidate[]>([])
  const [stats, setStats] = useState<DashboardStats>({ eligible: 0, to_review: 0, excluded: 0, to_send: 0, sent: 0, failed: 0 })
  const [_settings, setSettings] = useState<ReviewSettings>(DEFAULT_SETTINGS)
  const [_templates, setTemplates] = useState<ReviewTemplate[]>([])

  // UI state
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabKey>('ELIGIBLE')
  const [filterServiceType, setFilterServiceType] = useState<'ALL' | 'RENTAL' | 'WASH'>('ALL')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectAll, setSelectAll] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showSettings, setShowSettings] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [settingsDraft, setSettingsDraft] = useState<ReviewSettings>(DEFAULT_SETTINGS)
  const [templatesDraft, setTemplatesDraft] = useState<ReviewTemplate[]>([])
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [bulkSending, setBulkSending] = useState(false)
  const [evaluating, setEvaluating] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [savingTemplateKey, setSavingTemplateKey] = useState<string | null>(null)

  // ── Data fetching ─────────────────────────────────────────────────────────

  useEffect(() => {
    loadAll()
  }, [])

  useEffect(() => {
    fetchCandidates()
  }, [activeTab, filterServiceType])

  async function loadAll() {
    setLoading(true)
    await Promise.all([fetchSettings(), fetchTemplates()])
    await autoEvaluateAll()
    await Promise.all([fetchCandidates(), fetchStats()])
    setLoading(false)
  }

  async function autoEvaluateAll() {
    const toastId = toast.loading('Caricamento prenotazioni e lavaggi...')
    try {
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

      // Fetch ALL non-cancelled bookings with past end dates in the last 30 days
      const { data: allBookings, error: bErr } = await supabase
        .from('bookings')
        .select('id, service_type, service_name, vehicle_name, dropoff_date, appointment_date')
        .in('status', ['confirmed', 'confermata', 'completed', 'completata', 'active', 'in_corso'])
        .order('created_at', { ascending: false })
        .limit(1000)

      if (bErr) throw bErr

      const now = new Date()
      const allRecords: { id: string; serviceType: 'RENTAL' | 'WASH' }[] = []

      for (const b of (allBookings || [])) {
        const isWash = b.service_type === 'car_wash'

        if (isWash) {
          // Car wash: use appointment_date, exclude rientro/interno
          if (!b.appointment_date) continue
          const apptDate = new Date(b.appointment_date)
          if (apptDate > now || apptDate < thirtyDaysAgo) continue
          const name = ((b.service_name || b.vehicle_name || '') as string).toLowerCase()
          if (name.includes('rientro') || name.includes('interno')) continue
          allRecords.push({ id: b.id, serviceType: 'WASH' })
        } else {
          // Rental: use dropoff_date
          if (!b.dropoff_date) continue
          const dropoff = new Date(b.dropoff_date)
          if (dropoff > now || dropoff < thirtyDaysAgo) continue
          allRecords.push({ id: b.id, serviceType: 'RENTAL' })
        }
      }

      let done = 0
      for (const record of allRecords) {
        try {
          await fetch(`${NETLIFY_BASE}/review-evaluate-candidate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourceRecordId: record.id, serviceType: record.serviceType }),
          })
        } catch { /* skip */ }
        done++
        if (done % 5 === 0) toast.loading(`Valutazione: ${done}/${allRecords.length}`, { id: toastId })
      }

      toast.dismiss(toastId)
      toast.success(`${done} prenotazioni valutate`)
      await Promise.all([fetchCandidates(), fetchStats()])
    } catch {
      toast.dismiss(toastId)
    }
  }

  async function fetchCandidates() {
    try {
      const params = new URLSearchParams({
        eligibility_status: activeTab,
        service_type: filterServiceType,
      })
      const res = await fetch(`${NETLIFY_BASE}/review-candidates?${params}`)
      if (!res.ok) throw new Error('Errore caricamento candidati')
      const data = await res.json()
      setCandidates(data.candidates || data || [])
    } catch (err: any) {
      console.error('fetchCandidates error:', err)
      toast.error('Errore nel caricamento dei candidati recensione')
    }
  }

  async function fetchStats() {
    try {
      const res = await fetch(`${NETLIFY_BASE}/review-dashboard-stats`)
      if (!res.ok) throw new Error('Errore caricamento statistiche')
      const data = await res.json()
      const s = data.stats || data
      setStats({
        eligible: s.eligible_count || s.eligible || 0,
        to_review: s.to_review_count || s.to_review || 0,
        excluded: s.excluded_count || s.excluded || 0,
        to_send: s.to_send_count || s.to_send || 0,
        sent: s.sent_count || s.sent || 0,
        failed: s.failed_count || s.failed || 0,
      })
    } catch (err: any) {
      console.error('fetchStats error:', err)
    }
  }

  async function fetchSettings() {
    try {
      const res = await fetch(`${NETLIFY_BASE}/review-settings`)
      if (!res.ok) throw new Error('Errore caricamento impostazioni')
      const data = await res.json()
      const s = { ...DEFAULT_SETTINGS, ...data }
      setSettings(s)
      setSettingsDraft(s)
    } catch (err: any) {
      console.error('fetchSettings error:', err)
    }
  }

  async function fetchTemplates() {
    try {
      const res = await fetch(`${NETLIFY_BASE}/review-settings?type=templates`)
      if (res.ok) {
        const data = await res.json()
        setTemplates(data.templates || data || [])
        setTemplatesDraft(data.templates || data || [])
      } else {
        // Initialize defaults if endpoint doesn't exist yet
        const defaults: ReviewTemplate[] = TEMPLATE_KEYS.map(key => ({
          id: key,
          template_key: key,
          subject: key.includes('EMAIL') ? 'Come e\u0300 stata la tua esperienza con DR7?' : null,
          body: `Gentile {{customer_name}},\n\nGrazie per aver scelto DR7! Ci farebbe piacere conoscere la tua opinione.\n\nLascia una recensione qui: {{review_link}}\n\nGrazie!\nIl team DR7`,
        }))
        setTemplates(defaults)
        setTemplatesDraft(defaults)
      }
    } catch (err: any) {
      console.error('fetchTemplates error:', err)
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleSend(candidateId: string, channel: 'EMAIL' | 'WHATSAPP' | 'BOTH') {
    const channelMap: Record<string, string> = { EMAIL: 'EMAIL_ONLY', WHATSAPP: 'WHATSAPP_ONLY', BOTH: 'EMAIL_AND_WHATSAPP' }
    setSendingId(candidateId)
    try {
      const res = await fetch(`${NETLIFY_BASE}/review-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId, sendChannel: channelMap[channel] || 'EMAIL_AND_WHATSAPP', sendMode: 'MANUAL' }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Errore invio')
      }
      toast.success('Richiesta recensione inviata!')
      await Promise.all([fetchCandidates(), fetchStats()])
    } catch (err: any) {
      toast.error(err.message || 'Errore durante l\'invio')
    } finally {
      setSendingId(null)
    }
  }

  async function handleApproveAndSend(candidateId: string) {
    if (!confirm('Confermi di voler approvare e inviare la richiesta di recensione a questo cliente?')) return
    setSendingId(candidateId)
    try {
      // First approve (move to ELIGIBLE)
      const res = await fetch(`${NETLIFY_BASE}/review-evaluate-candidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId, action: 'approve' }),
      })
      if (!res.ok) throw new Error('Errore approvazione')

      // Then send
      const sendRes = await fetch(`${NETLIFY_BASE}/review-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId, sendChannel: 'EMAIL_AND_WHATSAPP', sendMode: 'MANUAL' }),
      })
      if (!sendRes.ok) throw new Error('Approvato ma errore durante l\'invio')

      toast.success('Approvato e inviato!')
      await Promise.all([fetchCandidates(), fetchStats()])
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSendingId(null)
    }
  }

  async function handleExclude(candidateId: string) {
    const reason = prompt('Motivo esclusione (opzionale):')
    if (reason === null) return
    setSendingId(candidateId)
    try {
      const res = await fetch(`${NETLIFY_BASE}/review-evaluate-candidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId, action: 'exclude', reason: reason || undefined }),
      })
      if (!res.ok) throw new Error('Errore esclusione')
      toast.success('Cliente escluso dalle recensioni')
      await Promise.all([fetchCandidates(), fetchStats()])
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSendingId(null)
    }
  }

  async function handleBulkSend() {
    const eligibleToSend = filteredCandidates.filter(c => c.send_status === 'TO_SEND' && (c.customer_email || c.customer_phone))
    if (eligibleToSend.length === 0) {
      toast.error('Nessun candidato idoneo da inviare')
      return
    }
    if (!confirm(`Inviare la richiesta di recensione a ${eligibleToSend.length} clienti idonei?`)) return

    setBulkSending(true)
    let success = 0
    let failed = 0

    const toastId = toast.loading(`Invio in corso: 0/${eligibleToSend.length}`)

    for (const candidate of eligibleToSend) {
      try {
        const channel = candidate.customer_email && candidate.customer_phone
          ? 'BOTH'
          : candidate.customer_email
            ? 'EMAIL'
            : 'WHATSAPP'

        const res = await fetch(`${NETLIFY_BASE}/review-send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ candidateId: candidate.id, sendChannel: channel === 'BOTH' ? 'EMAIL_AND_WHATSAPP' : channel === 'EMAIL' ? 'EMAIL_ONLY' : 'WHATSAPP_ONLY', sendMode: 'AUTOMATIC' }),
        })
        if (res.ok) {
          success++
        } else {
          failed++
        }
        toast.loading(`Invio in corso: ${success + failed}/${eligibleToSend.length}`, { id: toastId })
      } catch {
        failed++
      }
    }

    toast.dismiss(toastId)
    toast.success(`Invio completato: ${success} riusciti, ${failed} falliti`)
    setBulkSending(false)
    await Promise.all([fetchCandidates(), fetchStats()])
  }

  async function handleBulkEvaluate() {
    if (!confirm('Valutare tutte le prenotazioni e lavaggi completati negli ultimi 30 giorni?')) return
    setEvaluating(true)
    const toastId = toast.loading('Valutazione prenotazioni e lavaggi recenti...')

    try {
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

      // Rentals: include confirmed/completed bookings with past dropoff_date
      // (most bookings stay 'confirmed' even after return)
      // Use or() to include NULL service_type (old bookings) + car_rental + rental
      const { data: rentals, error: rErr } = await supabase
        .from('bookings')
        .select('id, service_type')
        .in('status', ['confirmed', 'confermata', 'completed', 'completata', 'active', 'in_corso'])
        .or('service_type.is.null,service_type.eq.car_rental,service_type.eq.rental,service_type.eq.')
        .lte('dropoff_date', new Date().toISOString())
        .gte('dropoff_date', thirtyDaysAgo.toISOString().split('T')[0])
        .order('dropoff_date', { ascending: false })

      if (rErr) throw rErr

      // Car washes: filter by appointment_date, exclude rientro
      const { data: washes, error: wErr } = await supabase
        .from('bookings')
        .select('id, service_type, service_name, vehicle_name')
        .in('status', ['confirmed', 'confermata', 'completed', 'completata'])
        .eq('service_type', 'car_wash')
        .lte('appointment_date', new Date().toISOString().split('T')[0])
        .gte('appointment_date', thirtyDaysAgo.toISOString().split('T')[0])
        .order('appointment_date', { ascending: false })

      if (wErr) throw wErr

      const filteredWashes = (washes || []).filter(w => {
        const name = ((w.service_name || w.vehicle_name || '') as string).toLowerCase()
        return !name.includes('rientro') && !name.includes('interno')
      })

      const allRecords: { id: string; serviceType: 'RENTAL' | 'WASH' }[] = [
        ...(rentals || []).map(b => ({ id: b.id, serviceType: 'RENTAL' as const })),
        ...filteredWashes.map(b => ({ id: b.id, serviceType: 'WASH' as const })),
      ]

      let evaluated = 0
      let skipped = 0

      for (const record of allRecords) {
        try {
          const res = await fetch(`${NETLIFY_BASE}/review-evaluate-candidate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sourceRecordId: record.id,
              serviceType: record.serviceType,
            }),
          })
          if (res.ok) {
            evaluated++
          } else {
            skipped++
          }
          toast.loading(`Valutazione: ${evaluated + skipped}/${allRecords.length} (${record.serviceType})`, { id: toastId })
        } catch {
          skipped++
        }
      }

      toast.dismiss(toastId)
      const rentalCount = allRecords.filter(r => r.serviceType === 'RENTAL').length
      const washCount = allRecords.filter(r => r.serviceType === 'WASH').length
      toast.success(`Valutazione completata: ${evaluated} valutati, ${skipped} saltati (${rentalCount} noleggi, ${washCount} lavaggi)`)
      await Promise.all([fetchCandidates(), fetchStats()])
    } catch (err: any) {
      toast.dismiss(toastId)
      toast.error('Errore durante la valutazione: ' + (err.message || 'Errore'))
    } finally {
      setEvaluating(false)
    }
  }

  async function handleSaveSettings() {
    setSavingSettings(true)
    try {
      const res = await fetch(`${NETLIFY_BASE}/review-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsDraft),
      })
      if (!res.ok) throw new Error('Errore salvataggio impostazioni')
      setSettings(settingsDraft)
      toast.success('Impostazioni salvate')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSavingSettings(false)
    }
  }

  async function handleSaveTemplate(template: ReviewTemplate) {
    setSavingTemplateKey(template.template_key)
    try {
      const res = await fetch(`${NETLIFY_BASE}/review-settings?type=templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(template),
      })
      if (!res.ok) throw new Error('Errore salvataggio template')
      toast.success(`Template "${TEMPLATE_LABELS[template.template_key]}" salvato`)
      // Update main state
      setTemplates(prev => prev.map(t => t.template_key === template.template_key ? template : t))
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSavingTemplateKey(null)
    }
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectAll) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredCandidates.map(c => c.id)))
    }
    setSelectAll(!selectAll)
  }

  // ── Filtering ─────────────────────────────────────────────────────────────

  const filteredCandidates = useMemo(() => {
    return candidates.filter(c => {
      if (searchTerm) {
        const term = searchTerm.toLowerCase()
        const matchesSearch =
          (c.customer_name || '').toLowerCase().includes(term) ||
          (c.customer_email || '').toLowerCase().includes(term) ||
          (c.customer_phone || '').toLowerCase().includes(term)
        if (!matchesSearch) return false
      }
      return true
    })
  }, [candidates, searchTerm])

  // ── Render helpers ────────────────────────────────────────────────────────

  function getServiceBadge(type: string) {
    if (type === 'RENTAL') return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-600 text-white">Noleggio</span>
    if (type === 'WASH') return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-cyan-600 text-white">Lavaggio</span>
    return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-600 text-white">{type}</span>
  }

  function getRiskBadge(level: string) {
    if (level === 'GREEN') return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-600 text-white">Sicuro</span>
    if (level === 'YELLOW') return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-600 text-black">Attenzione</span>
    if (level === 'RED') return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-600 text-white">Non inviare</span>
    return null
  }

  function getSendStatusBadge(status: string) {
    if (status === 'TO_SEND') return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-600 text-black">Da inviare</span>
    if (status === 'SENT') return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-600 text-white">Inviata</span>
    if (status === 'FAILED') return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-600 text-white">Fallita</span>
    return null
  }

  // ── Loading state ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-xl text-theme-text-primary">Caricamento...</div>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex justify-between items-center flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-theme-text-primary">Gestione Recensioni</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleBulkEvaluate}
            disabled={evaluating}
            className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-full hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {evaluating ? 'Valutazione...' : 'Valuta Prenotazioni Recenti'}
          </button>
          <button
            onClick={() => { setShowTemplates(!showTemplates); setShowSettings(false) }}
            className="p-2 bg-theme-bg-tertiary border border-theme-border rounded-full hover:bg-theme-bg-hover transition-colors"
            title="Template"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-theme-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </button>
          <button
            onClick={() => { setShowSettings(!showSettings); setShowTemplates(false) }}
            className="p-2 bg-theme-bg-tertiary border border-theme-border rounded-full hover:bg-theme-bg-hover transition-colors"
            title="Impostazioni"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-theme-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 sm:gap-4 mb-6">
        <div className="bg-theme-bg-tertiary border border-theme-border rounded-3xl p-3 sm:p-4">
          <div className="text-xs sm:text-sm text-theme-text-secondary">Idonei</div>
          <div className="text-2xl sm:text-3xl font-bold text-green-500">{stats.eligible}</div>
        </div>
        <div className="bg-theme-bg-tertiary border border-theme-border rounded-3xl p-3 sm:p-4">
          <div className="text-xs sm:text-sm text-theme-text-secondary">Da Verificare</div>
          <div className="text-2xl sm:text-3xl font-bold text-yellow-500">{stats.to_review}</div>
        </div>
        <div className="bg-theme-bg-tertiary border border-theme-border rounded-3xl p-3 sm:p-4">
          <div className="text-xs sm:text-sm text-theme-text-secondary">Da Inviare</div>
          <div className="text-2xl sm:text-3xl font-bold text-blue-500">{stats.to_send}</div>
        </div>
        <div className="bg-theme-bg-tertiary border border-theme-border rounded-3xl p-3 sm:p-4">
          <div className="text-xs sm:text-sm text-theme-text-secondary">Inviate</div>
          <div className="text-2xl sm:text-3xl font-bold text-green-500">{stats.sent}</div>
        </div>
        <div className="bg-theme-bg-tertiary border border-theme-border rounded-3xl p-3 sm:p-4">
          <div className="text-xs sm:text-sm text-theme-text-secondary">Fallite</div>
          <div className="text-2xl sm:text-3xl font-bold text-red-500">{stats.failed}</div>
        </div>
      </div>

      {/* Settings Panel (collapsible) */}
      {showSettings && (
        <div className="bg-theme-bg-secondary border border-theme-border rounded-3xl p-6 mb-6">
          <h3 className="text-lg font-bold text-theme-text-primary mb-4">Impostazioni Recensioni</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Auto invio Noleggio */}
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settingsDraft.auto_send_rental}
                onChange={e => setSettingsDraft({ ...settingsDraft, auto_send_rental: e.target.checked })}
                className="w-5 h-5 rounded accent-dr7-gold"
              />
              <span className="text-sm text-theme-text-primary">Auto invio Noleggio</span>
            </label>

            {/* Auto invio Lavaggio */}
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settingsDraft.auto_send_wash}
                onChange={e => setSettingsDraft({ ...settingsDraft, auto_send_wash: e.target.checked })}
                className="w-5 h-5 rounded accent-dr7-gold"
              />
              <span className="text-sm text-theme-text-primary">Auto invio Lavaggio</span>
            </label>

            {/* Richiedi conferma manuale per casi gialli */}
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settingsDraft.require_manual_confirm_yellow}
                onChange={e => setSettingsDraft({ ...settingsDraft, require_manual_confirm_yellow: e.target.checked })}
                className="w-5 h-5 rounded accent-dr7-gold"
              />
              <span className="text-sm text-theme-text-primary">Richiedi conferma manuale per casi gialli</span>
            </label>

            {/* Canale auto noleggio */}
            <div>
              <label className="block text-sm text-theme-text-secondary mb-1">Canale auto noleggio</label>
              <select
                value={settingsDraft.auto_channel_rental}
                onChange={e => setSettingsDraft({ ...settingsDraft, auto_channel_rental: e.target.value as any })}
                className="w-full px-3 py-2 bg-theme-bg-primary border border-theme-border rounded-xl text-sm text-theme-text-primary"
              >
                <option value="DISABLED">Disattivato</option>
                <option value="EMAIL">Email</option>
                <option value="WHATSAPP">WhatsApp</option>
                <option value="BOTH">Entrambi</option>
              </select>
            </div>

            {/* Canale auto lavaggio */}
            <div>
              <label className="block text-sm text-theme-text-secondary mb-1">Canale auto lavaggio</label>
              <select
                value={settingsDraft.auto_channel_wash}
                onChange={e => setSettingsDraft({ ...settingsDraft, auto_channel_wash: e.target.value as any })}
                className="w-full px-3 py-2 bg-theme-bg-primary border border-theme-border rounded-xl text-sm text-theme-text-primary"
              >
                <option value="DISABLED">Disattivato</option>
                <option value="EMAIL">Email</option>
                <option value="WHATSAPP">WhatsApp</option>
                <option value="BOTH">Entrambi</option>
              </select>
            </div>

            {/* Ritardo lavaggio */}
            <div>
              <label className="block text-sm text-theme-text-secondary mb-1">Ritardo lavaggio (minuti)</label>
              <input
                type="number"
                min={0}
                value={settingsDraft.wash_delay_minutes}
                onChange={e => setSettingsDraft({ ...settingsDraft, wash_delay_minutes: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 bg-theme-bg-primary border border-theme-border rounded-xl text-sm text-theme-text-primary"
              />
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <button
              onClick={handleSaveSettings}
              disabled={savingSettings}
              className="px-6 py-2 bg-dr7-gold text-white font-semibold rounded-full hover:bg-[#247a6f] transition-colors disabled:opacity-50"
            >
              {savingSettings ? 'Salvataggio...' : 'Salva Impostazioni'}
            </button>
          </div>
        </div>
      )}

      {/* Template Editor (collapsible) */}
      {showTemplates && (
        <div className="bg-theme-bg-secondary border border-theme-border rounded-3xl p-6 mb-6">
          <h3 className="text-lg font-bold text-theme-text-primary mb-2">Template Messaggi</h3>
          <p className="text-xs text-theme-text-secondary mb-4">
            Placeholder disponibili: {PLACEHOLDERS.map(p => <code key={p} className="mx-1 px-1.5 py-0.5 bg-theme-bg-hover rounded text-dr7-gold">{p}</code>)}
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {TEMPLATE_KEYS.map(key => {
              const t = templatesDraft.find(t => t.template_key === key) || {
                id: key,
                template_key: key,
                subject: key.includes('EMAIL') ? '' : null,
                body: '',
              }
              const isEmail = key.includes('EMAIL')
              return (
                <div key={key} className="bg-theme-bg-primary border border-theme-border rounded-2xl p-4">
                  <h4 className="text-sm font-semibold text-theme-text-primary mb-3">{TEMPLATE_LABELS[key]}</h4>
                  {isEmail && (
                    <div className="mb-2">
                      <label className="block text-xs text-theme-text-secondary mb-1">Oggetto</label>
                      <input
                        type="text"
                        value={t.subject || ''}
                        onChange={e => {
                          setTemplatesDraft(prev => prev.map(tp =>
                            tp.template_key === key ? { ...tp, subject: e.target.value } : tp
                          ))
                        }}
                        className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-xl text-sm text-theme-text-primary"
                      />
                    </div>
                  )}
                  <div className="mb-3">
                    <label className="block text-xs text-theme-text-secondary mb-1">Corpo messaggio</label>
                    <textarea
                      rows={5}
                      value={t.body}
                      onChange={e => {
                        setTemplatesDraft(prev => prev.map(tp =>
                          tp.template_key === key ? { ...tp, body: e.target.value } : tp
                        ))
                      }}
                      className="w-full px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-xl text-sm text-theme-text-primary resize-y"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      onClick={() => handleSaveTemplate(t)}
                      disabled={savingTemplateKey === key}
                      className="px-4 py-1.5 bg-dr7-gold text-white text-sm font-semibold rounded-full hover:bg-[#247a6f] transition-colors disabled:opacity-50"
                    >
                      {savingTemplateKey === key ? 'Salvataggio...' : 'Salva'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {([
          { key: 'ELIGIBLE' as TabKey, label: 'Idonei', count: stats.eligible },
          { key: 'TO_REVIEW' as TabKey, label: 'Da Verificare', count: stats.to_review },
        ]).map(tab => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); setSelectedIds(new Set()); setSelectAll(false) }}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
              activeTab === tab.key
                ? 'bg-dr7-gold text-white'
                : 'bg-theme-bg-tertiary text-theme-text-secondary border border-theme-border hover:bg-theme-bg-hover'
            }`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      {/* Filters Row */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          value={filterServiceType}
          onChange={e => setFilterServiceType(e.target.value as any)}
          className="px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-xl text-sm text-theme-text-primary"
        >
          <option value="ALL">Tutti</option>
          <option value="RENTAL">Noleggio</option>
          <option value="WASH">Lavaggio</option>
        </select>
        <input
          type="text"
          placeholder="Cerca per nome, email, telefono..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-xl text-sm text-theme-text-primary placeholder-theme-text-secondary"
        />
        {activeTab === 'ELIGIBLE' && (
          <>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selectAll}
                onChange={toggleSelectAll}
                className="w-4 h-4 rounded accent-dr7-gold"
              />
              <span className="text-sm text-theme-text-secondary">Seleziona Tutti</span>
            </label>
            <button
              onClick={handleBulkSend}
              disabled={bulkSending}
              className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-full hover:bg-green-700 transition-colors disabled:opacity-50"
            >
              {bulkSending ? 'Invio in corso...' : 'Invia a Tutti gli Idonei'}
            </button>
          </>
        )}
      </div>

      {/* Alert banner for TO_REVIEW tab */}
      {activeTab === 'TO_REVIEW' && (
        <div className="bg-yellow-900/30 border border-yellow-600/50 rounded-2xl p-3 mb-4 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-yellow-500 shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <span className="text-sm text-yellow-300">Questi clienti richiedono verifica manuale prima dell'invio della richiesta di recensione.</span>
        </div>
      )}

      {/* Table */}
      <div className="bg-theme-bg-secondary border border-theme-border rounded-3xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-theme-bg-hover border-b border-theme-border">
              <tr>
                {activeTab === 'ELIGIBLE' && (
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary w-10">
                    <input
                      type="checkbox"
                      checked={selectAll}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded accent-dr7-gold"
                    />
                  </th>
                )}
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Cliente</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Tipo Servizio</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Rischio</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Stato Invio</th>
                {activeTab === 'EXCLUDED' && (
                  <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Motivo Esclusione</th>
                )}
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Contatti</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {filteredCandidates.length === 0 ? (
                <tr>
                  <td
                    colSpan={activeTab === 'EXCLUDED' ? 8 : activeTab === 'ELIGIBLE' ? 8 : 7}
                    className="px-4 py-12 text-center text-theme-text-secondary"
                  >
                    Nessun candidato trovato
                  </td>
                </tr>
              ) : (
                filteredCandidates.map(candidate => (
                  <tr
                    key={candidate.id}
                    className="border-b border-theme-border hover:bg-theme-bg-hover transition-colors"
                  >
                    {/* Checkbox (ELIGIBLE only) */}
                    {activeTab === 'ELIGIBLE' && (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(candidate.id)}
                          onChange={() => toggleSelect(candidate.id)}
                          className="w-4 h-4 rounded accent-dr7-gold"
                        />
                      </td>
                    )}

                    {/* Cliente */}
                    <td className="px-4 py-3 text-sm text-theme-text-primary font-medium">
                      {candidate.customer_name || 'N/A'}
                    </td>

                    {/* Tipo Servizio */}
                    <td className="px-4 py-3 text-sm">
                      {getServiceBadge(candidate.service_type)}
                    </td>

                    {/* Rischio */}
                    <td className="px-4 py-3 text-sm">
                      {getRiskBadge(candidate.review_risk)}
                    </td>

                    {/* Stato Invio */}
                    <td className="px-4 py-3 text-sm">
                      {getSendStatusBadge(candidate.send_status)}
                    </td>

                    {/* Motivo Esclusione (EXCLUDED only) */}
                    {activeTab === 'EXCLUDED' && (
                      <td className="px-4 py-3 text-sm text-red-400">
                        {candidate.exclusion_reason_text || candidate.exclusion_reason_code || '---'}
                      </td>
                    )}

                    {/* Contatti */}
                    <td className="px-4 py-3 text-sm">
                      <div className="flex items-center gap-2">
                        {candidate.customer_email && (
                          <span title={candidate.customer_email} className="text-blue-400 cursor-help">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                          </span>
                        )}
                        {candidate.customer_phone && (
                          <span title={candidate.customer_phone} className="text-green-400 cursor-help">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                            </svg>
                          </span>
                        )}
                        {!candidate.customer_email && !candidate.customer_phone && (
                          <span className="text-theme-text-secondary text-xs">Nessun contatto</span>
                        )}
                      </div>
                    </td>

                    {/* Azioni */}
                    <td className="px-4 py-3">
                      <div className="flex gap-2 flex-wrap">
                        {activeTab === 'ELIGIBLE' && (
                          <>
                            {candidate.customer_email && (
                              <button
                                onClick={() => handleSend(candidate.id, 'EMAIL')}
                                disabled={sendingId === candidate.id}
                                className="px-3 py-1 bg-blue-600 text-white text-xs font-semibold rounded-full hover:bg-blue-700 transition-colors disabled:opacity-50"
                              >
                                Invia Email
                              </button>
                            )}
                            {candidate.customer_phone && (
                              <button
                                onClick={() => handleSend(candidate.id, 'WHATSAPP')}
                                disabled={sendingId === candidate.id}
                                className="px-3 py-1 bg-green-600 text-white text-xs font-semibold rounded-full hover:bg-green-700 transition-colors disabled:opacity-50"
                              >
                                Invia WhatsApp
                              </button>
                            )}
                            {candidate.customer_email && candidate.customer_phone && (
                              <button
                                onClick={() => handleSend(candidate.id, 'BOTH')}
                                disabled={sendingId === candidate.id}
                                className="px-3 py-1 bg-purple-600 text-white text-xs font-semibold rounded-full hover:bg-purple-700 transition-colors disabled:opacity-50"
                              >
                                Invia Entrambi
                              </button>
                            )}
                          </>
                        )}

                        {activeTab === 'TO_REVIEW' && (
                          <>
                            <button
                              onClick={() => handleApproveAndSend(candidate.id)}
                              disabled={sendingId === candidate.id}
                              className="px-3 py-1 bg-green-600 text-white text-xs font-semibold rounded-full hover:bg-green-700 transition-colors disabled:opacity-50"
                            >
                              Approva e Invia
                            </button>
                            <button
                              onClick={() => handleExclude(candidate.id)}
                              disabled={sendingId === candidate.id}
                              className="px-3 py-1 bg-red-600 text-white text-xs font-semibold rounded-full hover:bg-red-700 transition-colors disabled:opacity-50"
                            >
                              Escludi
                            </button>
                          </>
                        )}

                        {activeTab === 'EXCLUDED' && (
                          <span className="text-red-400 text-lg" title="Invio bloccato">
                            &#128683;
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
