/**
 * Utility functions for generating FatturaPA XML format for Italian e-invoicing
 * Compliant with FatturaPA 1.2 specification
 */

interface InvoiceData {
  numero_fattura: string
  data_emissione: string
  customer_name: string
  customer_address: string
  customer_tax_code?: string
  customer_vat?: string
  customer_sdi_code?: string
  customer_pec?: string
  items: InvoiceItem[]
  subtotal: number
  vat_amount: number
  exempt_amount?: number
  importo_totale: number
  stato?: string
}

interface InvoiceItem {
  description: string
  unit_price: number
  quantity: number
  vat_rate: number
}

interface AddressParts {
  street: string
  cap: string
  comune: string
  provincia: string
}

/**
 * Parse address string into components
 * Expected format: "Via Roma 123, 09100 Cagliari (CA)"
 */
function parseAddress(address: string): AddressParts {
  const parts = address.split(',').map(p => p.trim())

  if (parts.length >= 2) {
    const street = parts[0]
    const cityPart = parts[1]

    const capMatch = cityPart.match(/\b(\d{5})\b/)
    const cap = capMatch ? capMatch[1] : '09100'

    const provinciaMatch = cityPart.match(/\(([A-Z]{2})\)/)
    const provincia = provinciaMatch ? provinciaMatch[1] : 'CA'

    let comune = cityPart
      .replace(cap, '')
      .replace(`(${provincia})`, '')
      .trim()

    return { street, cap, comune: comune || 'Cagliari', provincia }
  }

  return { street: address || 'N/A', cap: '09100', comune: 'Cagliari', provincia: 'CA' }
}

/**
 * Escape XML special characters
 */
function escapeXml(unsafe: string): string {
  if (!unsafe) return ''
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Format number for XML (2 decimal places)
 */
function formatAmount(amount: number): string {
  return amount.toFixed(2)
}

/**
 * Generate FatturaPA 1.2 compliant XML for Aruba SDI
 */
export function generateFatturaXML(invoice: InvoiceData): string {
  const customerAddress = parseAddress(invoice.customer_address || '')

  // Company details (CedentePrestatore) — Dubai rent 7.0 S.p.A.
  const companyVAT = '04104640927'
  const companyFiscalCode = '04104640927'
  const companyName = 'Dubai rent 7.0 S.p.A.'
  const companyAddress = 'VIA DEL FANGARIO 25'
  const companyCAP = '09122'
  const companyCity = 'CAGLIARI'
  const companyProvince = 'CA'

  // CRITICAL: IdTrasmittente MUST be Aruba's intermediary code
  const transmitterId = '01879020517'

  // Progressive transmission ID (max 10 chars alphanumeric)
  // Add random suffix to prevent Aruba error 0034 on re-upload (content hash dedup)
  const rawNum = invoice.numero_fattura.replace(/\D/g, '') || '1'
  const rndSuffix = Math.random().toString(36).substring(2, 5)
  const progressivoInvio = (rawNum + rndSuffix).substring(0, 10)

  // Customer details
  const customerVAT = invoice.customer_vat || ''
  const customerFiscalCode = invoice.customer_tax_code || ''
  const customerName = escapeXml(invoice.customer_name)

  // CodiceDestinatario: use customer's SDI code or default 0000000
  const codiceDestinatario = invoice.customer_sdi_code || '0000000'

  // Parse items — handle both array and JSON string from DB
  let items: InvoiceItem[] = []
  if (Array.isArray(invoice.items)) {
    items = invoice.items
  } else if (typeof invoice.items === 'string') {
    try { items = JSON.parse(invoice.items) } catch { items = [] }
  }

  // Build DettaglioLinee
  let dettaglioLinee = ''
  items.forEach((item, index) => {
    const lineTotal = item.unit_price * item.quantity
    dettaglioLinee += `
      <DettaglioLinee>
        <NumeroLinea>${index + 1}</NumeroLinea>
        <Descrizione>${escapeXml(item.description)}</Descrizione>
        <Quantita>${formatAmount(item.quantity)}</Quantita>
        <UnitaMisura>NR</UnitaMisura>
        <PrezzoUnitario>${formatAmount(item.unit_price)}</PrezzoUnitario>
        <PrezzoTotale>${formatAmount(lineTotal)}</PrezzoTotale>
        <AliquotaIVA>${formatAmount(item.vat_rate)}</AliquotaIVA>${item.vat_rate === 0 ? `
        <Natura>N2.2</Natura>` : ''}
      </DettaglioLinee>`
  })

  // Group items by VAT rate for DatiRiepilogo
  const vatGroups = new Map<number, { imponibile: number, imposta: number }>()

  items.forEach(item => {
    const lineTotal = item.unit_price * item.quantity
    const vatAmount = lineTotal * (item.vat_rate / 100)

    if (!vatGroups.has(item.vat_rate)) {
      vatGroups.set(item.vat_rate, { imponibile: 0, imposta: 0 })
    }

    const group = vatGroups.get(item.vat_rate)!
    group.imponibile += lineTotal
    group.imposta += vatAmount
  })

  // Generate DatiRiepilogo sections
  // XSD order: AliquotaIVA, Natura, ImponibileImporto, Imposta, EsigibilitaIVA, RiferimentoNormativo
  let datiRiepilogo = ''
  vatGroups.forEach((amounts, rate) => {
    datiRiepilogo += `
      <DatiRiepilogo>
        <AliquotaIVA>${formatAmount(rate)}</AliquotaIVA>${rate === 0 ? `
        <Natura>N2.2</Natura>` : ''}
        <ImponibileImporto>${formatAmount(amounts.imponibile)}</ImponibileImporto>
        <Imposta>${formatAmount(amounts.imposta)}</Imposta>${rate > 0 ? `
        <EsigibilitaIVA>I</EsigibilitaIVA>` : ''}${rate === 0 ? `
        <RiferimentoNormativo>Art. 7 DPR 633/72</RiferimentoNormativo>` : ''}
      </DatiRiepilogo>`
  })

  // Customer identification section
  // Per FatturaPA: IdFiscaleIVA for B2B, CodiceFiscale for individuals
  // If customer has BOTH P.IVA and CF, include both
  let customerIdSection = ''
  if (customerVAT) {
    customerIdSection += `
          <IdFiscaleIVA>
            <IdPaese>IT</IdPaese>
            <IdCodice>${customerVAT}</IdCodice>
          </IdFiscaleIVA>`
  }
  if (customerFiscalCode) {
    customerIdSection += `
          <CodiceFiscale>${customerFiscalCode}</CodiceFiscale>`
  }

  // PECDestinatario: required when CodiceDestinatario is 0000000 and PEC is available
  let pecSection = ''
  if (codiceDestinatario === '0000000' && invoice.customer_pec) {
    pecSection = `
      <PECDestinatario>${escapeXml(invoice.customer_pec)}</PECDestinatario>`
  }

  // DatiPagamento section — always include per FatturaPA best practice
  const datiPagamento = `
    <DatiPagamento>
      <CondizioniPagamento>TP02</CondizioniPagamento>
      <DettaglioPagamento>
        <ModalitaPagamento>MP05</ModalitaPagamento>
        <ImportoPagamento>${formatAmount(invoice.importo_totale)}</ImportoPagamento>
      </DettaglioPagamento>
    </DatiPagamento>`

  // Build complete XML
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="FPR12" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2 http://www.fatturapa.gov.it/export/fatturazione/sdi/fatturapa/v1.2/Schema_del_file_xml_FatturaPA_versione_1.2.xsd">
  <FatturaElettronicaHeader>
    <DatiTrasmissione>
      <IdTrasmittente>
        <IdPaese>IT</IdPaese>
        <IdCodice>${transmitterId}</IdCodice>
      </IdTrasmittente>
      <ProgressivoInvio>${progressivoInvio}</ProgressivoInvio>
      <FormatoTrasmissione>FPR12</FormatoTrasmissione>
      <CodiceDestinatario>${codiceDestinatario}</CodiceDestinatario>${pecSection}
    </DatiTrasmissione>
    <CedentePrestatore>
      <DatiAnagrafici>
        <IdFiscaleIVA>
          <IdPaese>IT</IdPaese>
          <IdCodice>${companyVAT}</IdCodice>
        </IdFiscaleIVA>
        <CodiceFiscale>${companyFiscalCode}</CodiceFiscale>
        <Anagrafica>
          <Denominazione>${companyName}</Denominazione>
        </Anagrafica>
        <RegimeFiscale>RF01</RegimeFiscale>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>${companyAddress}</Indirizzo>
        <CAP>${companyCAP}</CAP>
        <Comune>${companyCity}</Comune>
        <Provincia>${companyProvince}</Provincia>
        <Nazione>IT</Nazione>
      </Sede>
    </CedentePrestatore>
    <CessionarioCommittente>
      <DatiAnagrafici>${customerIdSection}
        <Anagrafica>
          <Denominazione>${customerName}</Denominazione>
        </Anagrafica>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>${escapeXml(customerAddress.street)}</Indirizzo>
        <CAP>${customerAddress.cap}</CAP>
        <Comune>${escapeXml(customerAddress.comune)}</Comune>
        <Provincia>${customerAddress.provincia}</Provincia>
        <Nazione>IT</Nazione>
      </Sede>
    </CessionarioCommittente>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>TD01</TipoDocumento>
        <Divisa>EUR</Divisa>
        <Data>${invoice.data_emissione}</Data>
        <Numero>${escapeXml(invoice.numero_fattura)}</Numero>
        <ImportoTotaleDocumento>${formatAmount(invoice.importo_totale)}</ImportoTotaleDocumento>
      </DatiGeneraliDocumento>
    </DatiGenerali>
    <DatiBeniServizi>${dettaglioLinee}${datiRiepilogo}
    </DatiBeniServizi>${datiPagamento}
  </FatturaElettronicaBody>
</p:FatturaElettronica>`

  return xml
}

/**
 * Generate standard FatturaPA filename
 * Format: IT + VAT (11 chars) + _ + Progressive (max 5 chars alphanumeric) + .xml
 * Example: IT04104640927_00001.xml
 */
export function generateInvoiceFilename(invoice: InvoiceData): string {
  const countryCode = 'IT'
  const companyVAT = '04104640927'

  // Extract sequential number + add random suffix to prevent Aruba error 0034 on re-upload
  const match = invoice.numero_fattura.match(/(\d+)$/)
  const seqNum = match ? match[1] : '1'
  const randomSuffix = Math.random().toString(36).substring(2, 4)
  const progressive = seqNum.padStart(3, '0') + randomSuffix

  return `${countryCode}${companyVAT}_${progressive}.xml`
}
