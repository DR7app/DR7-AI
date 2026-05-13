import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { requireAuth } from './require-auth'
import { userHasRole } from './utils/adminRoles'
import { randomInt } from 'crypto'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// OTP recipient — direzione's working channel. Config chain:
//   1) centralina_pro_config.config.notifications.otp_recipient (boss-editable)
//   2) process.env.OTP_RECIPIENT                                 (netlify env)
//   3) hardcoded fallback                                        (recovery)
// When a superadmin himself triggers an OTP-required action the bypass
// below auto-approves without sending any email.
const OTP_RECIPIENT_FALLBACK = 'valesaja91@icloud.com'
async function getOtpRecipient(): Promise<string> {
  try {
    const { data } = await supabase
      .from('centralina_pro_config')
      .select('config')
      .eq('id', 'main')
      .maybeSingle()
    const cfg = (data?.config || {}) as Record<string, unknown>
    const notif = (cfg.notifications || {}) as Record<string, unknown>
    const v = notif.otp_recipient
    if (typeof v === 'string' && v.includes('@')) return v
  } catch (e) {
    console.warn('[limitation-override-otp] OTP recipient lookup failed, using fallback', e)
  }
  return process.env.OTP_RECIPIENT || OTP_RECIPIENT_FALLBACK
}
const OTP_TTL_MINUTES = 10
const OVERRIDE_TTL_HOURS = 2

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  const { user: authUser, error: authErr } = await requireAuth(event)
  if (authErr) return authErr

  try {
    const body = JSON.parse(event.body || '{}')
    const { action } = body

    // ── SEND OTP ──
    if (action === 'send') {
      const { limitationCode, limitationMessage, actionContext, draftSessionId, flowType, details, notes } = body
      // `details` (opzionale): array di { label, value } o oggetto piatto
      // Es: [ { label: 'Cliente', value: 'Mario Rossi' }, { label: 'Veicolo', value: 'BMW X5' } ]
      // O equivalente: { Cliente: 'Mario Rossi', Veicolo: 'BMW X5' }
      // Vengono mostrati nella mail come tabella sotto la 'Limitazione'.
      // `notes` (opzionale ma obbligatorio per modifiche prenotazioni):
      // motivazione testo libero scritta dall'operatore. Mostrata nell'email
      // alla direzione e salvata in metadata per il log attività.
      const trimmedNotes = typeof notes === 'string' ? notes.trim().slice(0, 500) : ''

      if (!limitationCode || !limitationMessage) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing limitationCode or limitationMessage' }) }
      }

      if (!draftSessionId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing draftSessionId' }) }
      }

      const code = String(randomInt(100000, 999999))
      const otpExpiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString()
      const overrideExpiresAt = new Date(Date.now() + OVERRIDE_TTL_HOURS * 60 * 60 * 1000).toISOString()

      // BYPASS — role-tag check via admins.permissions[] (failsafe in
      // utils/adminRoles.ROLE_FAILSAFE keeps valerio/ilenia/ophe safe):
      //   role:direzione         → self-approves every OTP code
      //   role:developer         → self-approves ONLY gestione_otp_* codes
      // Anyone without these tags receives the OTP via email and must type it.
      const requestorEmail = (authUser?.email || '').toLowerCase()
      const isOtpTabAction = typeof limitationCode === 'string'
        && limitationCode.startsWith('gestione_otp_')
      const isDirezione = await userHasRole(requestorEmail, 'direzione')
      const isDeveloperOnOtpTab = isOtpTabAction && await userHasRole(requestorEmail, 'developer')
      const isSelfApproval = !!authUser?.email && (isDirezione || isDeveloperOnOtpTab)

      // Store OTP server-side
      const { data: override, error: insertErr } = await supabase
        .from('limitation_overrides')
        .insert({
          limitation_code: limitationCode,
          action_context: actionContext || null,
          draft_session_id: draftSessionId,
          flow_type: flowType || 'booking_create',
          status: isSelfApproval ? 'active' : 'pending',
          otp_code: code,
          otp_verified: isSelfApproval,
          otp_expires_at: otpExpiresAt,
          expires_at: overrideExpiresAt,
          approved_by_user_id: authUser!.id !== 'admin' ? authUser!.id : null,
          metadata: {
            limitation_message: limitationMessage,
            requested_by: authUser!.email,
            draft_session_id: draftSessionId,
            flow_type: flowType || 'booking_create',
            ...(trimmedNotes ? { notes: trimmedNotes } : {}),
            ...(isSelfApproval ? { auto_approved: true, reason: 'requestor is OTP recipient' } : {})
          }
        })
        .select('id')
        .single()

      if (insertErr) {
        console.error('[limitation-override-otp] Insert error:', insertErr)
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to create override request' }) }
      }

      // Self-approval shortcut: skip email, return active override.
      if (isSelfApproval) {
        console.log(`[limitation-override-otp] AUTO-APPROVED for ${authUser!.email} (superadmin) — override ${override.id}`)
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, autoApproved: true, overrideId: override.id })
        }
      }

      // Send email via Resend (same channel as wallet OTP)
      const apiKey = process.env.RESEND_API_KEY
      if (!apiKey) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'RESEND_API_KEY not configured' }) }
      }

      // Normalizza `details`. Supportiamo tre forme:
      //   1. Legacy flat dict:    { Cliente: 'Mario', Email: 'm@x.it', ... }
      //   2. Legacy array:        [{ label: 'Cliente', value: 'Mario' }, ...]
      //   3. Strutturato (nuovo): { customer: {...}, operation: {...}, diff: [...], meta: {...} }
      //
      // Forma strutturata = email con sezioni colorate e tabella diff
      // dedicata. Forma legacy = tabella unica come prima. Backward compat
      // totale: ogni caller che passa il vecchio formato continua a
      // funzionare senza modifiche.
      const escapeHtml = (s: unknown) => String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

      const detailRows: Array<{ label: string; value: string }> = []
      const sections: { customer: Record<string, string>; operation: Record<string, string>; gate: Record<string, string>; meta: Record<string, string>; diff: Array<{ field: string; before: string; after: string }> } = {
        customer: {}, operation: {}, gate: {}, meta: {}, diff: []
      }
      let structured = false
      if (Array.isArray(details)) {
        for (const d of details) {
          if (d && typeof d === 'object' && (d as any).label) {
            detailRows.push({ label: String((d as any).label), value: String((d as any).value ?? '') })
          }
        }
      } else if (details && typeof details === 'object') {
        const d = details as Record<string, unknown>
        // Detect structured form: at least one of customer/operation/diff/gate/meta present
        const hasStructured =
          (d.customer && typeof d.customer === 'object') ||
          (d.operation && typeof d.operation === 'object') ||
          (d.gate && typeof d.gate === 'object') ||
          (d.meta && typeof d.meta === 'object') ||
          Array.isArray(d.diff)
        if (hasStructured) {
          structured = true
          const copy = (src: unknown, dst: Record<string, string>) => {
            if (src && typeof src === 'object') {
              for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
                if (v == null || v === '') continue
                dst[k] = String(v)
              }
            }
          }
          copy(d.customer, sections.customer)
          copy(d.operation, sections.operation)
          copy(d.gate, sections.gate)
          copy(d.meta, sections.meta)
          if (Array.isArray(d.diff)) {
            for (const row of d.diff as unknown[]) {
              if (row && typeof row === 'object') {
                const r = row as Record<string, unknown>
                const field = String(r.field ?? r.label ?? '').trim()
                if (!field) continue
                const before = String(r.before ?? r.prima ?? '').trim()
                const after = String(r.after ?? r.dopo ?? '').trim()
                if (before === after) continue
                sections.diff.push({ field, before, after })
              }
            }
          }
        } else {
          for (const [k, v] of Object.entries(d)) {
            if (v == null || v === '') continue
            detailRows.push({ label: k, value: String(v) })
          }
        }
      }

      // AUTO-SECTION TRANSFORM — every legacy flat-dict / array payload gets
      // classified into customer/operation/gate/meta by label pattern. So 54
      // existing callers immediately get the new sectioned look without any
      // caller-side change. Direzione sees the same structured email everywhere.
      //
      // Rules (case-insensitive substring match on the LABEL):
      //   - Customer: cliente, nome, cognome, email, telefono, patente, fascia,
      //     codice fiscale, indirizzo, citta', CAP
      //   - Gate (the WHY direzione is being asked — highest priority): motivo,
      //     motivazione, scadenza, conflitto, dettaglio conflitto
      //   - Meta (audit trail): operatore, data richiesta, sessione, contesto
      //   - Operation: anything else (booking ref, vehicle, dates, amounts, …)
      if (!structured && detailRows.length > 0) {
        const classify = (label: string): 'customer' | 'gate' | 'meta' | 'operation' => {
          const l = label.toLowerCase().trim()
          if (/^(cliente|nome|cognome|email|email cliente|telefono|telefono cliente|patente|fascia|fascia cliente|codice fiscale|cf|indirizzo|citt[aà]|cap|provincia|residenza)\b/.test(l)) {
            return 'customer'
          }
          if (/^(motivo|motivazione|condizion|dettaglio conflitto|conflitto|patente scaduta|scadenza patente|targa estera|categoria veicolo|anni patente|numero patente|data rilascio|anno veicolo|motivo otp|reason)\b/.test(l)) {
            return 'gate'
          }
          if (/^(operatore|richiesto da|data richiesta|sessione|contesto|flow|tipo flusso|timestamp)\b/.test(l)) {
            return 'meta'
          }
          return 'operation'
        }
        for (const r of detailRows) {
          const bucket = classify(r.label)
          if (bucket === 'customer') sections.customer[r.label] = r.value
          else if (bucket === 'gate') sections.gate[r.label] = r.value
          else if (bucket === 'meta') sections.meta[r.label] = r.value
          else sections.operation[r.label] = r.value
        }
        structured = true
      }

      // Estrai un nome leggibile dall'email dell'operatore.
      // ophe@dr7.app → "Ophe", mario.rossi@dr7.app → "Mario Rossi"
      const operatorEmail = authUser!.email || 'Operatore sconosciuto'
      const operatorName = (() => {
        const local = operatorEmail.split('@')[0]
        if (!local) return operatorEmail
        return local.split(/[._-]/)
          .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
          .join(' ')
      })()

      // Operazione "umana": cerca un'etichetta amichevole nel codice tecnico.
      // Fallback al messaggio della limitazione (già in italiano nei chiamanti).
      const codeToLabel: Record<string, string> = {
        slot_unavailable: 'Forzatura slot non disponibile',
        paid_wash_modify: 'Modifica prenotazione lavaggio pagata',
        prenotazione_lavaggio_conferma: 'Conferma prenotazione lavaggio',
        prenotazione_noleggio_conferma: 'Conferma prenotazione noleggio',
        carta_punti_lavaggio: 'Pagamento con Carta Punti',
        manual_category_carwash: 'Categoria veicolo manuale',
        foreign_plate_carwash: 'Targa estera lavaggio',
        gestione_otp_access: 'Accesso alla tab Gestione OTP',
        gestione_otp_write: 'Modifica regola OTP',
        gestione_otp_toggle: 'Toggle regola OTP',
        gestione_otp_create: 'Creazione regola OTP',
        gestione_otp_delete: 'Eliminazione regola OTP',
        deposit_return_iban: 'Restituzione cauzione su IBAN',
        license_too_recent: 'Patente con meno di 2 anni',
      }
      const operazioneUmana = codeToLabel[limitationCode] || limitationMessage.split('.')[0]

      // Categoria operazione → palette colori dell'operation card.
      // Permette alla direzione di capire al volo la gravità senza leggere.
      const categoryFor = (c: string): { name: string; bg: string; border: string; text: string; accent: string } => {
        if (/\.delete$|^wash\.delete|^booking\.delete|^customer\.delete|^vehicle\.delete|^fattura\.delete/.test(c)) {
          return { name: 'Eliminazione', bg: '#fff1f0', border: '#ff4d4f', text: '#a8071a', accent: '#cf1322' }
        }
        if (/modify|conferma|extension|edit/i.test(c)) {
          return { name: 'Modifica', bg: '#fff8e1', border: '#d4af37', text: '#7a5f00', accent: '#a37e00' }
        }
        if (/mark_paid|carta_punti|sdi/i.test(c)) {
          return { name: 'Pagamento / Fattura', bg: '#e6f7ee', border: '#2fbe6f', text: '#0f5132', accent: '#0a7c3e' }
        }
        if (/^gestione_otp_|^centralina\./i.test(c)) {
          return { name: 'Sistema', bg: '#f0f0ff', border: '#7c7cf2', text: '#2a2a8c', accent: '#3a3aa6' }
        }
        return { name: 'Autorizzazione', bg: '#fff8e1', border: '#d4af37', text: '#7a5f00', accent: '#a37e00' }
      }
      const cat = categoryFor(limitationCode)

      // Render helpers
      const kvTable = (rows: Array<{ label: string; value: string }>) =>
        `<table style="width:100%;font-size:14px;color:#212529;border-collapse:collapse;">
           ${rows.map(r => `
             <tr>
               <td style="padding:7px 12px 7px 0;font-weight:600;color:#495057;width:42%;vertical-align:top;border-bottom:1px solid #eef0f2;">${escapeHtml(r.label)}</td>
               <td style="padding:7px 0;color:#111;border-bottom:1px solid #eef0f2;font-weight:500;">${escapeHtml(r.value)}</td>
             </tr>`).join('')}
         </table>`

      const sectionCard = (title: string, body: string, accent: string) =>
        `<div style="border:1px solid #e9ecef;border-left:4px solid ${accent};border-radius:8px;padding:14px 16px;margin:0 0 14px;background:#fafbfc;">
           <p style="margin:0 0 8px;font-size:11px;color:#495057;text-transform:uppercase;letter-spacing:0.6px;font-weight:700;">${escapeHtml(title)}</p>
           ${body}
         </div>`

      const diffTable = (rows: Array<{ field: string; before: string; after: string }>) =>
        `<table style="width:100%;font-size:13px;color:#212529;border-collapse:collapse;">
           <tr>
             <th style="text-align:left;padding:6px 8px;font-size:11px;color:#6c757d;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #dee2e6;">Campo</th>
             <th style="text-align:left;padding:6px 8px;font-size:11px;color:#a8071a;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #dee2e6;background:#fff1f0;">Prima</th>
             <th style="text-align:left;padding:6px 8px;font-size:11px;color:#0a7c3e;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #dee2e6;background:#e6f7ee;">Dopo</th>
           </tr>
           ${rows.map(r => `
             <tr>
               <td style="padding:8px;font-weight:600;color:#495057;border-bottom:1px solid #eef0f2;vertical-align:top;">${escapeHtml(r.field)}</td>
               <td style="padding:8px;color:#a8071a;background:#fff7f6;border-bottom:1px solid #eef0f2;vertical-align:top;text-decoration:line-through;">${escapeHtml(r.before) || '<span style="color:#999;font-style:italic;">(vuoto)</span>'}</td>
               <td style="padding:8px;color:#0a7c3e;background:#f3fbf6;border-bottom:1px solid #eef0f2;vertical-align:top;font-weight:600;">${escapeHtml(r.after) || '<span style="color:#999;font-style:italic;">(vuoto)</span>'}</td>
             </tr>`).join('')}
         </table>`

      // Build the final details HTML. Section ordering by importance:
      //   1. Gate (Motivo/condizione che ha attivato l'OTP) — direzione legge questa per prima
      //   2. Customer (chi e' coinvolto)
      //   3. Diff (cosa cambia, solo modifiche)
      //   4. Operation (dati prenotazione / azione)
      //   5. Meta (operatore, timestamp, contesto tecnico)
      const detailsTableHtml = structured
        ? [
            Object.keys(sections.gate).length > 0
              ? sectionCard('Motivo della richiesta OTP', kvTable(Object.entries(sections.gate).map(([label, value]) => ({ label, value }))), '#cf1322')
              : '',
            Object.keys(sections.customer).length > 0
              ? sectionCard('Cliente', kvTable(Object.entries(sections.customer).map(([label, value]) => ({ label, value }))), '#1890ff')
              : '',
            sections.diff.length > 0
              ? sectionCard('Modifiche richieste (Prima → Dopo)', diffTable(sections.diff), '#a37e00')
              : '',
            Object.keys(sections.operation).length > 0
              ? sectionCard('Dati operazione', kvTable(Object.entries(sections.operation).map(([label, value]) => ({ label, value }))), cat.accent)
              : '',
            Object.keys(sections.meta).length > 0
              ? sectionCard('Contesto', kvTable(Object.entries(sections.meta).map(([label, value]) => ({ label, value }))), '#6c757d')
              : '',
          ].filter(Boolean).join('')
        : '<p style="margin:8px 0 0;color:#6c757d;font-style:italic;font-size:13px;">Nessun dettaglio aggiuntivo fornito dall\'operatore.</p>'

      const notesHtml = trimmedNotes
        ? `<div style="background:#fff8e1;border:1px solid #d4af37;border-radius:10px;padding:16px;margin:24px 0;">
             <p style="margin:0 0 8px;color:#7a5f00;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:0.6px;">Note dell'operatore</p>
             <p style="margin:0;color:#212529;font-size:14px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(trimmedNotes)}</p>
           </div>`
        : ''

      const requestedAtIt = new Date().toLocaleString('it-IT', {
        timeZone: 'Europe/Rome',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })

      const resend = new Resend(apiKey)
      const { error: emailError } = await resend.emails.send({
        from: 'DR7 Empire <info@dr7.app>',
        to: await getOtpRecipient(),
        subject: `[Autorizzazione] ${operatorName} chiede: ${operazioneUmana} — OTP ${code}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; background: #fff;">
            <!-- Header brand -->
            <div style="background: #000; border-radius: 12px; padding: 28px 16px; text-align: center; margin-bottom: 24px;">
              <img src="https://dr7empire.com/DR7logo1.png" alt="DR7" style="height: 56px; display: block; margin: 0 auto;" />
            </div>

            <!-- Subject line -->
            <p style="margin: 0 0 6px; font-size: 12px; color: #6c757d; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 700;">Richiesta di autorizzazione</p>
            <h1 style="margin: 0 0 8px; font-size: 22px; color: #111; line-height: 1.3;">
              ${escapeHtml(operatorName)} sta chiedendo la tua autorizzazione.
            </h1>
            <p style="margin: 0 0 24px; font-size: 14px; color: #495057; line-height: 1.5;">
              Operatore: <strong>${escapeHtml(operatorName)}</strong> &middot;
              <span style="color: #6c757d;">${escapeHtml(operatorEmail)}</span><br>
              Richiesta ricevuta: <strong>${requestedAtIt}</strong> (Europe/Rome)
            </p>

            <!-- Operation card — colored per category (delete=red, modify=amber, paid=green, system=indigo) -->
            <div style="background: ${cat.bg}; border: 1px solid ${cat.border}; border-radius: 12px; padding: 18px 20px; margin: 16px 0 24px;">
              <p style="margin: 0 0 4px; font-size: 11px; color: ${cat.text}; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700;">${escapeHtml(cat.name)}</p>
              <p style="margin: 0; font-size: 18px; color: ${cat.accent}; font-weight: 700; line-height: 1.35;">${escapeHtml(operazioneUmana)}</p>
              <p style="margin: 10px 0 0; font-size: 13px; color: ${cat.text}; line-height: 1.5;">${escapeHtml(limitationMessage)}</p>
            </div>

            <!-- Details (sectioned if structured payload, single card if legacy) -->
            <div style="margin: 24px 0;">
              ${detailsTableHtml}
            </div>

            ${notesHtml}

            <!-- OTP block -->
            <div style="background: #f8f9fa; border: 2px solid #111; border-radius: 14px; padding: 22px; margin: 28px 0; text-align: center;">
              <p style="margin: 0 0 6px; font-size: 12px; color: #495057; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 700;">Codice OTP</p>
              <div style="display: inline-block; background: #fff; padding: 16px 32px; border-radius: 10px; letter-spacing: 10px; font-size: 36px; font-weight: 800; color: #111; border: 2px solid #d4af37; margin: 6px 0;">
                ${code}
              </div>
              <p style="margin: 12px 0 0; font-size: 13px; color: #495057; line-height: 1.45;">
                Valido per <strong>${OTP_TTL_MINUTES} minuti</strong>.
              </p>
            </div>

            <!-- Decision instructions -->
            <div style="background: #f0f7ff; border-left: 4px solid #007aff; padding: 14px 16px; border-radius: 6px; margin: 24px 0;">
              <p style="margin: 0 0 6px; font-size: 14px; color: #0a3d8c; font-weight: 700;">Come autorizzare</p>
              <p style="margin: 0; font-size: 13px; color: #1a4f9c; line-height: 1.55;">
                Se autorizzi questa operazione, <strong>comunica il codice OTP all'operatore</strong> (WhatsApp / telefono).<br>
                Se NON autorizzi, ignora questa email: il codice scade da solo dopo ${OTP_TTL_MINUTES} minuti e l'operazione resta bloccata.
              </p>
            </div>

            <!-- Audit footer -->
            <hr style="border: none; border-top: 1px solid #e9ecef; margin: 28px 0 16px;" />
            <table style="width: 100%; font-size: 11px; color: #868e96; font-family: 'SF Mono', Menlo, Consolas, monospace;">
              <tr><td style="padding: 2px 0; width: 32%;">codice tecnico</td><td style="padding: 2px 0;">${escapeHtml(limitationCode)}</td></tr>
              ${actionContext ? `<tr><td style="padding: 2px 0;">contesto azione</td><td style="padding: 2px 0;">${escapeHtml(actionContext)}</td></tr>` : ''}
              <tr><td style="padding: 2px 0;">sessione</td><td style="padding: 2px 0;">${escapeHtml(draftSessionId.substring(0, 8))}</td></tr>
              <tr><td style="padding: 2px 0;">tipo flusso</td><td style="padding: 2px 0;">${escapeHtml(flowType || '—')}</td></tr>
            </table>
            <p style="margin: 16px 0 0; font-size: 11px; color: #adb5bd; text-align: center;">
              Dubai Rent 7.0 S.p.A. &middot; www.dr7empire.com
            </p>
          </div>
        `
      })

      if (emailError) {
        console.error('[limitation-override-otp] Email error:', emailError)
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to send OTP email' }) }
      }

      console.log(`[limitation-override-otp] OTP sent for ${limitationCode}, override ${override.id}, session ${draftSessionId.substring(0, 8)}`)
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, overrideId: override.id }) }
    }

    // ── VERIFY OTP ──
    if (action === 'verify') {
      const { overrideId, code } = body

      if (!overrideId || !code) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing overrideId or code' }) }
      }

      // Fetch the override record
      const { data: override, error: fetchErr } = await supabase
        .from('limitation_overrides')
        .select('*')
        .eq('id', overrideId)
        .single()

      if (fetchErr || !override) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Override request not found' }) }
      }

      // Check if already verified/active
      if (override.status === 'active' || override.otp_verified) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, already_verified: true }) }
      }

      // Check if consumed or expired status
      if (override.status === 'consumed' || override.status === 'expired' || override.status === 'revoked') {
        return { statusCode: 410, headers, body: JSON.stringify({ error: 'Override non più valido.' }) }
      }

      // Check OTP expiry
      if (new Date(override.otp_expires_at) < new Date()) {
        await supabase.from('limitation_overrides').update({ status: 'expired' }).eq('id', overrideId)
        return { statusCode: 410, headers, body: JSON.stringify({ error: 'Codice scaduto. Richiedi un nuovo codice.' }) }
      }

      // Check max attempts (5)
      if (override.otp_attempts >= 5) {
        return { statusCode: 429, headers, body: JSON.stringify({ error: 'Troppi tentativi. Richiedi un nuovo codice.' }) }
      }

      // Increment attempts
      await supabase
        .from('limitation_overrides')
        .update({ otp_attempts: override.otp_attempts + 1, updated_at: new Date().toISOString() })
        .eq('id', overrideId)

      // Verify code
      if (code !== override.otp_code) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Codice non valido' }) }
      }

      // Mark as active (verified + usable)
      const overrideExpiresAt = new Date(Date.now() + OVERRIDE_TTL_HOURS * 60 * 60 * 1000).toISOString()
      await supabase
        .from('limitation_overrides')
        .update({
          otp_verified: true,
          status: 'active',
          approved_at: new Date().toISOString(),
          expires_at: overrideExpiresAt,
          updated_at: new Date().toISOString()
        })
        .eq('id', overrideId)

      console.log(`[limitation-override-otp] Override ${overrideId} verified for ${override.limitation_code}`)
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
    }

    // ── VALIDATE (backend check before booking creation) ──
    if (action === 'validate') {
      const { draftSessionId, flowType, ruleCodes } = body

      if (!draftSessionId || !ruleCodes || !Array.isArray(ruleCodes)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing draftSessionId or ruleCodes' }) }
      }

      // Find all active overrides for this session
      const { data: overrides } = await supabase
        .from('limitation_overrides')
        .select('id, limitation_code, status, expires_at, otp_verified')
        .eq('draft_session_id', draftSessionId)
        .eq('status', 'active')
        .eq('otp_verified', true)

      const now = new Date()
      const validOverrides: Record<string, string> = {} // ruleCode -> overrideId

      for (const o of (overrides || [])) {
        // Check TTL
        if (o.expires_at && new Date(o.expires_at) < now) {
          // Expire it lazily
          await supabase.from('limitation_overrides').update({ status: 'expired', updated_at: now.toISOString() }).eq('id', o.id)
          continue
        }
        if (flowType && o.flow_type && o.flow_type !== flowType) continue
        validOverrides[o.limitation_code] = o.id
      }

      // For each requested ruleCode, check if there's a valid override
      const results: Record<string, { valid: boolean; overrideId?: string }> = {}
      for (const code of ruleCodes) {
        if (validOverrides[code]) {
          results[code] = { valid: true, overrideId: validOverrides[code] }
        } else {
          results[code] = { valid: false }
        }
      }

      return { statusCode: 200, headers, body: JSON.stringify({ results }) }
    }

    // ── CHECK OVERRIDE ──
    if (action === 'check') {
      const { overrideId } = body

      if (!overrideId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing overrideId' }) }
      }

      const { data: override } = await supabase
        .from('limitation_overrides')
        .select('otp_verified, consumed_at, otp_expires_at, expires_at, limitation_code, status, draft_session_id')
        .eq('id', overrideId)
        .single()

      if (!override) {
        return { statusCode: 404, headers, body: JSON.stringify({ valid: false }) }
      }

      const now = new Date()
      const valid = override.status === 'active'
        && override.otp_verified
        && !override.consumed_at
        && (!override.expires_at || new Date(override.expires_at) > now)

      return { statusCode: 200, headers, body: JSON.stringify({
        valid,
        limitationCode: override.limitation_code,
        draftSessionId: override.draft_session_id
      })}
    }

    // ── CONSUME OVERRIDE (link to booking) ──
    if (action === 'consume') {
      const { overrideId, bookingId } = body

      if (!overrideId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing overrideId' }) }
      }

      const updateData: Record<string, unknown> = {
        status: 'consumed',
        consumed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
      if (bookingId) {
        updateData.booking_id = bookingId
      }

      await supabase
        .from('limitation_overrides')
        .update(updateData)
        .eq('id', overrideId)
        .eq('otp_verified', true)
        .in('status', ['active', 'pending'])

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[limitation-override-otp] Error:', message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: message }) }
  }
}
