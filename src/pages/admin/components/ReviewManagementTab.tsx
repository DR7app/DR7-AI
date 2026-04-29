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
  const [, setSettings] = useState<ReviewSettings>(DEFAULT_SETTINGS)
  const [, setTemplates] = useState<ReviewTemplate[]>([])

  // UI state
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabKey>('ELIGIBLE')
  const [filterServiceType, setFilterServiceType] = useState<'ALL' | 'RENTAL' | 'WASH'>('ALL')
  const [searchTerm, setSearchTerm] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [selectAll, setSelectAll] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showSettings, setShowSettings] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [settingsDraft, setSettingsDraft] = useState<ReviewSettings>(DEFAULT_SETTINGS)
  const [templatesDraft, setTemplatesDraft] = useState<ReviewTemplate[]>([])
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [generatingCodeId, setGeneratingCodeId] = useState<string | null>(null)
  const [bulkSending, setBulkSending] = useState(false)
  const [evaluating, setEvaluating] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [savingTemplateKey, setSavingTemplateKey] = useState<string | null>(null)

  // ── Data fetching ─────────────────────────────────────────────────────────

  useEffect(() => {
    loadAll()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    fetchCandidates()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, filterServiceType])

  async function loadAll() {
    setLoading(true)
    await Promise.all([fetchSettings(), fetchTemplates(), fetchCandidates(), fetchStats()])
    setLoading(false)
    // Evaluate new bookings in background — don't block the UI
    autoEvaluateAll().then(() => {
      fetchCandidates()
      fetchStats()
    })
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
    } catch (err: unknown) {
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
    } catch (err: unknown) {
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
    } catch (err: unknown) {
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
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error(_errMsg || 'Errore durante l\'invio')
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
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error(_errMsg)
    } finally {
      setSendingId(null)
    }
  }

  // Sblocca: reset a candidate back to ELIGIBLE + TO_SEND so they can receive review request again
  async function handleSblocca(candidateId: string) {
    if (!confirm('Sbloccare questo cliente per ricevere nuovamente la richiesta di recensione?')) return
    setSendingId(candidateId)
    try {
      const { error } = await supabase
        .from('review_candidates')
        .update({
          eligibility_status: 'ELIGIBLE',
          send_status: 'TO_SEND',
          review_risk: 'GREEN',
          exclusion_reason_code: null,
          exclusion_reason_text: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', candidateId)
      if (error) throw error
      toast.success('Recensione sbloccata — pronta per invio')
      await Promise.all([fetchCandidates(), fetchStats()])
    } catch (err: unknown) {
      toast.error('Errore: ' + (err instanceof Error ? err.message : String(err)))
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
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error(_errMsg)
    } finally {
      setSendingId(null)
    }
  }

  // Genera due codici sconto reali (supercar €100 + lavaggio €10) tramite
  // generate-review-codes (li scrive in discount_codes con restrizione email/
  // telefono) e invia un WhatsApp usando il template Pro
  // pro_marketing_codice_sconto. Il template lo gestisce l'admin in
  // Messaggi di Sistema Pro — qui passiamo le variabili reali, niente codici
  // inventati.
  async function handleGenerateAndSendCode(candidate: ReviewCandidate) {
    if (!candidate.customer_phone && !candidate.customer_email) {
      toast.error('Nessun contatto disponibile per inviare il codice')
      return
    }
    if (!confirm(`Generare e inviare un codice sconto a ${candidate.customer_name || 'questo cliente'}?`)) return

    setGeneratingCodeId(candidate.id)
    const toastId = toast.loading('Generazione codici...')
    try {
      const genRes = await fetch(`${NETLIFY_BASE}/generate-review-codes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerEmail: candidate.customer_email || undefined,
          customerPhone: candidate.customer_phone || undefined,
          customerName: candidate.customer_name || undefined,
          source: 'review',
        }),
      })
      const gen = await genRes.json()
      if (!genRes.ok || !gen.success) {
        throw new Error(gen.error || 'Errore generazione codici')
      }

      // Send WhatsApp only if we have a phone — the codes are already
      // saved either way, so the admin can copy them from discount_codes
      // if no phone is on file.
      if (!candidate.customer_phone) {
        toast.dismiss(toastId)
        toast.success(`Codici creati (Supercar ${gen.rentalCode}, Lavaggio ${gen.carwashCode}) — nessun WhatsApp inviato (telefono mancante)`)
        return
      }

      const firstName = (candidate.customer_name || '').trim().split(/\s+/)[0] || ''
      // Forniamo TUTTE le varianti di nome variabile che l'admin potrebbe usare
      // nel template Pro (noleggio / supercar / rental). Il template è la
      // sorgente di verità: qualunque modifica al body fatta in Messaggi di
      // Sistema Pro viene applicata al prossimo invio senza toccare il codice.
      const templateVars: Record<string, string> = {
        nome: firstName,
        customer_name: candidate.customer_name || firstName,
        // Codice noleggio (Supercar) — alias per supportare diverse stesure del template
        codice_noleggio: gen.rental.code,
        codice_supercar: gen.rental.code,
        codice_rental: gen.rental.code,
        importo_noleggio: String(gen.rental.amount),
        importo_supercar: String(gen.rental.amount),
        spesa_min_noleggio: String(gen.rental.minimum_spend),
        spesa_min_supercar: String(gen.rental.minimum_spend),
        // Codice lavaggio
        codice_lavaggio: gen.carwash.code,
        codice_wash: gen.carwash.code,
        importo_lavaggio: String(gen.carwash.amount),
        spesa_min_lavaggio: String(gen.carwash.minimum_spend),
        // Validità (stessa per entrambi i codici)
        validita_giorni: String(gen.rental.valid_days),
      }

      const sendRes = await fetch(`${NETLIFY_BASE}/send-whatsapp-notification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateKey: 'pro_marketing_codice_sconto',
          templateVars,
          customPhone: candidate.customer_phone,
        }),
      })
      const sendData = await sendRes.json().catch(() => ({}))

      toast.dismiss(toastId)
      if (sendData.skipped) {
        toast.error(`Codici creati (${gen.rentalCode} / ${gen.carwashCode}) ma template Pro "pro_marketing_codice_sconto" non configurato in Messaggi di Sistema Pro.`, { duration: 8000 })
      } else if (!sendRes.ok) {
        toast.error(`Codici creati ma WhatsApp fallito: ${sendData.message || sendRes.statusText}`)
      } else {
        toast.success(`Codici inviati: ${gen.rentalCode} (Supercar) + ${gen.carwashCode} (Lavaggio)`)
      }
    } catch (err: unknown) {
      toast.dismiss(toastId)
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg || 'Errore durante la generazione del codice')
    } finally {
      setGeneratingCodeId(null)
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

  async function handleBulkEvaluate(forceReEvaluate = true) {
    if (!confirm('Valutare / ri-valutare tutte le prenotazioni e lavaggi degli ultimi 30 giorni?')) return
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
              forceReEvaluate,
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
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.dismiss(toastId)
      toast.error('Errore durante la valutazione: ' + (_errMsg || 'Errore'))
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
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error(_errMsg)
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
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error(_errMsg)
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
    if (type === 'RENTAL') return <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">Noleggio</span>
    if (type === 'WASH') return <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-cyan-50 text-cyan-700 border border-cyan-200">Lavaggio</span>
    return <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-50 text-gray-700 border border-gray-200">{type}</span>
  }

  // Combined status pill (dot + label) — derives a single visual state from
  // eligibility_status × send_status × review_risk. Mirrors the Rentora design.
  function renderStatusPill(c: ReviewCandidate) {
    let dot = 'bg-gray-400'
    let text = 'text-gray-700'
    let bg = 'bg-gray-50 border-gray-200'
    let label: string = c.send_status

    if (c.eligibility_status === 'EXCLUDED') {
      dot = 'bg-red-500'; text = 'text-red-700'; bg = 'bg-red-50 border-red-200'; label = 'Escluso'
    } else if (c.send_status === 'SENT') {
      dot = 'bg-green-500'; text = 'text-green-700'; bg = 'bg-green-50 border-green-200'; label = 'Inviato'
    } else if (c.send_status === 'FAILED') {
      dot = 'bg-red-500'; text = 'text-red-700'; bg = 'bg-red-50 border-red-200'; label = 'Fallito'
    } else if (c.eligibility_status === 'TO_REVIEW') {
      dot = 'bg-yellow-500'; text = 'text-yellow-800'; bg = 'bg-yellow-50 border-yellow-200'; label = 'Da Verificare'
    } else if (c.send_status === 'TO_SEND' && c.eligibility_status === 'ELIGIBLE') {
      dot = 'bg-green-500'; text = 'text-green-700'; bg = 'bg-green-50 border-green-200'; label = 'Pronto'
    } else if (c.send_status === 'BLOCKED') {
      dot = 'bg-red-500'; text = 'text-red-700'; bg = 'bg-red-50 border-red-200'; label = 'Bloccato'
    }

    return (
      <span className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium border ${bg} ${text}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        {label}
      </span>
    )
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

  // Pagination derived from filtered candidates
  const totalRows = filteredCandidates.length
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize))
  const safePage = Math.min(currentPage, totalPages)
  const pageStart = (safePage - 1) * pageSize
  const pageEnd = Math.min(pageStart + pageSize, totalRows)
  const pagedCandidates = filteredCandidates.slice(pageStart, pageEnd)

  return (
    <div className="p-3 sm:p-6 max-w-7xl mx-auto">
      {/* Header — title + action buttons (top-right) */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-semibold text-theme-text-primary tracking-tight">Gestione Recensioni</h2>
          <p className="text-sm text-theme-text-secondary mt-0.5">Invia richieste di recensione ai clienti idonei</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => handleBulkSend()}
            disabled={bulkSending}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white text-theme-text-primary text-sm font-semibold rounded-full border border-theme-border hover:bg-theme-bg-hover transition-colors disabled:opacity-50"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            {bulkSending ? 'Invio…' : 'Invia Email'}
          </button>
          <button
            onClick={() => handleBulkSend()}
            disabled={bulkSending}
            className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-full hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
            {bulkSending ? 'Invio…' : 'Invia WhatsApp'}
          </button>
          <button
            onClick={() => handleBulkEvaluate(true)}
            disabled={evaluating}
            className="p-2 bg-theme-bg-tertiary border border-theme-border rounded-full hover:bg-theme-bg-hover transition-colors disabled:opacity-50"
            title="Scansiona nuove prenotazioni"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-theme-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button
            onClick={() => { setShowTemplates(!showTemplates); setShowSettings(false) }}
            className="p-2 bg-theme-bg-tertiary border border-theme-border rounded-full hover:bg-theme-bg-hover transition-colors"
            title="Template"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-theme-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </button>
          <button
            onClick={() => { setShowSettings(!showSettings); setShowTemplates(false) }}
            className="p-2 bg-theme-bg-tertiary border border-theme-border rounded-full hover:bg-theme-bg-hover transition-colors"
            title="Impostazioni"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-theme-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Top filter bar — Tipo Servizio / Stato Recensione / Search / Page size */}
      <div className="bg-theme-bg-secondary border border-theme-border rounded-2xl p-3 mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-theme-text-secondary uppercase tracking-wide">Tipo Servizio</span>
          <select
            value={filterServiceType}
            onChange={e => { setFilterServiceType(e.target.value as typeof filterServiceType); setCurrentPage(1) }}
            className="px-3 py-1.5 bg-theme-bg-primary border border-theme-border rounded-lg text-sm text-theme-text-primary focus:outline-none focus:border-dr7-gold"
          >
            <option value="ALL">Lavaggio &amp; Noleggio</option>
            <option value="RENTAL">Solo Noleggio</option>
            <option value="WASH">Solo Lavaggio</option>
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Cerca per nome, email, telefono…"
            value={searchTerm}
            onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1) }}
            className="w-full px-3 py-1.5 bg-theme-bg-primary border border-theme-border rounded-lg text-sm text-theme-text-primary placeholder-theme-text-secondary focus:outline-none focus:border-dr7-gold"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-theme-text-secondary uppercase tracking-wide">Mostra</span>
          <select
            value={pageSize}
            onChange={e => { setPageSize(parseInt(e.target.value)); setCurrentPage(1) }}
            className="px-3 py-1.5 bg-theme-bg-primary border border-theme-border rounded-lg text-sm text-theme-text-primary focus:outline-none focus:border-dr7-gold"
          >
            <option value="10">10</option>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
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
                onChange={e => setSettingsDraft({ ...settingsDraft, auto_channel_rental: e.target.value as typeof settingsDraft.auto_channel_rental })}
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
                onChange={e => setSettingsDraft({ ...settingsDraft, auto_channel_wash: e.target.value as typeof settingsDraft.auto_channel_wash })}
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

      {/* Status pill tabs (with colored dots + counts) */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {([
          { key: 'ELIGIBLE' as TabKey, label: 'Pronti', count: stats.eligible, dot: 'bg-green-500' },
          { key: 'TO_REVIEW' as TabKey, label: 'Da Verificare', count: stats.to_review, dot: 'bg-yellow-500' },
          { key: 'EXCLUDED' as TabKey, label: 'Esclusi', count: stats.excluded, dot: 'bg-red-500' },
        ]).map(tab => {
          const isActive = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setSelectedIds(new Set()); setSelectAll(false); setCurrentPage(1) }}
              className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                isActive
                  ? 'bg-theme-bg-primary text-theme-text-primary border-theme-text-primary shadow-sm'
                  : 'bg-theme-bg-tertiary text-theme-text-secondary border-theme-border hover:bg-theme-bg-hover'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${tab.dot}`} />
              {tab.label}
              <span className={`text-xs ${isActive ? 'text-theme-text-secondary' : 'text-theme-text-secondary/70'}`}>
                {tab.count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Alert banner for TO_REVIEW / EXCLUDED tabs */}
      {activeTab === 'TO_REVIEW' && (
        <div className="bg-yellow-50 border border-yellow-300 rounded-xl px-4 py-3 mb-4 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-yellow-600 shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <span className="text-sm text-yellow-800">Questi clienti richiedono verifica manuale prima dell'invio della richiesta di recensione.</span>
        </div>
      )}
      {activeTab === 'EXCLUDED' && (
        <div className="bg-yellow-50 border border-yellow-300 rounded-xl px-4 py-3 mb-4 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-yellow-600 shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <span className="text-sm text-yellow-800">
            <strong>Attenzione:</strong> Non inviare recensioni a clienti potenzialmente problematici.
          </span>
        </div>
      )}

      {/* Eligible-only quick action bar */}
      {activeTab === 'ELIGIBLE' && filteredCandidates.length > 0 && (
        <div className="flex items-center gap-3 mb-3">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={selectAll}
              onChange={toggleSelectAll}
              className="w-4 h-4 rounded accent-dr7-gold"
            />
            <span className="text-sm text-theme-text-secondary">Seleziona tutti su questa pagina</span>
          </label>
          {selectedIds.size > 0 && (
            <span className="text-sm text-theme-text-secondary">{selectedIds.size} selezionati</span>
          )}
        </div>
      )}

      {/* Table */}
      <div className="bg-theme-bg-primary border border-theme-border rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-theme-bg-tertiary/50 border-b border-theme-border text-xs uppercase tracking-wide text-theme-text-secondary">
                {activeTab === 'ELIGIBLE' && <th className="px-4 py-3 text-left w-10"></th>}
                <th className="px-4 py-3 text-left font-medium">Stato</th>
                <th className="px-4 py-3 text-left font-medium">Cliente</th>
                <th className="px-4 py-3 text-left font-medium">Oggetto</th>
                <th className="px-4 py-3 text-left font-medium">Email</th>
                <th className="px-4 py-3 text-left font-medium">WhatsApp</th>
                {activeTab === 'EXCLUDED' && <th className="px-4 py-3 text-left font-medium">Motivo</th>}
                <th className="px-4 py-3 text-right font-medium">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {pagedCandidates.length === 0 ? (
                <tr>
                  <td colSpan={activeTab === 'EXCLUDED' ? 7 : activeTab === 'ELIGIBLE' ? 7 : 6} className="px-4 py-16 text-center text-theme-text-secondary">
                    Nessun candidato trovato
                  </td>
                </tr>
              ) : (
                pagedCandidates.map(candidate => {
                  const shortId = (candidate.source_record_id || candidate.id || '').slice(0, 8).toUpperCase()
                  return (
                    <tr key={candidate.id} className="border-b border-theme-border last:border-0 hover:bg-theme-bg-hover/50 transition-colors">
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

                      {/* Stato — colored dot pill */}
                      <td className="px-4 py-3">{renderStatusPill(candidate)}</td>

                      {/* Cliente — name + #ID */}
                      <td className="px-4 py-3">
                        <div className="font-medium text-theme-text-primary">{candidate.customer_name || 'N/A'}</div>
                        <div className="text-xs text-theme-text-secondary">#{shortId}</div>
                      </td>

                      {/* Oggetto — service-type pill */}
                      <td className="px-4 py-3">{getServiceBadge(candidate.service_type)}</td>

                      {/* Email */}
                      <td className="px-4 py-3 text-theme-text-secondary">
                        {candidate.customer_email ? (
                          <span className="inline-flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-theme-text-secondary/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                            <span className="truncate max-w-[200px]" title={candidate.customer_email}>{candidate.customer_email}</span>
                          </span>
                        ) : (
                          <span className="text-theme-text-secondary/60">—</span>
                        )}
                      </td>

                      {/* WhatsApp */}
                      <td className="px-4 py-3 text-theme-text-secondary">
                        {candidate.customer_phone ? (
                          <span className="inline-flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                            </svg>
                            <span>{candidate.customer_phone}</span>
                          </span>
                        ) : (
                          <span className="text-theme-text-secondary/60">—</span>
                        )}
                      </td>

                      {activeTab === 'EXCLUDED' && (
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700 border border-red-200">
                            {candidate.exclusion_reason_text || candidate.exclusion_reason_code || 'Motivo non specificato'}
                          </span>
                        </td>
                      )}

                      {/* Azioni */}
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5 justify-end items-center">
                          {activeTab === 'ELIGIBLE' && (
                            <>
                              {candidate.customer_email && (
                                <button
                                  onClick={() => handleSend(candidate.id, 'EMAIL')}
                                  disabled={sendingId === candidate.id}
                                  title="Invia Email"
                                  className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-theme-border bg-theme-bg-primary text-theme-text-secondary hover:bg-theme-bg-hover transition-colors disabled:opacity-50"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                  </svg>
                                </button>
                              )}
                              {candidate.customer_phone && (
                                <button
                                  onClick={() => handleSend(candidate.id, 'WHATSAPP')}
                                  disabled={sendingId === candidate.id}
                                  className="inline-flex items-center gap-1.5 px-3 h-8 rounded-full bg-green-600 text-white text-xs font-semibold hover:bg-green-700 transition-colors disabled:opacity-50"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                                  </svg>
                                  Invia
                                </button>
                              )}
                              {(candidate.customer_email || candidate.customer_phone) && (
                                <button
                                  onClick={() => handleGenerateAndSendCode(candidate)}
                                  disabled={generatingCodeId === candidate.id}
                                  title="Genera codice sconto reale (Supercar €100 + Lavaggio €10) e invialo via WhatsApp"
                                  className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-theme-border bg-dr7-gold text-white hover:opacity-90 transition-colors disabled:opacity-50"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 8a3 3 0 116 0 3 3 0 01-6 0zM12 16a3 3 0 116 0 3 3 0 01-6 0zM4 20l16-16" />
                                  </svg>
                                </button>
                              )}
                              {candidate.send_status === 'SENT' && (
                                <button
                                  onClick={() => handleSblocca(candidate.id)}
                                  disabled={sendingId === candidate.id}
                                  className="inline-flex items-center px-3 h-8 rounded-full border border-amber-400 text-amber-700 text-xs font-semibold hover:bg-amber-50 transition-colors disabled:opacity-50"
                                >
                                  Sblocca
                                </button>
                              )}
                            </>
                          )}

                          {activeTab === 'TO_REVIEW' && (
                            <>
                              <button
                                onClick={() => handleApproveAndSend(candidate.id)}
                                disabled={sendingId === candidate.id}
                                className="inline-flex items-center px-3 h-8 rounded-full bg-green-600 text-white text-xs font-semibold hover:bg-green-700 transition-colors disabled:opacity-50"
                              >
                                Approva e Invia
                              </button>
                              <button
                                onClick={() => handleExclude(candidate.id)}
                                disabled={sendingId === candidate.id}
                                className="inline-flex items-center px-3 h-8 rounded-full border border-red-300 text-red-700 text-xs font-semibold hover:bg-red-50 transition-colors disabled:opacity-50"
                              >
                                Escludi
                              </button>
                            </>
                          )}

                          {activeTab === 'EXCLUDED' && (
                            <button
                              onClick={() => handleSblocca(candidate.id)}
                              disabled={sendingId === candidate.id}
                              className="inline-flex items-center px-3 h-8 rounded-full border border-amber-400 text-amber-700 text-xs font-semibold hover:bg-amber-50 transition-colors disabled:opacity-50"
                            >
                              Sblocca
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 mt-4 px-1 text-sm text-theme-text-secondary">
        <span>
          {totalRows === 0 ? 'Nessun risultato' : <>Mostra <strong className="text-theme-text-primary">{pageStart + 1}</strong>–<strong className="text-theme-text-primary">{pageEnd}</strong> di <strong className="text-theme-text-primary">{totalRows}</strong></>}
        </span>
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(Math.max(1, safePage - 1))}
              disabled={safePage <= 1}
              className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Pagina precedente"
            >
              ‹
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
              .map((p, i, arr) => (
                <span key={p} className="inline-flex items-center">
                  {i > 0 && p - arr[i - 1] > 1 && <span className="px-2 text-theme-text-secondary/60">…</span>}
                  <button
                    onClick={() => setCurrentPage(p)}
                    className={`w-8 h-8 inline-flex items-center justify-center rounded-lg border text-sm transition-colors ${
                      p === safePage
                        ? 'border-theme-text-primary bg-theme-text-primary text-theme-bg-primary font-semibold'
                        : 'border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover'
                    }`}
                  >
                    {p}
                  </button>
                </span>
              ))}
            <button
              onClick={() => setCurrentPage(Math.min(totalPages, safePage + 1))}
              disabled={safePage >= totalPages}
              className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Pagina successiva"
            >
              ›
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
