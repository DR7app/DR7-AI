/**
 * Send a SAMPLE OTP email to the requesting admin (or a specified recipient).
 * Built so direzione can preview the OTP email design without having to
 * trigger a real gate from a non-bypass operator account.
 *
 * Endpoint: POST /.netlify/functions/send-otp-preview
 * Body: {
 *   sample?:    'paid_wash_modify' | 'fattura_delete' | 'rental_modify_diff' | 'carta_punti' | 'wash_delete',
 *   code?:      any OTP limitation code (e.g. 'license_expired', 'slot_unavailable', ...) — uses a generic
 *               sample with the row's label/reason if it's not in the SAMPLES map
 *   label?:     human label for the OTP (used when `code` is set + no matching SAMPLES)
 *   reason?:    motivo from system_otp_overrides (becomes the "Motivo OTP" in the email)
 *   recipient?: email to send to (defaults to authUser.email)
 * }
 *
 * Defaults: sample='paid_wash_modify', recipient = authUser.email.
 * No DB writes, no audit log, no real OTP — just the email render path.
 * The OTP code shown is the literal string "123456" so it's obvious this is
 * a preview, not a real codice.
 */

import type { Handler } from '@netlify/functions'
import { Resend } from 'resend'
import { requireAuth } from './require-auth'

const OTP_TTL_MINUTES = 10
const FAKE_CODE = '123456'

interface SamplePayload {
  limitationCode: string
  limitationMessage: string
  flowType: string
  actionContext: string
  details: {
    gate?: Record<string, string>
    customer?: Record<string, string>
    diff?: Array<{ field: string; before: string; after: string }>
    operation?: Record<string, string>
    meta?: Record<string, string>
  }
}

const SAMPLES: Record<string, SamplePayload> = {
  paid_wash_modify: {
    limitationCode: 'paid_wash_modify',
    limitationMessage: 'Modifica o spostamento di un lavaggio gia\' pagato o confermato: serve OTP della direzione.',
    flowType: 'booking_edit',
    actionContext: 'wash_edit_BC50EC13',
    details: {
      gate: { 'Motivo OTP': 'Modifica di una prenotazione lavaggio gia\' confermata — direzione vuole approvare ogni cambio.' },
      customer: { Nome: 'Mario Rossi', Email: 'mario.rossi@example.com', Telefono: '+39 333 1234567' },
      operation: {
        'Tipo operazione': 'Modifica prenotazione lavaggio (gia\' pagata o confermata)',
        'Riferimento': 'DR7-BC50EC13',
        Servizio: 'PRIME INTERIOR CLEAN',
        Veicolo: 'BMW X5',
        Targa: 'DL263LZ',
        'Data appuntamento': '20/05/2026',
        Ora: '10:30',
        'Importo totale': '€ 19,90',
        'Acconto incassato': '€ 0,00',
        'Metodo pagamento': 'Carta di Credito / bancomat',
        'Stato pagamento': 'paid',
        'Stato prenotazione': 'confirmed',
      },
      meta: { Operatore: 'davide@dr7.app', 'Data richiesta': new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) },
    },
  },
  rental_modify_diff: {
    limitationCode: 'paid_rental_modify',
    limitationMessage: 'Modifica di una prenotazione noleggio pagata o confermata',
    flowType: 'booking_edit',
    actionContext: 'booking_edit_A1B2C3D4',
    details: {
      gate: { Motivo: 'Modifica di una prenotazione pagata o confermata' },
      customer: { Nome: 'Lucia Bianchi', Telefono: '+39 347 9876543' },
      diff: [
        { field: 'Ritiro', before: '18/05/2026 10:00', after: '20/05/2026 10:00' },
        { field: 'Riconsegna', before: '20/05/2026 10:00', after: '22/05/2026 10:00' },
        { field: 'Importo totale', before: '€ 280,00', after: '€ 420,00' },
        { field: 'Metodo pagamento', before: 'Contanti', after: 'Bonifico' },
      ],
      operation: {
        'Tipo operazione': 'Modifica prenotazione',
        'Riferimento': 'DR7-A1B2C3D4',
        Veicolo: 'Audi A4 (CG987EE)',
        Ritiro: '20/05/2026 10:00',
        Riconsegna: '22/05/2026 10:00',
        'Luogo ritiro': 'Cagliari Aeroporto',
        Totale: '€ 420,00',
        Cauzione: '€ 500,00',
        Pagamento: 'Bonifico',
      },
      meta: { 'Data richiesta': new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) },
    },
  },
  carta_punti: {
    limitationCode: 'carta_punti_lavaggio',
    limitationMessage: 'Pagamento Carta Punti richiede autorizzazione direzionale per ogni prenotazione',
    flowType: 'booking_create',
    actionContext: 'carta_punti_BC50EC13',
    details: {
      gate: {
        'Motivo OTP': 'Pagamento con Carta Punti — ogni operazione richiede approvazione direzionale.',
        'Metodo pagamento': 'Carta Punti',
      },
      customer: { Nome: 'Giuseppe Verdi', Email: 'g.verdi@example.com', Telefono: '+39 320 5556677' },
      operation: {
        'Tipo operazione': 'Nuova prenotazione lavaggio (Carta Punti)',
        Servizio: 'PRIME FULL CLEAN',
        'Durata stimata': '90 min',
        Veicolo: 'Mercedes Classe A',
        Targa: 'AB123CD',
        'Tipo veicolo': 'Auto urban',
        'Data appuntamento': '19/05/2026',
        'Ora appuntamento': '15:00',
        'Importo totale': '€ 14,90',
        'Stato pagamento': 'pending',
      },
      meta: { Operatore: 'davide@dr7.app', 'Data richiesta': new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) },
    },
  },
  fattura_delete: {
    limitationCode: 'fattura.delete',
    limitationMessage: 'Eliminare la fattura 2026/0045 — Mario Rossi: azione irreversibile.',
    flowType: 'booking_edit',
    actionContext: 'fattura_delete_2026_0045',
    details: {
      gate: { 'Motivo OTP': 'Eliminazione fattura — azione irreversibile, blocca solo se non ancora inviata a SDI.' },
      customer: { Cliente: 'Mario Rossi', 'Codice fiscale': 'RSSMRA80A01H501Z' },
      operation: {
        'Numero fattura': '2026/0045',
        'Tipo documento': 'Fattura',
        'Data emissione': '10/05/2026',
        'Importo totale': '€ 549,80',
        'Imponibile': '€ 450,66',
        'IVA': '€ 99,14',
        'Metodo pagamento': 'Carta di Credito',
        'Stato pagamento': 'paid',
        'Stato SDI': 'non inviato',
      },
      meta: { 'Data richiesta': new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) },
    },
  },
  wash_delete: {
    limitationCode: 'wash.delete',
    limitationMessage: 'Eliminare il lavaggio di Lucia Bianchi: azione irreversibile.',
    flowType: 'booking_edit',
    actionContext: 'wash_delete_BC50EC13',
    details: {
      gate: { 'Motivo OTP': 'Eliminazione prenotazione lavaggio — azione irreversibile.' },
      customer: { Nome: 'Lucia Bianchi', Email: 'lucia.bianchi@example.com', Telefono: '+39 347 9876543' },
      operation: {
        'Tipo operazione': 'Elimina prenotazione lavaggio',
        'Riferimento': 'DR7-BC50EC13',
        Servizio: 'PRIME INTERIOR CLEAN',
        Veicolo: 'Fiat 500',
        Targa: 'EF456GH',
        'Data appuntamento': '21/05/2026',
        Ora: '11:00',
        'Importo totale': '€ 19,90',
        'Stato pagamento': 'paid',
        'Stato prenotazione': 'confirmed',
      },
      meta: { Operatore: 'davide@dr7.app', 'Data richiesta': new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) },
    },
  },
}

function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function categoryFor(c: string): { name: string; bg: string; border: string; text: string; accent: string } {
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

const codeToLabel: Record<string, string> = {
  paid_wash_modify: 'Modifica prenotazione lavaggio pagata',
  paid_rental_modify: 'Modifica prenotazione noleggio pagata',
  carta_punti_lavaggio: 'Pagamento con Carta Punti',
  'wash.delete': 'Eliminazione prenotazione lavaggio',
  'fattura.delete': 'Eliminazione fattura',
}

function renderEmailHtml(p: SamplePayload, code: string, operatorName: string, operatorEmail: string, recipient: string): string {
  const requestedAtIt = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const cat = categoryFor(p.limitationCode)
  const operazioneUmana = codeToLabel[p.limitationCode] || p.limitationMessage.split('.')[0]
  const flowTypeLabel = (() => {
    const ft = String(p.flowType || '').toLowerCase()
    if (ft === 'booking_create') return 'Creazione nuova prenotazione'
    if (ft === 'booking_edit') return 'Modifica prenotazione esistente'
    if (ft === 'preventivo_create') return 'Creazione nuovo preventivo'
    if (ft === 'preventivo_edit') return 'Modifica preventivo esistente'
    return ft || 'non specificato'
  })()

  const kvTable = (rows: Array<{ label: string; value: string }>) =>
    `<table style="width:100%;font-size:14px;color:#212529;border-collapse:collapse;">${rows.map(r => `<tr><td style="padding:7px 12px 7px 0;font-weight:600;color:#495057;width:42%;vertical-align:top;border-bottom:1px solid #eef0f2;">${escapeHtml(r.label)}</td><td style="padding:7px 0;color:#111;border-bottom:1px solid #eef0f2;font-weight:500;">${escapeHtml(r.value)}</td></tr>`).join('')}</table>`
  const sectionCard = (title: string, body: string, accent: string) =>
    `<div style="border:1px solid #e9ecef;border-left:4px solid ${accent};border-radius:8px;padding:14px 16px;margin:0 0 14px;background:#fafbfc;"><p style="margin:0 0 8px;font-size:11px;color:#495057;text-transform:uppercase;letter-spacing:0.6px;font-weight:700;">${escapeHtml(title)}</p>${body}</div>`
  const diffTable = (rows: Array<{ field: string; before: string; after: string }>) =>
    `<table style="width:100%;font-size:13px;color:#212529;border-collapse:collapse;"><tr><th style="text-align:left;padding:6px 8px;font-size:11px;color:#6c757d;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #dee2e6;">Campo</th><th style="text-align:left;padding:6px 8px;font-size:11px;color:#a8071a;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #dee2e6;background:#fff1f0;">Prima</th><th style="text-align:left;padding:6px 8px;font-size:11px;color:#0a7c3e;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #dee2e6;background:#e6f7ee;">Dopo</th></tr>${rows.map(r => `<tr><td style="padding:8px;font-weight:600;color:#495057;border-bottom:1px solid #eef0f2;vertical-align:top;">${escapeHtml(r.field)}</td><td style="padding:8px;color:#a8071a;background:#fff7f6;border-bottom:1px solid #eef0f2;vertical-align:top;text-decoration:line-through;">${escapeHtml(r.before) || '<span style="color:#999;font-style:italic;">(vuoto)</span>'}</td><td style="padding:8px;color:#0a7c3e;background:#f3fbf6;border-bottom:1px solid #eef0f2;vertical-align:top;font-weight:600;">${escapeHtml(r.after) || '<span style="color:#999;font-style:italic;">(vuoto)</span>'}</td></tr>`).join('')}</table>`

  const sec = p.details
  const detailsHtml = [
    sec.gate && Object.keys(sec.gate).length > 0 ? sectionCard('Motivo della richiesta OTP', kvTable(Object.entries(sec.gate).map(([label, value]) => ({ label, value }))), '#cf1322') : '',
    sec.customer && Object.keys(sec.customer).length > 0 ? sectionCard('Cliente', kvTable(Object.entries(sec.customer).map(([label, value]) => ({ label, value }))), '#1890ff') : '',
    sec.diff && sec.diff.length > 0 ? sectionCard('Modifiche richieste (Prima → Dopo)', diffTable(sec.diff), '#a37e00') : '',
    sec.operation && Object.keys(sec.operation).length > 0 ? sectionCard('Dati operazione', kvTable(Object.entries(sec.operation).map(([label, value]) => ({ label, value }))), cat.accent) : '',
    sec.meta && Object.keys(sec.meta).length > 0 ? sectionCard('Contesto', kvTable(Object.entries(sec.meta).map(([label, value]) => ({ label, value }))), '#6c757d') : '',
  ].filter(Boolean).join('')

  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; background: #fff;">
    <div style="background:#fff3cd;border:1px solid #d4af37;border-radius:8px;padding:10px 14px;margin-bottom:20px;font-size:12px;color:#7a5f00;font-weight:600;text-align:center;">
      ANTEPRIMA EMAIL OTP &middot; Codice fittizio "${FAKE_CODE}" &middot; Nessuna autorizzazione reale generata
    </div>
    <div style="background: #000; border-radius: 12px; padding: 28px 16px; text-align: center; margin-bottom: 24px;">
      <img src="https://dr7.app/DR7logo1.png" alt="DR7" style="height: 56px; display: block; margin: 0 auto;" />
    </div>
    <p style="margin: 0 0 6px; font-size: 12px; color: #6c757d; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 700;">Richiesta di autorizzazione direzionale</p>
    <h1 style="margin: 0 0 8px; font-size: 22px; color: #111; line-height: 1.3;">${escapeHtml(operatorName)} sta chiedendo la tua autorizzazione.</h1>
    <table style="margin: 0 0 24px; font-size: 14px; color: #495057; line-height: 1.6; border-collapse: collapse;">
      <tr><td style="padding-right: 12px; color: #6c757d; font-weight: 600;">Operatore:</td><td><strong>${escapeHtml(operatorName)}</strong> <span style="color:#868e96;">(${escapeHtml(operatorEmail)})</span></td></tr>
      <tr><td style="padding-right: 12px; color: #6c757d; font-weight: 600;">Richiesta ricevuta:</td><td><strong>${requestedAtIt}</strong> <span style="color:#868e96;">ora italiana</span></td></tr>
      <tr><td style="padding-right: 12px; color: #6c757d; font-weight: 600;">Scadenza codice:</td><td><strong>${OTP_TTL_MINUTES} minuti</strong> dall'invio</td></tr>
    </table>
    <div style="background: ${cat.bg}; border: 2px solid ${cat.border}; border-radius: 12px; padding: 20px 22px; margin: 16px 0 24px;">
      <p style="margin: 0 0 6px; font-size: 11px; color: ${cat.text}; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 700;">Categoria operazione &middot; ${escapeHtml(cat.name)}</p>
      <p style="margin: 0; font-size: 20px; color: ${cat.accent}; font-weight: 800; line-height: 1.3;">${escapeHtml(operazioneUmana)}</p>
      <p style="margin: 12px 0 0; font-size: 14px; color: ${cat.text}; line-height: 1.55;">${escapeHtml(p.limitationMessage)}</p>
    </div>
    <div style="margin: 24px 0;">${detailsHtml}</div>
    <div style="background: #f8f9fa; border: 2px solid #111; border-radius: 14px; padding: 22px; margin: 28px 0; text-align: center;">
      <p style="margin: 0 0 6px; font-size: 12px; color: #495057; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 700;">Codice OTP</p>
      <div style="display: inline-block; background: #fff; padding: 16px 32px; border-radius: 10px; letter-spacing: 10px; font-size: 36px; font-weight: 800; color: #111; border: 2px solid #d4af37; margin: 6px 0;">${FAKE_CODE}</div>
      <p style="margin: 12px 0 0; font-size: 13px; color: #495057; line-height: 1.45;">Valido per <strong>${OTP_TTL_MINUTES} minuti</strong>.</p>
    </div>
    <div style="background: #f0f7ff; border-left: 4px solid #007aff; padding: 14px 16px; border-radius: 6px; margin: 24px 0;">
      <p style="margin: 0 0 6px; font-size: 14px; color: #0a3d8c; font-weight: 700;">Come autorizzare questa operazione</p>
      <ol style="margin: 0; padding-left: 18px; font-size: 13px; color: #1a4f9c; line-height: 1.6;">
        <li><strong>Verifica</strong> i dettagli sopra (cliente, importo, modifiche).</li>
        <li>Se autorizzi: <strong>comunica il codice OTP all'operatore</strong> via WhatsApp o telefono.</li>
        <li>Se NON autorizzi: <strong>ignora questa email</strong>. Il codice scade da solo dopo ${OTP_TTL_MINUTES} minuti e l'operazione resta bloccata.</li>
      </ol>
      <p style="margin: 10px 0 0; font-size: 12px; color: #1a4f9c; font-style: italic;">Ogni codice e' usabile una sola volta e solo per questa specifica richiesta.</p>
    </div>
    <hr style="border: none; border-top: 1px solid #e9ecef; margin: 28px 0 16px;" />
    <p style="margin: 0 0 8px; font-size: 10px; color: #6c757d; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 700;">Riferimenti tecnici (audit)</p>
    <table style="width: 100%; font-size: 11px; color: #868e96; font-family: 'SF Mono', Menlo, Consolas, monospace;">
      <tr><td style="padding: 3px 8px 3px 0; width: 38%; color: #495057;">Codice tecnico OTP</td><td style="padding: 3px 0;">${escapeHtml(p.limitationCode)}</td></tr>
      <tr><td style="padding: 3px 8px 3px 0; color: #495057;">Contesto azione</td><td style="padding: 3px 0;">${escapeHtml(p.actionContext)}</td></tr>
      <tr><td style="padding: 3px 8px 3px 0; color: #495057;">ID sessione</td><td style="padding: 3px 0;">preview_${code.slice(0, 8)}</td></tr>
      <tr><td style="padding: 3px 8px 3px 0; color: #495057;">Tipo flusso</td><td style="padding: 3px 0;">${escapeHtml(flowTypeLabel)}</td></tr>
      <tr><td style="padding: 3px 8px 3px 0; color: #495057;">Inviato a</td><td style="padding: 3px 0;">${escapeHtml(recipient)}</td></tr>
    </table>
    <p style="margin: 16px 0 0; font-size: 11px; color: #adb5bd; text-align: center;">Dubai Rent 7.0 S.p.A. &middot; Cagliari, Sardegna &middot; <a href="https://www.dr7.app" style="color: #adb5bd; text-decoration: none;">www.dr7.app</a></p>
    <p style="margin: 6px 0 0; font-size: 10px; color: #c7ced3; text-align: center;">Questa email e' generata automaticamente dal sistema DR7. Non rispondere a questo messaggio.</p>
  </div>`
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }
  const { user: authUser, error: authErr } = await requireAuth(event)
  if (authErr) return authErr

  let body: {
    sample?: keyof typeof SAMPLES
    code?: string
    label?: string
    reason?: string
    recipient?: string
  } = {}
  try { body = JSON.parse(event.body || '{}') } catch { /* keep {} */ }
  const recipient = (body.recipient || authUser?.email || '').trim()
  if (!recipient) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Recipient missing (no authUser.email and no body.recipient)' }) }
  }

  // Resolve payload. Priority:
  //   1. sample (legacy / preset names)
  //   2. code matching a SAMPLES key
  //   3. code + label + reason → generic fallback sample
  //   4. default to paid_wash_modify
  let payload: SamplePayload
  let sample: string
  if (body.sample && SAMPLES[body.sample]) {
    sample = body.sample
    payload = SAMPLES[sample]
  } else if (body.code && SAMPLES[body.code as keyof typeof SAMPLES]) {
    sample = body.code
    payload = SAMPLES[body.code as keyof typeof SAMPLES]
  } else if (body.code) {
    // Generic sample using only the row's code/label/reason — the email
    // still renders with the full layout but with placeholder customer +
    // booking data, so direzione sees what an OTP for THAT code looks like.
    sample = `generic:${body.code}`
    payload = {
      limitationCode: body.code,
      limitationMessage: body.reason || body.label || `OTP per ${body.code}`,
      flowType: 'booking_create',
      actionContext: `preview_${body.code}`,
      details: {
        gate: { 'Motivo OTP': body.reason || `Test OTP — ${body.label || body.code}` },
        customer: { Nome: 'Mario Rossi (cliente di esempio)', Email: 'mario.rossi@example.com', Telefono: '+39 333 1234567' },
        operation: {
          'Tipo operazione': body.label || body.code,
          Veicolo: 'BMW X5 (placeholder)',
          Targa: 'AB123CD',
          'Data appuntamento': '20/05/2026',
          Ora: '10:30',
          'Importo totale': '€ 150,00',
        },
        meta: {
          Operatore: 'davide@dr7.app',
          'Data richiesta': new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
        },
      },
    }
  } else {
    sample = 'paid_wash_modify'
    payload = SAMPLES.paid_wash_modify
  }
  const operatorEmail = authUser!.email || 'operatore@dr7.app'
  const operatorName = (() => {
    const local = operatorEmail.split('@')[0]
    return local.split(/[._-]/).map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ')
  })()

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'RESEND_API_KEY missing' }) }
  }
  const resend = new Resend(apiKey)
  const html = renderEmailHtml(payload, sample, operatorName, operatorEmail, recipient)
  const { error: emailError } = await resend.emails.send({
    from: 'DR7 <info@dr7.app>',
    to: recipient,
    subject: `[ANTEPRIMA OTP] ${operatorName} chiede: ${codeToLabel[payload.limitationCode] || payload.limitationMessage.split('.')[0]} — Codice fittizio ${FAKE_CODE}`,
    html,
  })
  if (emailError) {
    console.error('[send-otp-preview] Email error:', emailError)
    return { statusCode: 500, body: JSON.stringify({ error: 'Resend send failed', details: emailError }) }
  }
  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, sample, recipient, message: `Anteprima OTP "${sample}" inviata a ${recipient}` }),
  }
}
