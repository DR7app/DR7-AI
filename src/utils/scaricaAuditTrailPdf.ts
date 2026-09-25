// Scarica Audit Trail: stesso contenuto della pagina stampabile di
// signature-audit (format=html), salvato direttamente come file PDF.
// 25/09/2026: Security & Signature Audit Trail (modello in
// netlify/functions/utils/firmaSicurezza.ts). La funzione e' riservata allo
// staff, quindi la chiamata porta il token della sessione (authFetch).
import { authFetch } from './authFetch'

type Livello = { voce: string; valore: string }
type Evento = { ora: string | null; dataOra: string | null; codice: string; titolo: string; descrizione: string; clientIp: string | null; deviceLabel: string | null; attenzione: boolean }
type Scheda = {
  statoFirma: string
  revoca: { quando: string | null; da: string | null; motivo: string | null } | null
  firmatario: { nome: string; email: string; telefono: string; dataFirma: string | null; metodo: string | null }
  riepilogo: { stato: 'REGOLARE' | 'ATTENZIONE'; cause: string[] }
  livelli: Livello[]
  sessione: { deviceId: string; nota: string; primaApertura: string; primaAssociazione: string; cambioDispositivo: string; sessioniRilevate: string; ultimaAttivita: string }
  dispositivo: { categoria: string; dispositivo: string; sistemaOperativo: string; browser: string; userAgent: string } | null
  posizione: { stato: string; indirizzoStimato: string | null; indirizzoNota: string; coordinate: string | null; accuratezza: string | null; acquisizione: string | null; oraDispositivo: string | null; secondiPrimaDellaFirma: number | null; fonte: string | null; apertura: string | null }
  ipGeo: string
  rete: { clientIp: string; proxy: string | null; nota: string }
  otp: { stato: string; canale: string | null; destinatario: string | null; oraInvio: string | null; oraVerifica: string | null; codiciInviati: number; tentativiErrati: number }
  integrita: { hashOriginale: string; hashFirmato: string; hashAuditTrail: string; versione: string; fileFirmatoVerificato: string | null; registro: string }
  marketing: { consenso: boolean; quando: string | null } | null
  eventi: Evento[]
  creataIl: string | null
}
type Dati = {
  contratto: { contract_number?: string; customer_name?: string; vehicle_name?: string; rental_start_date?: string; rental_end_date?: string } | null
  documento: string | null
  statoContratto: string
  attive: Scheda[]
  storiche: Scheda[]
}

// jsPDF con i font standard copre solo il Latin-1.
const pulisci = (v: unknown) =>
  String(v ?? '').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/±/g, '+/-').replace(/[^\u0000-ÿ€]/g, '').trim()

const dataOraLocale = (v?: string | null) =>
  v ? new Date(v).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : 'N/A'
const data = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' }) : 'N/A'

/** Scarica l'audit trail come PDF. Chiave: contractId (tab Contratti) o requestId (DR7 Trust). */
export async function scaricaAuditTrailPdf(chiave: { contractId?: string; requestId?: string }, nomeFile: string): Promise<void> {
  const qs = chiave.requestId ? `requestId=${encodeURIComponent(chiave.requestId)}` : `contractId=${encodeURIComponent(chiave.contractId || '')}`
  const res = await authFetch(`/.netlify/functions/signature-audit?${qs}`)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Audit trail non disponibile')
  const dati = json as Dati

  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const oro: [number, number, number] = [212, 175, 55]
  const ambra: [number, number, number] = [180, 83, 9]
  const verde: [number, number, number] = [21, 128, 61]
  const fine = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
  let y = 16

  const c = dati.contratto
  const riferimento = c?.contract_number || dati.documento || 'Documento'
  const attenzione = dati.attive.some(s => s.riepilogo.stato === 'ATTENZIONE')

  doc.setFont('helvetica', 'bold'); doc.setFontSize(18)
  doc.text('DR7', 15, y); y += 6
  doc.setFontSize(10); doc.setTextColor(70)
  doc.text('SECURITY & SIGNATURE AUDIT TRAIL', 15, y); y += 5
  doc.setTextColor(0)

  const sezione = (titolo: string, righe: (string | null | undefined)[][]) => {
    const corpo = righe.filter(r => r[1] !== undefined && r[1] !== null && r[1] !== '').map(r => r.map(pulisci))
    if (!corpo.length) return
    autoTable(doc, {
      startY: y,
      head: [[{ content: titolo.toUpperCase(), colSpan: 2 }]],
      body: corpo,
      theme: 'plain',
      styles: { fontSize: 8.5, cellPadding: 1.3, overflow: 'linebreak' },
      headStyles: { textColor: 90, fontStyle: 'bold', lineWidth: { bottom: 0.6 }, lineColor: oro },
      columnStyles: { 0: { cellWidth: 55, textColor: 110 }, 1: { fontStyle: 'bold' } },
      margin: { left: 15, right: 15 },
    })
    y = fine() + 4
  }

  sezione(c ? 'Contratto' : 'Documento', [
    [c ? 'Contratto' : 'Documento', riferimento],
    ['Stato firma', dati.statoContratto],
    ['Riepilogo sicurezza', attenzione ? 'ATTENZIONE' : 'REGOLARE'],
    ['Cliente', c?.customer_name],
    ['Veicolo', c?.vehicle_name],
    ['Periodo', c?.rental_start_date ? `${data(c.rental_start_date)} - ${data(c.rental_end_date)}` : null],
  ])

  const scheda = (s: Scheda, storica: boolean) => {
    if (y > 250) { doc.addPage(); y = 18 }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(0)
    doc.text(pulisci(`${storica ? 'Richiesta precedente - ' : ''}${s.firmatario.nome} - ${s.statoFirma}`), 15, y); y += 3

    // Riepilogo sicurezza
    autoTable(doc, {
      startY: y,
      head: [[`RIEPILOGO SICUREZZA: ${s.riepilogo.stato}`]],
      body: (s.riepilogo.cause.length ? s.riepilogo.cause : ['Nessun evento di sicurezza rilevato durante la procedura.']).map(x => [pulisci(x)]),
      theme: 'plain',
      styles: { fontSize: 8.5, cellPadding: 1.5 },
      headStyles: { fontStyle: 'bold', textColor: s.riepilogo.stato === 'ATTENZIONE' ? ambra : verde, lineWidth: { bottom: 0.6 }, lineColor: s.riepilogo.stato === 'ATTENZIONE' ? ambra : verde },
      margin: { left: 15, right: 15 },
    })
    y = fine() + 3

    sezione('Livello di verifica', s.livelli.map(l => [l.voce, l.valore]))
    sezione('Firmatario', [
      ['Nome', s.firmatario.nome], ['Email', s.firmatario.email], ['Telefono', s.firmatario.telefono],
      ['Data/Ora firma', s.firmatario.dataFirma || 'Non firmato'], ['Firma apposta con', s.firmatario.metodo],
      ['Link revocato', s.revoca ? `${s.revoca.quando}${s.revoca.da ? ` da ${s.revoca.da}` : ''}${s.revoca.motivo ? ` - ${s.revoca.motivo}` : ''}` : null],
    ])
    sezione('Sessione di firma', [
      ['DR7 Device ID', s.sessione.deviceId], ['', s.sessione.nota],
      ['Prima apertura', s.sessione.primaApertura], ['Prima associazione', s.sessione.primaAssociazione],
      ['Cambio dispositivo', s.sessione.cambioDispositivo], ['Sessioni differenti rilevate', s.sessione.sessioniRilevate],
      ['Ultima attivita\'', s.sessione.ultimaAttivita],
    ])
    if (!storica) {
      sezione('Dispositivo (dati dichiarati dal browser)', s.dispositivo ? [
        ['Categoria', s.dispositivo.categoria], ['Dispositivo', s.dispositivo.dispositivo],
        ['Sistema operativo', s.dispositivo.sistemaOperativo], ['Browser', s.dispositivo.browser],
        ['User-Agent', s.dispositivo.userAgent],
      ] : [['Dispositivo', 'Non disponibile']])
      const p = s.posizione
      sezione('Posizione al momento della firma', [
        ['GPS', p.stato],
        ['Indirizzo stimato', p.coordinate ? p.indirizzoStimato : null],
        ['', p.coordinate ? p.indirizzoNota : null],
        ['Coordinate', p.coordinate], ['Accuratezza', p.accuratezza],
        ['Acquisizione (ora server)', p.acquisizione], ['Ora dichiarata dal dispositivo', p.oraDispositivo],
        ['Acquisita prima della firma', p.secondiPrimaDellaFirma != null ? `${p.secondiPrimaDellaFirma} secondi` : null],
        ['Fonte', p.fonte], ['Posizione all\'apertura', p.apertura],
        ['Localizzazione IP approssimativa', s.ipGeo],
      ])
      sezione('Rete', [['IP client', s.rete.clientIp], ['Infrastruttura / proxy', s.rete.proxy || '-'], ['', s.rete.nota]])
    }
    sezione('Autenticazione', [
      ['OTP', s.otp.stato], ['Canale', s.otp.canale], ['Destinatario', s.otp.destinatario],
      ['Ora invio', s.otp.oraInvio], ['Ora verifica', s.otp.oraVerifica],
      ['Codici inviati', String(s.otp.codiciInviati)], ['Tentativi errati', String(s.otp.tentativiErrati)],
    ])
    if (!storica) {
      sezione('Integrita\'', [
        ['SHA-256 documento originale', s.integrita.hashOriginale],
        ['SHA-256 documento firmato', s.integrita.hashFirmato],
        ['Controllo del file firmato', s.integrita.fileFirmatoVerificato],
        ['SHA-256 audit trail', s.integrita.hashAuditTrail],
        ['Registro eventi', s.integrita.registro],
        ['Versione contratto', s.integrita.versione],
      ])
      if (s.marketing) sezione('Consenso marketing (DR7 Trust)', [['Consenso', s.marketing.consenso ? 'SI' : 'NO'], ['Data', s.marketing.quando]])
    }

    autoTable(doc, {
      startY: y,
      head: [['Ora', 'Evento', 'Descrizione']],
      body: s.eventi.map(e => [
        pulisci(e.dataOra || e.ora),
        pulisci(`${e.titolo}\n${e.codice}`),
        pulisci(`${e.descrizione}${e.clientIp ? `\nIP ${e.clientIp}` : ''}${e.deviceLabel ? ` - ${e.deviceLabel}` : ''}`),
      ]),
      styles: { fontSize: 7.5, cellPadding: 1.6, overflow: 'linebreak' },
      headStyles: { fillColor: [245, 245, 245], textColor: 90, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 36 }, 1: { cellWidth: 42, fontStyle: 'bold' } },
      didParseCell: (d: { section: string; row: { index: number }; cell: { styles: { textColor: unknown } } }) => {
        if (d.section === 'body' && s.eventi[d.row.index]?.attenzione) d.cell.styles.textColor = ambra
      },
      margin: { left: 15, right: 15 },
    })
    y = fine() + 8
  }

  dati.attive.forEach(s => scheda(s, false))
  dati.storiche.forEach(s => scheda(s, true))

  const h = doc.internal.pageSize.getHeight()
  if (y > h - 24) { doc.addPage(); y = 20 }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(150)
  doc.text('Orari: ora ufficiale del server DR7, fuso Europe/Rome. Dal 25/09/2026 ogni evento e\' legato al precedente da un\'impronta SHA-256.', 105, y, { align: 'center' })
  doc.text('DR7 S.p.A. - Via del Fangario 25, 09122 Cagliari (CA) - P.IVA 04104640927', 105, y + 4, { align: 'center' })
  doc.text(`Documento generato il ${dataOraLocale(new Date().toISOString())}`, 105, y + 8, { align: 'center' })

  doc.save(nomeFile)
}
