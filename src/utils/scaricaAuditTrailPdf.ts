// Scarica Audit Trail: stesso contenuto della pagina stampabile di
// signature-audit (format=html), salvato direttamente come file PDF.

const EVENTI: Record<string, string> = {
  request_created: 'Richiesta Creata',
  email_sent: 'Email Inviata',
  document_viewed: 'Documento Visualizzato',
  otp_sent: 'OTP Inviato',
  otp_verified: 'OTP Verificato',
  otp_failed: 'OTP Non Valido',
  otp_expired: 'OTP Scaduto',
  otp_max_attempts: 'Max Tentativi OTP',
  firma_confermata: 'Firma Confermata (senza OTP)',
  integrity_check_failed: 'Verifica Integrita Fallita',
  document_signed: 'Documento Firmato',
}

// jsPDF con i font standard copre solo il Latin-1.
const pulisci = (v: unknown) =>
  String(v ?? '').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\u0000-ÿ€]/g, '').trim()

const dataOra = (v?: string | null) =>
  v ? new Date(v).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : 'N/A'
const data = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' }) : 'N/A'

/** Scarica l'audit trail come PDF. Chiave: contractId (tab Contratti) o requestId (DR7 Trust). */
export async function scaricaAuditTrailPdf(chiave: { contractId?: string; requestId?: string }, nomeFile: string): Promise<void> {
  const qs = chiave.requestId ? `requestId=${encodeURIComponent(chiave.requestId)}` : `contractId=${encodeURIComponent(chiave.contractId || '')}`
  const res = await fetch(`/.netlify/functions/signature-audit?${qs}`)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Audit trail non disponibile')

  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const c = json.contract || {}
  const firmata = (json.signatureRequests || []).find((r: { status: string }) => r.status === 'signed')
  const trail: Array<{ eventType: string; description?: string; ipAddress?: string; timestamp: string; metadata?: { marketing_consent?: boolean } }> = json.auditTrail || []
  const telefono = json.customerPhone || 'N/A'
  const oro: [number, number, number] = [212, 175, 55]
  let y = 18

  doc.setFont('helvetica', 'bold'); doc.setFontSize(16)
  doc.text('Audit Trail - Firma Elettronica', 15, y); y += 6
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(100)
  doc.text(pulisci(`Contratto ${c.contract_number || 'N/A'} - ${c.customer_name || firmata?.signerName || 'N/A'}`), 15, y); y += 6
  doc.setTextColor(0)

  const sezione = (titolo: string, righe: string[][]) => {
    autoTable(doc, {
      startY: y,
      head: [[{ content: titolo.toUpperCase(), colSpan: 2 }]],
      body: righe.map(r => r.map(pulisci)),
      theme: 'plain',
      styles: { fontSize: 9, cellPadding: 1.5, overflow: 'linebreak' },
      headStyles: { textColor: 100, fontStyle: 'bold', lineWidth: { bottom: 0.6 }, lineColor: oro },
      columnStyles: { 0: { cellWidth: 55, textColor: 110 }, 1: { fontStyle: 'bold' } },
      margin: { left: 15, right: 15 },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5
  }

  if (c.contract_number) {
    sezione('Informazioni Contratto', [
      ['Contratto', c.contract_number || 'N/A'],
      ['Cliente', c.customer_name || 'N/A'],
      ['Email', json.customerEmail || c.customer_email || 'N/A'],
      ['Telefono', telefono],
      ['Veicolo', c.vehicle_name || 'N/A'],
      ['Periodo', `${data(c.rental_start_date)} - ${data(c.rental_end_date)}`],
    ])
  }

  if (firmata) {
    sezione('Informazioni Firmatario', [
      ['Nome e Cognome', firmata.signerName || 'N/A'],
      ['Email', firmata.signerEmail || 'N/A'],
      ['Telefono', telefono],
      ['Data Firma', dataOra(firmata.signedAt)],
      ['IP', firmata.signerIp || 'N/A'],
      ['User Agent', firmata.signerUserAgent || 'N/A'],
    ])
    const evFirma = trail.find(e => e.eventType === 'document_signed')
    const mc = evFirma?.metadata?.marketing_consent
    if (mc !== undefined) {
      sezione('Consenso Marketing (DR7 Trust)', [
        ['Consenso', mc ? 'SI' : 'NO'],
        ['Data', dataOra(evFirma?.timestamp)],
      ])
    }
    sezione('Verifica Integrita', [
      ['Hash SHA-256 Originale', firmata.originalPdfHash || 'N/A'],
      ['Hash SHA-256 Firmato', firmata.signedPdfHash || 'N/A'],
    ])
  }

  autoTable(doc, {
    startY: y,
    head: [['Data/Ora', 'Evento', 'Descrizione', 'IP']],
    body: trail.map(e => [dataOra(e.timestamp), EVENTI[e.eventType] || e.eventType, e.description || '', e.ipAddress || ''].map(pulisci)),
    styles: { fontSize: 8, cellPadding: 1.8, overflow: 'linebreak' },
    headStyles: { fillColor: [245, 245, 245], textColor: 90, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 34 }, 1: { cellWidth: 38, fontStyle: 'bold' }, 3: { cellWidth: 28 } },
    margin: { left: 15, right: 15 },
  })
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10

  const h = doc.internal.pageSize.getHeight()
  if (y > h - 20) { doc.addPage(); y = 20 }
  doc.setFontSize(8); doc.setTextColor(150)
  doc.text('DR7 S.p.A. - Via del Fangario 25, 09122 Cagliari (CA) - P.IVA 04104640927', 105, y, { align: 'center' })
  doc.text(`Documento generato il ${dataOra(new Date().toISOString())}`, 105, y + 4, { align: 'center' })

  doc.save(nomeFile)
}
