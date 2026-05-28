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
  // setStats kept for the existing fetchStats path (server-side counts) but
  // the cards now render from liveStats — counts derived from the visible
  // candidate list — so they match what's actually shown.
  const [, setStats] = useState<DashboardStats>({ eligible: 0, to_review: 0, excluded: 0, to_send: 0, sent: 0, failed: 0 })
  const [, setSettings] = useState<ReviewSettings>(DEFAULT_SETTINGS)
  const [, setTemplates] = useState<ReviewTemplate[]>([])

  // UI state
  const [loading, setLoading] = useState(true)
  const [filterServiceType, setFilterServiceType] = useState<'ALL' | 'RENTAL' | 'WASH'>('ALL')
  // categoryFilter is driven by the stat cards (Idonei / Da Verificare / Da
  // Inviare / Inviate / Fallite / Esclusi). 'ALL' means show everything.
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | 'ELIGIBLE' | 'TO_REVIEW' | 'TO_SEND' | 'SENT' | 'FAILED' | 'EXCLUDED'>('ALL')
  // motivoFilter applies to the Esclusi section only — narrows the rows by
  // exclusion reason (penali / danni / cauzione aperta / altri).
  const [motivoFilter, setMotivoFilter] = useState<'ALL' | 'PENALE' | 'DANNO' | 'OPEN_DEPOSIT' | 'ALTRI'>('ALL')
  const [searchTerm, setSearchTerm] = useState('')
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
  }, [filterServiceType])

  async function loadAll() {
    setLoading(true)
    await Promise.all([fetchSettings(), fetchTemplates(), fetchCandidates(), fetchStats()])
    setLoading(false)
    // Background: re-evaluate new bookings, then sweep ELIGIBLE candidates and
    // demote anyone with penali/danni/cauzione aperta to Esclusi. Both run
    // silently — the user shouldn't have to click anything.
    ;(async () => {
      await autoEvaluateAll()
      await autoFixEligibility()
      await Promise.all([fetchCandidates(), fetchStats()])
    })()
  }

  // Silent sweep: scan ELIGIBLE candidates and demote those with penali / danni /
  // fattura penale o danno / cauzione ancora aperta to TO_REVIEW so they appear
  // in the Esclusi section with a clear motivo. Runs on every page load.
  async function autoFixEligibility() {
    try {
      const { data: eligible } = await supabase
        .from('review_candidates')
        .select('id, source_record_id, service_type')
        .eq('eligibility_status', 'ELIGIBLE')

      if (!eligible || eligible.length === 0) return

      for (const candidate of eligible) {
        const { data: booking } = await supabase
          .from('bookings')
          .select('booking_details')
          .eq('id', candidate.source_record_id)
          .single()

        const details = booking?.booking_details || {}
        const hasPenalty = Array.isArray(details.penalties) && details.penalties.length > 0
        const hasDamage = Array.isArray(details.danni) && details.danni.length > 0

        const { data: penaltyInvoices } = await supabase
          .from('fatture')
          .select('id')
          .eq('booking_id', candidate.source_record_id)
          .in('tipo_fattura', ['penale', 'danno'])
          .limit(1)
        const hasInvoice = !!(penaltyInvoices && penaltyInvoices.length > 0)

        let hasOpenDeposit = false
        if (candidate.service_type === 'RENTAL') {
          const { data: openCauzioni } = await supabase
            .from('cauzioni')
            .select('id, stato')
            .eq('riferimento_contratto_id', candidate.source_record_id)
          hasOpenDeposit = (openCauzioni || []).some((c: { stato?: string }) => c.stato !== 'Restituita' && c.stato !== 'Sbloccata')
        }

        if (hasPenalty || hasDamage || hasInvoice || hasOpenDeposit) {
          const reason = hasPenalty ? 'Presenza di penale registrata'
            : hasDamage ? 'Danno registrato sul veicolo'
            : hasInvoice ? 'Fattura penale/danno presente'
            : 'Cauzione ancora aperta o in attesa'
          const code = hasPenalty ? 'HAS_PENALTY'
            : hasDamage ? 'HAS_DAMAGE'
            : hasInvoice ? 'HAS_PENALTY'
            : 'OPEN_DEPOSIT'

          await supabase
            .from('review_candidates')
            .update({
              eligibility_status: 'TO_REVIEW',
              review_risk: 'RED',
              send_status: 'BLOCKED',
              exclusion_reason_code: code,
              exclusion_reason_text: reason,
              updated_at: new Date().toISOString(),
            })
            .eq('id', candidate.id)
        }
      }
    } catch (err) {
      console.error('autoFixEligibility error:', err)
    }
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
      // Fetch all three eligibility buckets in parallel — the page renders them
      // as separate stacked sections (Pronti / Esclusi), so we need them all
      // at once.
      const buckets: TabKey[] = ['ELIGIBLE', 'TO_REVIEW', 'EXCLUDED']
      const results = await Promise.all(buckets.map(b =>
        fetch(`${NETLIFY_BASE}/review-candidates?${new URLSearchParams({ eligibility_status: b, service_type: filterServiceType })}`)
          .then(r => r.ok ? r.json() : { candidates: [] })
          .catch(() => ({ candidates: [] }))
      ))
      const merged = results.flatMap(d => d.candidates || d || [])
      // Dedupe by id — a row can briefly appear in two buckets while the
      // background autoFixEligibility sweep is moving it ELIGIBLE→TO_REVIEW,
      // and we don't want the same person rendered twice. Keep the most
      // recently updated copy when there's a conflict.
      const byId = new Map<string, ReviewCandidate>()
      for (const c of merged) {
        const existing = byId.get(c.id)
        if (!existing || (c.updated_at || '') > (existing.updated_at || '')) {
          byId.set(c.id, c)
        }
      }
      setCandidates(Array.from(byId.values()))
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

  async function handleSend(candidateId: string, _channel?: 'EMAIL' | 'WHATSAPP' | 'BOTH') {
    // 2026-05-28: review flow e' WhatsApp-only. Il parametro `_channel`
    // resta per compatibilita' coi caller esistenti ma viene ignorato:
    // ogni invio recensione passa SEMPRE via Green API (WHATSAPP_ONLY).
    void _channel
    setSendingId(candidateId)
    try {
      const res = await fetch(`${NETLIFY_BASE}/review-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId, sendChannel: 'WHATSAPP_ONLY', sendMode: 'MANUAL' }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Errore invio')
      }
      // 2026-05-28: review-send torna SEMPRE HTTP 200 anche quando email
      // o WhatsApp falliscono (es. Green API non configurato, SMTP timeout).
      // Senza questo controllo, il toast diceva "inviata" ma il candidate
      // veniva marcato send_status=FAILED dal backend → pill rossa "Fallito".
      const data = await res.json().catch(() => ({}))
      if (!data || data.success === false) {
        const errs = Array.isArray(data?.errors) && data.errors.length > 0
          ? data.errors.join(' · ')
          : 'Invio fallito (nessun canale ha avuto successo)'
        toast.error(`Invio fallito: ${errs}`, { duration: 10000 })
        await Promise.all([fetchCandidates(), fetchStats()])
        return
      }
      // Parziale: almeno un canale ok ma altri falliti → mostra warning
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        toast(`Inviato in parte: ${data.errors.join(' · ')}`, { duration: 8000 })
      } else {
        toast.success('Richiesta recensione inviata!')
      }
      await Promise.all([fetchCandidates(), fetchStats()])
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error(_errMsg || 'Errore durante l\'invio')
    } finally {
      setSendingId(null)
    }
  }

  async function handleApproveAndSend(candidateId: string) {
    if (!confirm('Approvare questo cliente? Diventera\' idoneo a ricevere la richiesta recensione via WhatsApp (clicca poi il bottone "Invia").')) return
    setSendingId(candidateId)
    try {
      // Approva soltanto — niente piu' invio automatico. La direzione
      // controlla i dati, clicca poi Email o WhatsApp quando vuole.
      const { error: upErr } = await supabase
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
      if (upErr) throw new Error(`Errore approvazione: ${upErr.message}`)

      toast.success('Approvato — pronto per l\'invio')
      await Promise.all([fetchCandidates(), fetchStats()])
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error(_errMsg)
    } finally {
      setSendingId(null)
    }
  }

  // Marca manualmente come "gia\' recensito" — il cliente ha confermato a
  // voce / via WhatsApp che ha gia\' lasciato la recensione su Google.
  // Setta send_status='SENT' cosi\' esce da "Da Inviare" e finisce nella
  // colonna "Inviate" senza bisogno di triggerare l'invio automatico.
  async function handleMarcaGiaRecensito(candidateId: string) {
    if (!confirm('Marcare questo cliente come gia\' recensito?\nNon riceverà più la richiesta automatica.')) return
    setSendingId(candidateId)
    try {
      const { error } = await supabase
        .from('review_candidates')
        .update({
          send_status: 'SENT',
          eligibility_status: 'ELIGIBLE',
          exclusion_reason_code: 'ALREADY_REVIEWED',
          exclusion_reason_text: 'Marcato manualmente: cliente ha gia\' lasciato la recensione',
          updated_at: new Date().toISOString(),
        })
        .eq('id', candidateId)
      if (error) throw error
      toast.success('Segnato come gia\' recensito')
      await Promise.all([fetchCandidates(), fetchStats()])
    } catch (err: unknown) {
      toast.error('Errore: ' + (err instanceof Error ? err.message : String(err)))
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
          // BUG FIX 2026-05-13: era 'pro_marketing_codice_sconto' hardcoded.
          // Adesso legacy key + service_type='all' (marketing cross-servizio).
          templateKey: 'review_discount_code',
          booking: { service_type: 'all' },
          templateVars,
          customPhone: candidate.customer_phone,
        }),
      })
      const sendData = await sendRes.json().catch(() => ({}))

      toast.dismiss(toastId)
      if (sendData.skipped) {
        toast.error(`Codici creati (${gen.rentalCode} / ${gen.carwashCode}) ma template per "review_discount_code" non configurato in Messaggi di Sistema Pro.`, { duration: 8000 })
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
        // 2026-05-28: WhatsApp-only. Saltare i candidati senza telefono —
        // niente fallback email.
        if (!candidate.customer_phone) {
          failed++
          toast.loading(`Invio in corso: ${success + failed}/${eligibleToSend.length}`, { id: toastId })
          continue
        }
        const res = await fetch(`${NETLIFY_BASE}/review-send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ candidateId: candidate.id, sendChannel: 'WHATSAPP_ONLY', sendMode: 'AUTOMATIC' }),
        })
        if (res.ok) {
          const data = await res.json().catch(() => ({}))
          if (data && data.success !== false) success++
          else failed++
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
      // Hide Lavaggio Rientro / internal car wash records — they're automatic
      // entries created by the booking trigger, not real customer services.
      // Same rule as Prime Wash calendar / bookings list.
      const name = (c.customer_name || '').toLowerCase()
      if (name.includes('lavaggio rientro') || name.includes('rientro') || name.includes('interno')) return false

      // Stat-card category filter
      if (categoryFilter === 'ELIGIBLE' && !(c.eligibility_status === 'ELIGIBLE' && c.send_status === 'TO_SEND')) return false
      if (categoryFilter === 'TO_REVIEW' && c.eligibility_status !== 'TO_REVIEW') return false
      if (categoryFilter === 'TO_SEND' && c.send_status !== 'TO_SEND') return false
      if (categoryFilter === 'SENT' && c.send_status !== 'SENT') return false
      if (categoryFilter === 'FAILED' && c.send_status !== 'FAILED') return false
      if (categoryFilter === 'EXCLUDED' && c.eligibility_status !== 'EXCLUDED') return false

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
  }, [candidates, searchTerm, categoryFilter])

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
      dot = 'bg-blue-500'; text = 'text-blue-700'; bg = 'bg-blue-50 border-blue-200'; label = 'Pronto'
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

  // ── Render-derived data (must be computed BEFORE any early return so
  //     the React hooks order stays stable across renders) ───────────────────

  // Stats derived from the same candidate list shown below, so the numbers
  // on the cards always match what the operator can actually see.
  const visibleCandidates = useMemo(() => {
    return candidates.filter(c => {
      const name = (c.customer_name || '').toLowerCase()
      if (name.includes('lavaggio rientro') || name.includes('rientro') || name.includes('interno')) return false
      return true
    })
  }, [candidates])
  const liveStats = useMemo(() => ({
    eligible: visibleCandidates.filter(c => c.eligibility_status === 'ELIGIBLE' && c.send_status === 'TO_SEND').length,
    to_review: visibleCandidates.filter(c => c.eligibility_status === 'TO_REVIEW').length,
    to_send: visibleCandidates.filter(c => c.send_status === 'TO_SEND').length,
    sent: visibleCandidates.filter(c => c.send_status === 'SENT').length,
    failed: visibleCandidates.filter(c => c.send_status === 'FAILED').length,
    excluded: visibleCandidates.filter(c => c.eligibility_status === 'EXCLUDED').length,
  }), [visibleCandidates])

  // ── Loading state ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-xl text-theme-text-primary">Caricamento...</div>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  // Pronti and Esclusi sections share the user's category + search filters,
  // and Esclusi additionally respects motivoFilter (Penali / Danni / Cauzione
  // aperta / Altri). No pagination — each section shows every matching row.
  const pronti = filteredCandidates.filter(c => c.eligibility_status === 'ELIGIBLE')
  const esclusiBase = filteredCandidates.filter(c => c.eligibility_status === 'TO_REVIEW' || c.eligibility_status === 'EXCLUDED')
  const esclusi = esclusiBase.filter(c => {
    if (motivoFilter === 'ALL') return true
    const code = c.exclusion_reason_code || ''
    if (motivoFilter === 'PENALE') return code === 'HAS_PENALTY'
    if (motivoFilter === 'DANNO') return code === 'HAS_DAMAGE'
    if (motivoFilter === 'OPEN_DEPOSIT') return code === 'OPEN_DEPOSIT'
    if (motivoFilter === 'ALTRI') return code !== 'HAS_PENALTY' && code !== 'HAS_DAMAGE' && code !== 'OPEN_DEPOSIT'
    return true
  })
  // Counts for the motivo sub-filter pills (computed off the unfiltered
  // Esclusi base so each pill always shows its true count).
  const motivoCounts = {
    all: esclusiBase.length,
    penali: esclusiBase.filter(c => c.exclusion_reason_code === 'HAS_PENALTY').length,
    danni: esclusiBase.filter(c => c.exclusion_reason_code === 'HAS_DAMAGE').length,
    cauzione: esclusiBase.filter(c => c.exclusion_reason_code === 'OPEN_DEPOSIT').length,
    altri: esclusiBase.filter(c => {
      const code = c.exclusion_reason_code || ''
      return code !== 'HAS_PENALTY' && code !== 'HAS_DAMAGE' && code !== 'OPEN_DEPOSIT'
    }).length,
  }

  // 2026-05-22 redesign: derived metrics for KPI strip + sidebar — all
  // computed from existing candidates state, no new queries.
  const totalCandidates = visibleCandidates.length
  const responseRate = totalCandidates > 0
    ? Math.round((liveStats.sent / totalCandidates) * 1000) / 10
    : 0
  // Suggerimenti intelligenti — derivati dai dati reali (no AI mock).
  const aiSuggestions: { color: 'emerald' | 'amber' | 'red'; text: string }[] = []
  if (liveStats.to_send > 0) {
    aiSuggestions.push({ color: 'emerald', text: `${liveStats.to_send} client${liveStats.to_send === 1 ? 'e' : 'i'} pront${liveStats.to_send === 1 ? 'o' : 'i'} per ricevere la richiesta` })
  }
  if (liveStats.to_review > 0) {
    aiSuggestions.push({ color: 'amber', text: `${liveStats.to_review} caso${liveStats.to_review === 1 ? '' : 'i'} da verificare manualmente prima dell'invio` })
  }
  if (liveStats.failed > 0) {
    aiSuggestions.push({ color: 'red', text: `${liveStats.failed} invio${liveStats.failed === 1 ? '' : 'i'} fallit${liveStats.failed === 1 ? 'o' : 'i'} — riprova` })
  }
  if (aiSuggestions.length === 0) {
    aiSuggestions.push({ color: 'emerald', text: 'Tutto a posto — nessuna azione richiesta al momento' })
  }
  // Orario migliore: distribuzione invii per fascia oraria (Europe/Rome).
  const bestSendWindow = (() => {
    const byHour: Record<number, number> = {}
    for (const c of visibleCandidates) {
      if (c.send_status !== 'SENT') continue
      const h = new Date(c.updated_at).getHours()
      byHour[h] = (byHour[h] || 0) + 1
    }
    const entries = Object.entries(byHour).map(([h, n]) => ({ h: Number(h), n }))
    if (entries.length === 0) return { label: '18:00 - 20:00', rate: 0 }
    entries.sort((a, b) => b.n - a.n)
    const top = entries[0]
    return { label: `${String(top.h).padStart(2, '0')}:00 - ${String((top.h + 1) % 24).padStart(2, '0')}:00`, rate: totalCandidates > 0 ? Math.round((top.n / totalCandidates) * 1000) / 10 : 0 }
  })()

  return (
    <div className="p-3 sm:p-6">
      {/* Header — title + action buttons (top-right) */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-semibold text-theme-text-primary tracking-tight">Recensioni Marketing</h2>
          <p className="text-sm text-theme-text-secondary mt-0.5">Sistema automatico di richiesta di recensione ai clienti</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* 2026-05-28: rimosso bottone "Invia Email" — review flow WhatsApp-only */}
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

      {/* Stats overview — clickable cards, each filters the list below.
          Click the same card again to clear the filter (back to ALL).
          2026-05-22: aggiunto "Tasso di Risposta" come 7th card. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 mb-4">
        {/* Tasso di Risposta — non-clickable info card */}
        <div className="text-left bg-theme-bg-secondary border border-theme-border rounded-xl px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="text-xs text-theme-text-secondary">Tasso di Risposta</span>
          </div>
          <div className="mt-1 text-2xl font-semibold text-theme-text-primary">{responseRate}%</div>
          <div className="text-[10px] text-theme-text-secondary/70 mt-0.5">{liveStats.sent} / {totalCandidates || 0}</div>
        </div>
        {([
          { key: 'ELIGIBLE', label: 'Idonei', value: liveStats.eligible, dot: 'bg-blue-500' },
          { key: 'TO_REVIEW', label: 'Da Verificare', value: liveStats.to_review, dot: 'bg-yellow-500' },
          { key: 'TO_SEND', label: 'Da Inviare', value: liveStats.to_send, dot: 'bg-blue-500' },
          { key: 'SENT', label: 'Inviate', value: liveStats.sent, dot: 'bg-emerald-500' },
          { key: 'FAILED', label: 'Fallite', value: liveStats.failed, dot: 'bg-red-500' },
          { key: 'EXCLUDED', label: 'Esclusi', value: liveStats.excluded, dot: 'bg-gray-400' },
        ] as const).map(s => {
          const active = categoryFilter === s.key
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setCategoryFilter(active ? 'ALL' : s.key)}
              className={`text-left bg-theme-bg-secondary border rounded-xl px-4 py-3 transition-colors hover:bg-theme-bg-hover ${
                active ? 'border-theme-text-primary ring-1 ring-theme-text-primary/30' : 'border-theme-border'
              }`}
              title={active ? 'Clicca di nuovo per rimuovere il filtro' : `Filtra: ${s.label}`}
            >
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                <span className="text-xs text-theme-text-secondary">{s.label}</span>
              </div>
              <div className="mt-1 text-2xl font-semibold text-theme-text-primary">{s.value}</div>
            </button>
          )
        })}
      </div>

      {/* 2026-05-22 redesign: 2-column layout (main + sidebar on lg+).
          Sidebar shows Suggerimenti AI, Automazioni Attive, Statistiche
          Piattaforma, Orario migliore — tutti dati reali, no mock. */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4">
      <div className="min-w-0">

      {/* Top filter bar — Tipo Servizio / Stato Recensione / Search / Page size */}
      <div className="bg-theme-bg-secondary border border-theme-border rounded-2xl p-3 mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-theme-text-secondary uppercase tracking-wide">Tipo Servizio</span>
          <select
            value={filterServiceType}
            onChange={e => setFilterServiceType(e.target.value as typeof filterServiceType)}
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
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full px-3 py-1.5 bg-theme-bg-primary border border-theme-border rounded-lg text-sm text-theme-text-primary placeholder-theme-text-secondary focus:outline-none focus:border-dr7-gold"
          />
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

            {/* Canale auto noleggio — 2026-05-28: WhatsApp-only (Email/Both rimossi) */}
            <div>
              <label className="block text-sm text-theme-text-secondary mb-1">Canale auto noleggio</label>
              <select
                value={settingsDraft.auto_channel_rental === 'WHATSAPP' || settingsDraft.auto_channel_rental === 'DISABLED' ? settingsDraft.auto_channel_rental : 'WHATSAPP'}
                onChange={e => setSettingsDraft({ ...settingsDraft, auto_channel_rental: e.target.value as typeof settingsDraft.auto_channel_rental })}
                className="w-full px-3 py-2 bg-theme-bg-primary border border-theme-border rounded-xl text-sm text-theme-text-primary"
              >
                <option value="DISABLED">Disattivato</option>
                <option value="WHATSAPP">WhatsApp</option>
              </select>
            </div>

            {/* Canale auto lavaggio — 2026-05-28: WhatsApp-only */}
            <div>
              <label className="block text-sm text-theme-text-secondary mb-1">Canale auto lavaggio</label>
              <select
                value={settingsDraft.auto_channel_wash === 'WHATSAPP' || settingsDraft.auto_channel_wash === 'DISABLED' ? settingsDraft.auto_channel_wash : 'WHATSAPP'}
                onChange={e => setSettingsDraft({ ...settingsDraft, auto_channel_wash: e.target.value as typeof settingsDraft.auto_channel_wash })}
                className="w-full px-3 py-2 bg-theme-bg-primary border border-theme-border rounded-xl text-sm text-theme-text-primary"
              >
                <option value="DISABLED">Disattivato</option>
                <option value="WHATSAPP">WhatsApp</option>
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
              className="px-6 py-2 bg-dr7-gold text-white font-semibold rounded-full hover:bg-[#0A8FA3] transition-colors disabled:opacity-50"
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
            {/* 2026-05-28: filtra solo i template WhatsApp — review flow WhatsApp-only */}
            {TEMPLATE_KEYS.filter(k => k.includes('WHATSAPP')).map(key => {
              const t = templatesDraft.find(t => t.template_key === key) || {
                id: key,
                template_key: key,
                subject: null,
                body: '',
              }
              const isEmail = false
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
                      className="px-4 py-1.5 bg-dr7-gold text-white text-sm font-semibold rounded-full hover:bg-[#0A8FA3] transition-colors disabled:opacity-50"
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

      {/* ── Section: Pronti (eligible candidates) ─────────────────────────── */}
      {(() => {

        const renderActionsCell = (candidate: ReviewCandidate) => {
          const isEligible = candidate.eligibility_status === 'ELIGIBLE'
          const isToReview = candidate.eligibility_status === 'TO_REVIEW'
          const isExcluded = candidate.eligibility_status === 'EXCLUDED'
          return (
            <div className="flex gap-1.5 justify-end items-center flex-wrap">
              {isEligible && (
                <>
                  {/* 2026-05-28: rimosso bottone Email per-riga — WhatsApp-only */}
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
                      title="Genera codice sconto reale (Supercar EUR 100 + Lavaggio EUR 10) e invialo via WhatsApp"
                      className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-theme-border bg-dr7-gold text-white hover:opacity-90 transition-colors disabled:opacity-50"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 8a3 3 0 116 0 3 3 0 01-6 0zM12 16a3 3 0 116 0 3 3 0 01-6 0zM4 20l16-16" />
                      </svg>
                    </button>
                  )}
                  {candidate.send_status !== 'SENT' && (
                    <button
                      onClick={() => handleMarcaGiaRecensito(candidate.id)}
                      disabled={sendingId === candidate.id}
                      title="Il cliente ha gia\' lasciato la recensione su Google — non inviare richiesta"
                      className="inline-flex items-center gap-1.5 px-3 h-8 rounded-full border border-emerald-500/60 bg-emerald-50 text-emerald-700 text-xs font-semibold hover:bg-emerald-100 transition-colors disabled:opacity-50"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M12 21a9 9 0 100-18 9 9 0 000 18z" />
                      </svg>
                      Già recensito
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
              {isToReview && (
                <>
                  <button
                    onClick={() => handleApproveAndSend(candidate.id)}
                    disabled={sendingId === candidate.id}
                    className="inline-flex items-center px-3 h-8 rounded-full bg-green-600 text-white text-xs font-semibold hover:bg-green-700 transition-colors disabled:opacity-50"
                  >
                    Approva
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
              {isExcluded && (
                <button
                  onClick={() => handleSblocca(candidate.id)}
                  disabled={sendingId === candidate.id}
                  className="inline-flex items-center px-3 h-8 rounded-full border border-amber-400 text-amber-700 text-xs font-semibold hover:bg-amber-50 transition-colors disabled:opacity-50"
                >
                  Sblocca
                </button>
              )}
            </div>
          )
        }

        const renderRow = (candidate: ReviewCandidate, withCheckbox: boolean, withMotivo: boolean) => {
          const shortId = (candidate.source_record_id || candidate.id || '').slice(0, 8).toUpperCase()
          return (
            <tr key={candidate.id} className="border-b border-theme-border last:border-0 hover:bg-theme-bg-hover/50 transition-colors">
              {withCheckbox && (
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(candidate.id)}
                    onChange={() => toggleSelect(candidate.id)}
                    className="w-4 h-4 rounded accent-dr7-gold"
                  />
                </td>
              )}
              <td className="px-4 py-3">{renderStatusPill(candidate)}</td>
              <td className="px-4 py-3">
                <div className="font-medium text-theme-text-primary">{candidate.customer_name || 'N/A'}</div>
                <div className="text-xs text-theme-text-secondary">#{shortId}</div>
              </td>
              <td className="px-4 py-3">{getServiceBadge(candidate.service_type)}</td>
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
              {withMotivo && (
                <td className="px-4 py-3">
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
                    {candidate.exclusion_reason_text || candidate.exclusion_reason_code || 'Motivo non specificato'}
                  </span>
                </td>
              )}
              <td className="px-4 py-3">{renderActionsCell(candidate)}</td>
            </tr>
          )
        }

        return (
          <>
            {/* Pronti section */}
            <section className="mb-6">
              <header className="flex items-center justify-between gap-3 mb-3">
                <div className="inline-flex items-center gap-2 text-sm font-semibold text-theme-text-primary">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                  Pronti
                  <span className="text-xs text-theme-text-secondary font-normal">({pronti.length})</span>
                </div>
                {pronti.length > 0 && (
                  <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-theme-text-secondary">
                    <input
                      type="checkbox"
                      checked={selectAll}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded accent-dr7-gold"
                    />
                    <span>Seleziona tutti</span>
                    {selectedIds.size > 0 && (
                      <span className="text-theme-text-secondary">— {selectedIds.size} selezionati</span>
                    )}
                  </label>
                )}
              </header>
              <div className="bg-theme-bg-primary border border-theme-border rounded-2xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-theme-bg-tertiary/50 border-b border-theme-border text-xs uppercase tracking-wide text-theme-text-secondary">
                        <th className="px-4 py-3 text-left w-10"></th>
                        <th className="px-4 py-3 text-left font-medium">Stato</th>
                        <th className="px-4 py-3 text-left font-medium">Cliente</th>
                        <th className="px-4 py-3 text-left font-medium">Oggetto</th>
                        <th className="px-4 py-3 text-left font-medium">Email</th>
                        <th className="px-4 py-3 text-left font-medium">WhatsApp</th>
                        <th className="px-4 py-3 text-right font-medium">Azioni</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pronti.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-12 text-center text-theme-text-secondary">
                            Nessun cliente pronto per ricevere la richiesta di recensione
                          </td>
                        </tr>
                      ) : (
                        pronti.map(c => renderRow(c, true, false))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            {/* Esclusi section */}
            <section className="mb-6">
              <header className="flex flex-wrap items-center gap-2 mb-3">
                <div className="inline-flex items-center gap-2 text-sm font-semibold text-theme-text-primary">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                  Esclusi
                  <span className="text-xs text-theme-text-secondary font-normal">({esclusi.length})</span>
                </div>
                {/* Motivo sub-filter pills — make the danni/penali split visible */}
                <div className="flex flex-wrap items-center gap-1.5 ml-auto">
                  {([
                    { key: 'ALL', label: 'Tutti motivi', count: motivoCounts.all, dot: 'bg-gray-400' },
                    { key: 'PENALE', label: 'Penali', count: motivoCounts.penali, dot: 'bg-red-500' },
                    { key: 'DANNO', label: 'Danni', count: motivoCounts.danni, dot: 'bg-orange-500' },
                    { key: 'OPEN_DEPOSIT', label: 'Cauzione aperta', count: motivoCounts.cauzione, dot: 'bg-amber-500' },
                    { key: 'ALTRI', label: 'Altri', count: motivoCounts.altri, dot: 'bg-gray-400' },
                  ] as const).map(p => {
                    const active = motivoFilter === p.key
                    return (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => setMotivoFilter(active ? 'ALL' : p.key)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                          active
                            ? 'border-theme-text-primary bg-theme-bg-primary text-theme-text-primary'
                            : 'border-theme-border bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${p.dot}`} />
                        {p.label}
                        <span className="text-theme-text-secondary/70">{p.count}</span>
                      </button>
                    )
                  })}
                </div>
              </header>
              <div className="bg-yellow-50 border border-yellow-300 rounded-xl px-4 py-3 mb-3 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-yellow-600 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <span className="text-sm text-yellow-800">
                  <strong>Attenzione:</strong> Non inviare recensioni a clienti potenzialmente problematici (penali, danni, cauzione aperta, ecc.).
                </span>
              </div>
              <div className="bg-theme-bg-primary border border-theme-border rounded-2xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-theme-bg-tertiary/50 border-b border-theme-border text-xs uppercase tracking-wide text-theme-text-secondary">
                        <th className="px-4 py-3 text-left font-medium">Stato</th>
                        <th className="px-4 py-3 text-left font-medium">Cliente</th>
                        <th className="px-4 py-3 text-left font-medium">Oggetto</th>
                        <th className="px-4 py-3 text-left font-medium">Email</th>
                        <th className="px-4 py-3 text-left font-medium">WhatsApp</th>
                        <th className="px-4 py-3 text-left font-medium">Motivo</th>
                        <th className="px-4 py-3 text-right font-medium">Azioni</th>
                      </tr>
                    </thead>
                    <tbody>
                      {esclusi.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-12 text-center text-theme-text-secondary">
                            Nessun cliente escluso
                          </td>
                        </tr>
                      ) : (
                        esclusi.map(c => renderRow(c, false, true))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </>
        )
      })()}

      </div>{/* /main column */}

      {/* ── Sidebar (lg+ only) ─────────────────────────────────────────── */}
      <aside className="space-y-3">
        {/* Suggerimenti Intelligenti — derivati dai dati reali */}
        <div className="bg-theme-bg-secondary border border-theme-border rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-amber-500" viewBox="0 0 20 20" fill="currentColor">
              <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z" />
            </svg>
            <h3 className="text-sm font-semibold text-theme-text-primary">Suggerimenti Intelligenti</h3>
          </div>
          <div className="space-y-2">
            {aiSuggestions.map((s, i) => {
              const dotCls = s.color === 'emerald' ? 'bg-emerald-500' : s.color === 'amber' ? 'bg-amber-500' : 'bg-red-500'
              return (
                <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-theme-bg-primary border border-theme-border">
                  <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${dotCls}`} />
                  <span className="text-xs text-theme-text-secondary leading-relaxed">{s.text}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Automazioni Attive — toggles wired to settingsDraft */}
        <div className="bg-theme-bg-secondary border border-theme-border rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <h3 className="text-sm font-semibold text-theme-text-primary">Automazioni Attive</h3>
          </div>
          <div className="space-y-2 text-xs">
            {[
              { label: 'Invio auto Noleggio', on: settingsDraft.auto_send_rental, key: 'auto_send_rental' as const },
              { label: 'Invio auto Lavaggio', on: settingsDraft.auto_send_wash, key: 'auto_send_wash' as const },
              { label: 'Conferma manuale casi gialli', on: settingsDraft.require_manual_confirm_yellow, key: 'require_manual_confirm_yellow' as const },
            ].map(item => (
              <label key={item.key} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-theme-bg-primary border border-theme-border cursor-pointer">
                <span className="text-theme-text-primary">{item.label}</span>
                <input
                  type="checkbox"
                  checked={item.on}
                  onChange={e => setSettingsDraft({ ...settingsDraft, [item.key]: e.target.checked })}
                  className="w-9 h-5 rounded-full appearance-none bg-theme-bg-tertiary checked:bg-emerald-500 relative cursor-pointer before:content-[''] before:absolute before:top-0.5 before:left-0.5 before:w-4 before:h-4 before:rounded-full before:bg-white before:transition-transform checked:before:translate-x-4"
                />
              </label>
            ))}
          </div>
          <button
            onClick={handleSaveSettings}
            disabled={savingSettings}
            className="mt-3 w-full text-[11px] text-cyan-400 hover:text-cyan-300 font-medium disabled:opacity-50"
          >
            {savingSettings ? 'Salvataggio…' : 'Salva automazioni'}
          </button>
        </div>

        {/* Statistiche per Piattaforma — conteggio reale invii per canale */}
        <div className="bg-theme-bg-secondary border border-theme-border rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <h3 className="text-sm font-semibold text-theme-text-primary">Statistiche per Canale</h3>
          </div>
          <div className="space-y-2.5 text-xs">
            {(() => {
              const emailCount = visibleCandidates.filter(c => c.send_status === 'SENT' && c.contact_available_email).length
              const waCount = visibleCandidates.filter(c => c.send_status === 'SENT' && c.contact_available_whatsapp).length
              const max = Math.max(emailCount, waCount, 1)
              return (
                <>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-theme-text-primary">WhatsApp</span>
                      <span className="text-theme-text-secondary tabular-nums">{waCount}</span>
                    </div>
                    <div className="h-1.5 bg-theme-bg-primary rounded-full overflow-hidden">
                      <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${(waCount / max) * 100}%` }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-theme-text-primary">Email</span>
                      <span className="text-theme-text-secondary tabular-nums">{emailCount}</span>
                    </div>
                    <div className="h-1.5 bg-theme-bg-primary rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${(emailCount / max) * 100}%` }} />
                    </div>
                  </div>
                </>
              )
            })()}
          </div>
        </div>

        {/* Orario Migliore per Invio */}
        <div className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 border border-amber-500/30 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 className="text-sm font-semibold text-theme-text-primary">Orario Migliore per Invio</h3>
          </div>
          <div className="text-3xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">
            {bestSendWindow.label}
          </div>
          <div className="text-[11px] text-theme-text-secondary mt-1">
            {bestSendWindow.rate > 0
              ? `${bestSendWindow.rate}% degli invii in questa fascia`
              : 'Fascia consigliata (nessun dato storico)'}
          </div>
        </div>
      </aside>

      </div>{/* /2-col grid */}

    </div>
  )
}
