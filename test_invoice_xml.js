#!/usr/bin/env node

/**
 * Test invoice submission with XML to sandbox
 * Verify the correct endpoint and format
 */

const SANDBOX_TOKEN = '69567f51a9928bf1e0083a74'
const SANDBOX_BASE_URL = 'https://test.sdi.openapi.it'

// Minimal valid FatturaPA XML
const invoiceXML = `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="FPR12" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <FatturaElettronicaHeader>
    <DatiTrasmissione>
      <IdTrasmittente>
        <IdPaese>IT</IdPaese>
        <IdCodice>04104640927</IdCodice>
      </IdTrasmittente>
      <ProgressivoInvio>1</ProgressivoInvio>
      <FormatoTrasmissione>FPR12</FormatoTrasmissione>
      <CodiceDestinatario>0000000</CodiceDestinatario>
    </DatiTrasmissione>
    <CedentePrestatore>
      <DatiAnagrafici>
        <IdFiscaleIVA>
          <IdPaese>IT</IdPaese>
          <IdCodice>04104640927</IdCodice>
        </IdFiscaleIVA>
        <Anagrafica>
          <Denominazione>DUBAI RENT 7.0 S.P.A.</Denominazione>
        </Anagrafica>
        <RegimeFiscale>RF01</RegimeFiscale>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>VIA DEL FANGARIO 25</Indirizzo>
        <CAP>09122</CAP>
        <Comune>CAGLIARI</Comune>
        <Provincia>CA</Provincia>
        <Nazione>IT</Nazione>
      </Sede>
    </CedentePrestatore>
    <CessionarioCommittente>
      <DatiAnagrafici>
        <CodiceFiscale>RSSMRA80A01H501U</CodiceFiscale>
        <Anagrafica>
          <Denominazione>Mario Rossi</Denominazione>
        </Anagrafica>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>Via Roma 1</Indirizzo>
        <CAP>09100</CAP>
        <Comune>Cagliari</Comune>
        <Provincia>CA</Provincia>
        <Nazione>IT</Nazione>
      </Sede>
    </CessionarioCommittente>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>TD01</TipoDocumento>
        <Divisa>EUR</Divisa>
        <Data>2026-01-01</Data>
        <Numero>TEST-001</Numero>
        <ImportoTotaleDocumento>122.00</ImportoTotaleDocumento>
      </DatiGeneraliDocumento>
    </DatiGenerali>
    <DatiBeniServizi>
      <DettaglioLinee>
        <NumeroLinea>1</NumeroLinea>
        <Descrizione>Test Noleggio Auto</Descrizione>
        <Quantita>1.00</Quantita>
        <PrezzoUnitario>100.00</PrezzoUnitario>
        <PrezzoTotale>100.00</PrezzoTotale>
        <AliquotaIVA>22.00</AliquotaIVA>
      </DettaglioLinee>
      <DatiRiepilogo>
        <AliquotaIVA>22.00</AliquotaIVA>
        <ImponibileImporto>100.00</ImponibileImporto>
        <Imposta>22.00</Imposta>
      </DatiRiepilogo>
    </DatiBeniServizi>
  </FatturaElettronicaBody>
</p:FatturaElettronica>`

async function testInvoiceXML() {
    console.log('🧪 Testing invoice submission with XML format...\n')
    console.log('URL:', `${SANDBOX_BASE_URL}/invoices`)
    console.log('Token:', SANDBOX_TOKEN.substring(0, 15) + '...\n')

    try {
        const response = await fetch(`${SANDBOX_BASE_URL}/invoices`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/xml',
                'Authorization': `Bearer ${SANDBOX_TOKEN}`,
                'Accept': 'application/json'
            },
            body: invoiceXML
        })

        const data = await response.json()

        console.log('📋 Status:', response.status)
        console.log('📋 Response:', JSON.stringify(data, null, 2))

        if (response.ok) {
            console.log('\n✅ Invoice sent successfully!')
            console.log('Invoice UUID:', data.data?.uuid || data.uuid)
        } else {
            console.log('\n❌ Failed')
            console.log('Error code:', data.error)
            console.log('Message:', data.message)

            if (data.error === 131) {
                console.log('\n💡 Error 131 = Method or interface not allowed')
                console.log('This might mean:')
                console.log('- Wrong endpoint for sandbox')
                console.log('- Token doesn\'t have permission')
                console.log('- Need to use different URL structure')
            }
        }

    } catch (error) {
        console.error('\n💥 Error:', error.message)
    }
}

testInvoiceXML()
