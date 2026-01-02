// Test sending invoice in JSON format to OpenAPI sandbox
// Based on the documentation at https://console.openapi.com/it/apis/sdi/documentation

const SANDBOX_TOKEN = '69567f51a9928bf1e0083a74'
const SANDBOX_BASE_URL = 'https://test.sdi.openapi.it'

// Sample invoice data in JSON format (FatturaPA JSON structure)
const invoiceJSON = {
    fattura_elettronica_header: {
        dati_trasmissione: {
            codice_destinatario: "0000000" // Generic code for B2C
        },
        cedente_prestatore: {
            dati_anagrafici: {
                id_fiscale_iva: {
                    id_paese: "IT",
                    id_codice: "04104640927"
                },
                anagrafica: {
                    denominazione: "DUBAI RENT 7.0 S.P.A."
                },
                regime_fiscale: "RF01"
            },
            sede: {
                indirizzo: "VIA DEL FANGARIO 25",
                cap: "09122",
                comune: "CAGLIARI",
                provincia: "CA",
                nazione: "IT"
            }
        },
        cessionario_committente: {
            dati_anagrafici: {
                codice_fiscale: "RSSMRA80A01H501U", // Example tax code
                anagrafica: {
                    denominazione: "Mario Rossi"
                }
            },
            sede: {
                indirizzo: "Via Roma 1",
                cap: "09100",
                comune: "Cagliari",
                provincia: "CA",
                nazione: "IT"
            }
        }
    },
    fattura_elettronica_body: [{
        dati_generali: {
            dati_generali_documento: {
                tipo_documento: "TD01",
                divisa: "EUR",
                data: "2026-01-01",
                numero: "TEST-001"
            }
        },
        dati_beni_servizi: {
            dettaglio_linee: [{
                numero_linea: 1,
                descrizione: "Test Noleggio Auto",
                quantita: "1.00",
                prezzo_unitario: "100.00",
                prezzo_totale: "100.00",
                aliquota_iva: "22.00"
            }],
            dati_riepilogo: [{
                aliquota_iva: "22.00",
                imponibile_importo: "100.00",
                imposta: "22.00"
            }]
        }
    }]
}

async function testInvoiceJSON() {
    console.log('🧪 Testing invoice submission with JSON format...\n')

    try {
        const response = await fetch(`${SANDBOX_BASE_URL}/invoices`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SANDBOX_TOKEN}`,
                'Accept': 'application/json'
            },
            body: JSON.stringify(invoiceJSON)
        })

        const data = await response.json()

        console.log('Status:', response.status)
        console.log('Response:', JSON.stringify(data, null, 2))

        if (response.ok) {
            console.log('\n✅ Invoice sent successfully!')
        } else {
            console.log('\n❌ Failed:', data.message || data.error)
        }

    } catch (error) {
        console.error('Error:', error.message)
    }
}

testInvoiceJSON()
