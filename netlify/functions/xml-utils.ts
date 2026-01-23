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
  items: InvoiceItem[]
  subtotal: number
  vat_amount: number
  exempt_amount?: number
  importo_totale: number
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

    return { street, cap, comune, provincia }
  }

  return { street: address, cap: '09100', comune: 'Cagliari', provincia: 'CA' }
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
 * Generate FatturaPA XML for OpenAPI.it SDI
 */
export function generateFatturaXML(invoice: InvoiceData): string {
  const customerAddress = parseAddress(invoice.customer_address || '')

  // Company details (CedentePrestatore)
  const companyVAT = '04104640927'
  const companyFiscalCode = '04104640927'
  const companyName = 'Dubai rent 7.0 S.p.A.'
  const companyAddress = 'VIA DEL FANGARIO 25'
  const companyCAP = '09122'
  const companyCity = 'CAGLIARI'
  const companyProvince = 'CA'

  // CRITICAL: IdTrasmittente MUST be Aruba's intermediary code
  // Per official Aruba API docs (v1.21.1):
  // "The synchronous check has been introduced for the Sender ID field (tag 1.1.1 <IdTrasmittente>)
  //  which will have to be filled in with the tax code for the intermediary Aruba PEC S.p.A.: 01879020517"
  const transmitterId = '01879020517'

  // Generate progressive transmission ID
  const progressivoInvio = invoice.numero_fattura.replace(/\D/g, '') || '1'

  // Customer details
  const customerVAT = invoice.customer_vat || ''
  const customerFiscalCode = invoice.customer_tax_code || ''
  const customerName = escapeXml(invoice.customer_name)

  let dettaglioLinee = ''
  invoice.items.forEach((item, index) => {
    const lineTotal = item.unit_price * item.quantity
    dettaglioLinee += `
    <DettaglioLinee>
      <NumeroLinea>${index + 1}</NumeroLinea>
      <Descrizione>${escapeXml(item.description)}</Descrizione>
      <Quantita>${formatAmount(item.quantity)}</Quantita>
      <PrezzoUnitario>${formatAmount(item.unit_price)}</PrezzoUnitario>
      <PrezzoTotale>${formatAmount(lineTotal)}</PrezzoTotale>
      <AliquotaIVA>${formatAmount(item.vat_rate)}</AliquotaIVA>
    </DettaglioLinee>`
  })

  // Group items by VAT rate for DatiRiepilogo
  const vatGroups = new Map<number, { imponibile: number, imposta: number }>()

  invoice.items.forEach(item => {
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
  let datiRiepilogo = ''
  vatGroups.forEach((amounts, rate) => {
    datiRiepilogo += `
    <DatiRiepilogo>
      <AliquotaIVA>${formatAmount(rate)}</AliquotaIVA>
      <ImponibileImporto>${formatAmount(amounts.imponibile)}</ImponibileImporto>
      <Imposta>${formatAmount(amounts.imposta)}</Imposta>
    </DatiRiepilogo>`
  })

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
      <CodiceDestinatario>0000000</CodiceDestinatario>
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
      <DatiAnagrafici>
        ${customerVAT ? `<IdFiscaleIVA>
          <IdPaese>IT</IdPaese>
          <IdCodice>${customerVAT}</IdCodice>
        </IdFiscaleIVA>` : ''}
        ${customerFiscalCode && !customerVAT ? `<CodiceFiscale>${customerFiscalCode}</CodiceFiscale>` : ''}
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
    </DatiBeniServizi>
  </FatturaElettronicaBody>
</p:FatturaElettronica>`

  return xml
}

/**
 * Generate standard FatturaPA filename
 * Format: IT + VAT (11 chars) + _ + Progressive (5 chars alphanumeric) + .xml
 * Example: IT04104640927_00001.xml
 */
export function generateInvoiceFilename(invoice: InvoiceData): string {
  const countryCode = 'IT'
  // Hardcoded company VAT or from invoice if dynamic
  const transmitterId = '04104640927'

  // Ensure progressive is at least 5 chars, padded with 0
  // We use the invoice number's numeric part
  const rawNum = invoice.numero_fattura.replace(/\D/g, '') || '0'
  const progressive = rawNum.padStart(5, '0').substring(0, 5) // Max 5 chars for the sequence part usually? 
  // Actually spec allows more, but standard is often IT + 11 digits + _ + 5 chars

  return `${countryCode}${transmitterId}_${progressive}.xml`
}
