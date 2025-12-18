import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ahpmzjgkfxrrgxyirasa.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Helper function to sanitize text for WinAnsi encoding
// Transliterates Cyrillic and other non-Latin characters to Latin equivalents
function sanitizeForPDF(text: string): string {
    if (!text) return ''

    // Cyrillic to Latin transliteration map (for characters that look similar)
    const cyrillicToLatin: Record<string, string> = {
        // Uppercase
        'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O',
        'Р': 'P', 'С': 'C', 'Т': 'T', 'У': 'Y', 'Х': 'X',
        // Lowercase
        'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x',
        // Other common Cyrillic
        'Б': 'B', 'Г': 'G', 'Д': 'D', 'Ж': 'Zh', 'З': 'Z', 'И': 'I', 'Й': 'Y',
        'Л': 'L', 'П': 'P', 'Ф': 'F', 'Ц': 'Ts', 'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Shch',
        'Ы': 'Y', 'Э': 'E', 'Ю': 'Yu', 'Я': 'Ya',
        'б': 'b', 'г': 'g', 'д': 'd', 'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y',
        'л': 'l', 'п': 'p', 'ф': 'f', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
        'ы': 'y', 'э': 'e', 'ю': 'yu', 'я': 'ya',
        'Ё': 'Yo', 'ё': 'yo', 'Ъ': '', 'ъ': '', 'Ь': '', 'ь': ''
    }

    // Replace Cyrillic characters with Latin equivalents
    let result = text
    for (const [cyrillic, latin] of Object.entries(cyrillicToLatin)) {
        result = result.replace(new RegExp(cyrillic, 'g'), latin)
    }

    // Remove any remaining non-WinAnsi characters
    result = result.replace(/[^\x20-\x7E\xA0-\xFF]/g, '')

    // Normalize whitespace
    return result.replace(/\s+/g, ' ').trim()
}

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' }
    }

    try {
        const { bookingId } = JSON.parse(event.body || '{}')

        if (!bookingId) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing bookingId' }) }
        }

        console.log(`[generate-contract] Starting for booking ${bookingId}`)

        // Check environment variables
        if (!supabaseUrl || !supabaseServiceKey) {
            const error = 'Missing Supabase environment variables'
            console.error(`[generate-contract] ${error}`)
            return { statusCode: 500, body: JSON.stringify({ error }) }
        }

        // 1. Fetch Booking Data
        const { data: booking, error: bookingError } = await supabase
            .from('bookings')
            .select('*, booking_details')
            .eq('id', bookingId)
            .single()

        if (bookingError || !booking) {
            const error = `Booking not found: ${bookingError?.message || 'No booking data'}`
            console.error(`[generate-contract] ${error}`)
            return { statusCode: 404, body: JSON.stringify({ error }) }
        }

        // 2. Fetch Customer Data
        // Priority order:
        // 1. booking.booking_details.customer.customerId (admin-created bookings)
        // 2. booking.user_id (website bookings)
        // 3. Fallback to booking data directly if no customer record found
        const customerId = booking.booking_details?.customer?.customerId || booking.user_id
        let customer = null

        console.log(`[generate-contract] Fetching customer. ID: ${customerId}, Email: ${booking.customer_email}`)

        if (customerId) {
            const { data: cData, error: cError } = await supabase.from('customers_extended').select('*').eq('id', customerId).single()
            if (cError) console.error('[generate-contract] Error fetching by ID:', cError)
            if (cData) {
                console.log('[generate-contract] ✅ Found customer by ID:', JSON.stringify(cData))
                customer = cData
            }
        }

        // Fallback: Try by email in customers_extended
        if (!customer && booking.customer_email) {
            console.log('[generate-contract] Fallback: Fetching by email from customers_extended...')
            const { data: cData, error: cError } = await supabase.from('customers_extended').select('*').eq('email', booking.customer_email).single()
            if (cError) console.error('[generate-contract] Error fetching by email (customers_extended):', cError)
            if (cData) {
                console.log('[generate-contract] ✅ Found customer by Email (extended):', JSON.stringify(cData))
                customer = cData
            }
        }

        // Fallback: Try basic customers table
        if (!customer && booking.customer_email) {
            console.log('[generate-contract] Fallback: Fetching by email from basic customers...')
            const { data: cData } = await supabase.from('customers').select('*').eq('email', booking.customer_email).single()
            if (cData) {
                console.log('[generate-contract] ✅ Found customer by Email (basic):', JSON.stringify(cData))
                customer = { ...cData, tipo_cliente: 'persona_fisica', nome: cData.full_name, indirizzo: cData.notes }
            }
        }

        // Final fallback: Use booking data directly if no customer record exists
        if (!customer) {
            console.warn('[generate-contract] ⚠️ No customer record found in database. Using booking data as fallback.')
            // Construct a minimal customer object from booking data
            customer = {
                tipo_cliente: 'persona_fisica',
                nome: booking.customer_name || '',
                cognome: '',
                email: booking.customer_email || '',
                telefono: booking.customer_phone || '',
                indirizzo: booking.booking_details?.customer?.address || '',
                codice_fiscale: booking.booking_details?.customer?.taxCode || '',
                patente: booking.booking_details?.customer?.driverLicense || '',
                // Additional fields from booking_details if available
                data_nascita: booking.booking_details?.customer?.birthDate || null,
                luogo_nascita: booking.booking_details?.customer?.birthPlace || null,
                citta_residenza: booking.booking_details?.customer?.city || null,
                provincia_residenza: booking.booking_details?.customer?.province || null,
                codice_postale: booking.booking_details?.customer?.zipCode || null,
            }
            console.log('[generate-contract] Using fallback customer data:', JSON.stringify(customer))
        }

        // 2b. Fetch Vehicle Data (to get plate and other details if missing in booking)
        let vehicleData = null
        if (booking.vehicle_name) {
            const { data: vData } = await supabase.from('vehicles').select('*').eq('display_name', booking.vehicle_name).maybeSingle()
            vehicleData = vData
        }

        // 3. Prepare Data
        const clientName = customer?.tipo_cliente === 'azienda' ? customer.denominazione : await (async () => {
            return customer?.nome ? `${customer.nome} ${customer.cognome}` : booking.customer_name
        })()
        const clientAddress = customer?.indirizzo || booking.booking_details?.customer?.address || ''
        const clientVat = customer?.tipo_cliente === 'azienda' ? customer.partita_iva : customer?.codice_fiscale
        const driverLicense = customer?.patente || customer?.driver_license_number || ''

        // Vehicle Data Prep
        const vehicleName = vehicleData?.display_name || booking.vehicle_name || ''
        const vehiclePlate = vehicleData?.plate || booking.vehicle_plate || ''

        // Smart parse vehicle details
        let parsedColor = vehicleData?.metadata?.color || booking.vehicle_color || ''
        let parsedFuel = vehicleData?.metadata?.fuel || booking.vehicle_fuel || ''
        let parsedSeats = vehicleData?.metadata?.seats || booking.booking_details?.vehicle?.seats || ''
        let parsedBrand = vehicleData?.make || ''
        let parsedModel = vehicleData?.model || ''

        // 1. Extract Color if missing
        if (!parsedColor) {
            const colors = ['White', 'Black', 'Blue', 'Red', 'Silver', 'Grey', 'Gray', 'Orange', 'Green', 'Yellow', 'Bianca', 'Nera', 'Blu', 'Rossa', 'Grigia', 'Arancione', 'Verde', 'Gialla', 'Anthracite', 'Beige', 'Gold', 'Oro'];
            for (const color of colors) {
                if (vehicleName.toLowerCase().includes(color.toLowerCase())) {
                    parsedColor = color;
                    break;
                }
            }
        }

        // 2. Extract Brand & Model if missing
        let nameForModel = vehicleName;
        // Remove color from name for cleaner model extraction
        if (parsedColor) {
            const regex = new RegExp(`\\b${parsedColor}\\b`, 'i');
            nameForModel = nameForModel.replace(regex, '').trim().replace(/\s+/g, ' ');
        }

        if (!parsedBrand) {
            parsedBrand = vehicleName.split(' ')[0]; // Assume first word is brand
        }
        if (!parsedModel) {
            const brandRegex = new RegExp(`^${parsedBrand}`, 'i');
            parsedModel = nameForModel.replace(brandRegex, '').trim().replace(/^[-–]\s*/, '');
        }

        // 3. Default Fuel if missing
        if (!parsedFuel) {
            const lowerName = vehicleName.toLowerCase();
            if (lowerName.includes('ducato') || lowerName.includes('vito') || lowerName.includes('scudo') || lowerName.includes('talento') || lowerName.includes('trafic') || lowerName.includes('transit') || lowerName.includes('diesel')) {
                parsedFuel = 'Diesel';
            } else if (lowerName.includes('hybrid') || lowerName.includes('ibrid')) {
                parsedFuel = 'Ibrida';
            } else if (lowerName.includes('electric') || lowerName.includes('elettric')) {
                parsedFuel = 'Elettrica';
            } else {
                parsedFuel = 'Benzina';
            }
        }

        // 4. Default Seats if missing
        if (!parsedSeats) {
            const lowerName = vehicleName.toLowerCase();
            if (lowerName.includes('panda') || lowerName.includes('500') || lowerName.includes('smart') || lowerName.includes('twizy') || lowerName.includes('mx-5') || lowerName.includes('124')) {
                parsedSeats = '4'; // Small cars / roadsters (MX-5 is 2 actually, but let's stick to simple logic or refine)
                if (lowerName.includes('mx-5') || lowerName.includes('124')) parsedSeats = '2';
            } else if (lowerName.includes('ducato') || lowerName.includes('vito') || lowerName.includes('van') || lowerName.includes('scudo')) {
                parsedSeats = '3';
                if (lowerName.includes('9 posti') || lowerName.includes('passenger') || lowerName.includes('combi')) parsedSeats = '9';
            } else {
                parsedSeats = '5'; // Standard
            }
        }


        const pickupDate = new Date(booking.pickup_date)
        const dropoffDate = new Date(booking.dropoff_date)
        const contractNumber = `CNT-${bookingId.substring(0, 8).toUpperCase()}`

        // 4. Fetch Template from Supabase Storage
        // Based on user URL: .../public/templates/master_contract.pdf -> Bucket: 'templates', File: 'master_contract.pdf'
        console.log(`[generate-contract] Fetching template from storage: bucket 'templates', file 'master_contract.pdf'`)

        const { data: templateData, error: templateError } = await supabase.storage
            .from('templates')
            .download('master_contract.pdf')

        if (templateError || !templateData) {
            console.error(`[generate-contract] Template fetch failed:`, templateError)

            // Debug: List files in 'templates' bucket
            const { data: fileList } = await supabase.storage
                .from('templates')
                .list()

            const filesFound = fileList ? fileList.map(f => f.name).join(', ') : 'None'
            console.log(`[generate-contract] Files found in 'templates' bucket: ${filesFound}`)

            return {
                statusCode: 500,
                body: JSON.stringify({
                    error: `Failed to load contract template 'master_contract.pdf' from 'templates' bucket. Files found in bucket: ${filesFound}. Supabase Error: ${templateError?.message}`
                })
            }
        }

        let pdfDoc: PDFDocument
        try {
            const templateBytes = await templateData.arrayBuffer()
            pdfDoc = await PDFDocument.load(templateBytes)
        } catch (loadError) {
            console.error(`[generate-contract] PDF Load failed:`, loadError)
            return { statusCode: 500, body: JSON.stringify({ error: 'Invalid PDF template file.' }) }
        }

        // 5. Fill Data
        const form = pdfDoc.getForm()

        // --- DEBUGGING: LOG ALL AVAILABLE FIELDS IN PDF ---
        console.log('--- [DEBUG] PDF FORM FIELDS FOUND ---')
        try {
            const fields = form.getFields()
            const fieldNames = fields.map(f => f.getName())
            console.log('Total fields found:', fieldNames.length)
            console.log('Field Names List:', JSON.stringify(fieldNames, null, 2))
        } catch (err) {
            console.error('Error logging fields:', err)
        }
        // --------------------------------------------------

        // 5a. Generate Dynamic Insurance Responsibility Text based on Vehicle Category
        const vehicleCategory = vehicleData?.category || 'standard'
        let insuranceResponsibilityText = ''

        if (vehicleCategory === 'supercar' || vehicleCategory === 'luxury') {
            insuranceResponsibilityText = `RESPONSABILITÀ PENALE DEI CLIENTI - SUPERCAR:

Copertura assicurativa RCA (BASE): Paga qualsiasi danno subito al 100% del valore. Furto (solo in caso di restituzione chiave) - incendio - distruzione totale: da risarcire il 100% del valore del veicolo.

KASKO: RCA - Furto (solo in caso di restituzione chiave, altrimenti paga il 100% del valore del veicolo) - atti vandalici - agenti atmosferici - incendio - danni & distruzione totale: da risarcire €5.000 + 30% del danno.

KASKO BLACK: RCA - Furto (solo in caso di restituzione chiave, altrimenti paga il 100% del valore del veicolo) - atti vandalici - agenti atmosferici - incendio - danni & distruzione totale: da risarcire €5.000 + 10% del danno.

KASKO SIGNATURE: RCA - Furto (solo in caso di restituzione chiave, altrimenti paga il 100% del valore del veicolo) - atti vandalici - agenti atmosferici - incendio - danni & distruzione totale: da risarcire €5.000.

LA KASKO NON È ATTIVABILE SE AL MOMENTO DEL DANNO IL CLIENTE ERA SOTTO EFFETTO DI STUPEFACENTI O IN STATO DI EBREZZA.`
        } else if (vehicleCategory === 'urban' || vehicleCategory === 'economy') {
            insuranceResponsibilityText = `RESPONSABILITÀ PENALE DEI CLIENTI - UTILITARIE E AZIENDALI:

Copertura assicurativa RCA (BASE): Paga qualsiasi danno subito al 100% del valore. Furto (solo in caso di restituzione chiave) - incendio - distruzione totale: da risarcire il 100% del valore del veicolo.

Copertura assicurativa KASKO: RCA - Furto (solo in caso di restituzione chiave, altrimenti paga il 100% del valore del veicolo) - atti vandalici - agenti atmosferici - incendio - distruzione totale: da risarcire €2.000 + 30% del valore del danno è attivabile per qualsiasi danno recato alla vettura anche con oggetti non identificabili per mezzo di targa, previo preventivo in officina ufficiale.

LA KASKO NON È ATTIVABILE SE AL MOMENTO DEL DANNO IL CLIENTE ERA SOTTO EFFETTO DI STUPEFACENTI O IN STATO DI EBREZZA.`
        } else {
            // Default for standard vehicles
            insuranceResponsibilityText = `RESPONSABILITÀ PENALE DEI CLIENTI - VEICOLI STANDARD:

Il locatario è pienamente responsabile del veicolo durante il periodo di noleggio e si impegna a:

1. UTILIZZO DEL VEICOLO: Utilizzare il veicolo con cura e diligenza, rispettando tutte le norme del codice della strada.

2. DANNI E FRANCHIGIE:
   - Senza Kasko: Franchigia di €2.000 per danni alla carrozzeria
   - Con Kasko: Franchigia ridotta a €750
   - Il cliente è responsabile del pagamento della franchigia in caso di danni

3. FURTO E INCENDIO:
   - Senza Kasko: Franchigia di €5.000
   - Con Kasko: Franchigia ridotta a €1.500
   - Obbligo di denuncia immediata alle autorità competenti

4. PENALITÀ:
   - Ritardo nella riconsegna: €100 per ogni ora
   - Pulizia straordinaria: €150
   - Rifornimento mancante: €4/litro + €40 servizio
   - Guida non autorizzata: €1.500 + risoluzione immediata del contratto
   - Violazione limiti velocità: Multa + €150 penale
   - Mancata restituzione chiavi/documenti: €300 per elemento

5. RESPONSABILITÀ: Il cliente è responsabile di tutti i danni fino al massimale della franchigia. Eventuali danni superiori saranno a carico del cliente.`
        }

        console.log(`[generate-contract] Using insurance responsibility text for category: ${vehicleCategory}`)

        // 5b. Generate Additional Penalty/Legal Terms (for second large text area)
        let additionalTermsText = ''

        if (vehicleCategory === 'supercar' || vehicleCategory === 'luxury') {
            additionalTermsText = `PENALI - SUPERCAR:

Penale fermo del veicolo in caso di incidente o danni 350,00€ al giorno.

Penale per chi fuma dentro l'auto: minima 200€ senza danni solo con odore o residui di cenere, massima di 1500,00€ se oltre all'odore e cenere l'auto presenta danni alla tappezzeria o altro riconducibili ad una sigaretta, costi per la riparazione sempre a carico del cliente.

Penale per guidatore non citato nel contratto 1000,00€ possono guidare solo le persone citate nel contratto.

Penale per benzina mancante pari a 40,00€ x tacca.

Penale per danni a tappezzeria, sedili o interni dell'auto 1000,00€ + costo della riparazione a carico del cliente + fermo del veicolo a carico del cliente.

L'utilizzo della bomboletta sigillante 'gonfia e ripara' in dotazione comporta l'addebito di una penale di €100,00 per pneumatico, salvo maggior danno.

Penale per veicolo riportato in condizioni pessime con sporco su interni (terra/sabbia/ghiaia o altro) o immondizia lasciata in giro nell'auto (esempio tasche delle portiere, vano portaoggetti, vano poggiagomito, tasche dei sedili, tappezzeria, bagagliaio) 30,00€, igienizzazione 100,00€.

Non sono tollerati cani o pelo di cane dentro l'auto: penale 100€.

Penale per chi disattiva completamente i controlli elettronici dell'auto 500,00€.

Per quanto concerne a Multe o sanzioni sono a carico del cliente al 100%.

L'intestatario del contratto dovrà essere presente al momento della consegna e del ritiro dell'auto (in caso di consegna e ritiro a domicilio) penale di 500,00€ + eventuali costi aggiuntivi per ulteriore fermi o per ritardi.

In caso di utilizzo del veicolo su pista o in contesti assimilabili a competizioni, verrà applicata una penale di €5.000, oltre al risarcimento di eventuali danni totali in quanto la kasko non è attivabile.

Dopo 10 minuti di ritardo al check-out scatta la penale minima di 50€ e aumenta di 0,50€ per minuto di ritardo.

Il veicolo non può in alcun modo essere guidato da soggetti neopatentati o comunque non abilitati secondo le restrizioni dell'art. 117 CdS. In caso di violazione, il Cliente risponde integralmente di ogni sanzione, fermo amministrativo e danno derivante.

In caso di Subnoleggio non autorizzato la penale è di €10.000.

Al momento del ritiro dell'auto il cliente deve avere con sé la patente fisica ed è obbligato a consegnarla all'operatore che consegna la vettura.

Non sono accettate denunce di smarrimento della patente. In caso di impossibilità a mostrare la patente fisica al momento del ritiro, il cliente perde la prenotazione e l'importo pagato.`
        } else if (vehicleCategory === 'urban' || vehicleCategory === 'economy') {
            additionalTermsText = `PENALI - UTILITARIE E AZIENDALI:

Penale fermo del veicolo in caso di incidente o danni 40,00€ al giorno.

Penale per chi fuma dentro l'auto: minima 200€ senza danni solo con odore o residui di cenere, massima di 1500,00€ se oltre all'odore e cenere l'auto presenta danni alla tappezzeria o altro riconducibili ad una sigaretta, costi per la riparazione sempre a carico del cliente.

Penale per guidatore non citato nel contratto 500,00€ possono guidare solo le persone citate nel contratto.

Penale per benzina mancante pari a 25,00€ x tacca.

Penale per danni a tappezzeria, sedili o interni dell'auto 1000,00€ + costo della riparazione a carico del cliente + fermo del veicolo a carico del cliente.

L'utilizzo della bomboletta sigillante 'gonfia e ripara' in dotazione comporta l'addebito di una penale di €100,00 per pneumatico, salvo maggior danno.

Penale per veicolo riportato in condizioni pessime con sporco su interni (terra/sabbia/ghiaia o altro) o immondizia lasciata in giro nell'auto (esempio tasche delle portiere, vano portaoggetti, vano poggiagomito, tasche dei sedili, tappezzeria, bagagliaio) 30,00€, igienizzazione 100,00€.

Penale per chi disattiva completamente i controlli elettronici dell'auto 500,00€.

Per quanto concerne a Multe o sanzioni sono a carico del cliente al 100%.

L'intestatario del contratto dovrà essere presente al momento della consegna e del ritiro dell'auto (in caso di consegna e ritiro a domicilio) penale di 500,00€ + eventuali costi aggiuntivi per ulteriore fermi o per ritardi da parte dell'intestatario del contratto.

Dopo 10 minuti di ritardo al check-out scatta la penale minima di 20€ e aumenta di 0,50€ per minuto di ritardo.

Il veicolo non può in alcun modo essere guidato da soggetti neopatentati o comunque non abilitati secondo le restrizioni dell'art. 117 CdS. In caso di violazione, il Cliente risponde integralmente di ogni sanzione, fermo amministrativo e danno derivante.

Non sono tollerati cani o pelo di cane dentro l'auto: penale 100€.

In caso di Subnoleggio non autorizzato la penale è di €10.000.

Non sono accettate denunce di smarrimento della patente. In caso di impossibilità a mostrare la patente fisica al momento del ritiro, il cliente perde la prenotazione e l'importo pagato.`
        } else {
            // Default for standard vehicles
            additionalTermsText = `CONDIZIONI AGGIUNTIVE - VEICOLI STANDARD:

OBBLIGHI DEL LOCATARIO:
- Riconsegnare il veicolo nelle stesse condizioni in cui è stato ritirato
- Effettuare il pieno di carburante prima della riconsegna
- Rispettare i limiti di velocità e le norme del codice della strada
- Non fumare all'interno del veicolo
- Non trasportare animali senza autorizzazione scritta

LIMITAZIONI D'USO:
- Vietato l'uso per competizioni o gare
- Vietato il traino di rimorchi senza autorizzazione
- Vietato il subaffitto o la cessione a terzi
- Numero massimo di conducenti: 2 (titolare + eventuale secondo guidatore autorizzato)

DEPOSITO CAUZIONALE:
- Deposito richiesto: €1.000 (senza Kasko) / €500 (con Kasko)
- Restituito entro 7 giorni dalla riconsegna se nessun danno
- Trattenuto in caso di danni, multe o violazioni

ASSICURAZIONE:
Il veicolo è coperto da assicurazione RCA. Il cliente è responsabile per tutti i danni fino alla franchigia indicata. La sottoscrizione della Kasko riduce la franchigia.`
        }

        console.log(`[generate-contract] Using additional terms for category: ${vehicleCategory}`)

        // Standardized Data Field Map
        // We map to BOTH potential English and Italian field names to be safe, as we don't see the PDF structure directly.
        // The loop below will try to set each key; if the field doesn't exist in the PDF, it will just skip it.
        // vehicleModel is now calculated earlier as parsedModel

        const dataMap = {
            // Contract Info
            'ContractNumber': contractNumber,
            'NumeroContratto': contractNumber,
            'Date': new Date().toLocaleDateString('it-IT'),
            'Data': new Date().toLocaleDateString('it-IT'),
            'PlaceOfIssue': 'Cagliari',
            'LuogoStipula': 'Cagliari',
            'TimeOfIssue': new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false }),
            'OrarioStipula': new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false }),

            // Customer Info
            'CustomerName': clientName || '',
            'NomeCognome': clientName || '',
            'CustomerVAT': clientVat || '',
            'CodiceFiscale': clientVat || '',
            'PartitaIVA': clientVat || '',
            'CustomerPhone': booking.customer_phone || '',
            'Telefono': booking.customer_phone || '',
            'CustomerEmail': booking.customer_email || '',
            'Email': booking.customer_email || '',
            'CustomerAddress': clientAddress || '',
            'Indirizzo': clientAddress || '',
            'CustomerCity': customer?.citta_residenza || '',
            'Citta': customer?.citta_residenza || '',
            'CustomerProvince': customer?.provincia_residenza || '',
            'Provincia': customer?.provincia_residenza || '',
            'CustomerZipCode': customer?.codice_postale || '',
            'CAP': customer?.codice_postale || '',
            'DriverZipCode': customer?.codice_postale || '',

            // Personal Details (New)
            'CustomerBirthDate': customer?.data_nascita ? new Date(customer.data_nascita).toLocaleDateString('it-IT') : '',
            'DataNascita': customer?.data_nascita ? new Date(customer.data_nascita).toLocaleDateString('it-IT') : '',
            'CustomerBirthPlace': customer?.luogo_nascita || '',
            'LuogoNascita': customer?.luogo_nascita || '',
            'CittaNascita': customer?.luogo_nascita || '', // Variance
            'CustomerBirthProvince': customer?.provincia_nascita || '',
            'ProvinciaNascita': customer?.provincia_nascita || '',
            'CustomerSex': customer?.sesso || customer?.metadata?.sesso || '',
            'Sesso': customer?.sesso || customer?.metadata?.sesso || '',
            'DriverSex': customer?.sesso || customer?.metadata?.sesso || '',

            // License Details
            'DriverLicense': customer?.numero_patente || driverLicense || '',
            'NumeroPatente': customer?.numero_patente || driverLicense || '',
            'DriverLicenseType': customer?.tipo_patente || customer?.metadata?.patente?.tipo || 'B',
            'TipoPatente': customer?.tipo_patente || customer?.metadata?.patente?.tipo || 'B',
            'DriverLicenseIssuedBy': customer?.emessa_da || customer?.metadata?.patente?.ente || '',
            'PatenteEmessaDa': customer?.emessa_da || customer?.metadata?.patente?.ente || '',
            'EmessaDa': customer?.emessa_da || customer?.metadata?.patente?.ente || '',
            'DriverLicenseIssueDate': customer?.data_rilascio_patente ? new Date(customer.data_rilascio_patente).toLocaleDateString('it-IT') : (customer?.metadata?.patente?.rilascio || ''),
            'DataRilascioPatente': customer?.data_rilascio_patente ? new Date(customer.data_rilascio_patente).toLocaleDateString('it-IT') : (customer?.metadata?.patente?.rilascio || ''),
            'DataRilascio': customer?.data_rilascio_patente ? new Date(customer.data_rilascio_patente).toLocaleDateString('it-IT') : (customer?.metadata?.patente?.rilascio || ''),
            'DriverLicenseExpiryDate': customer?.scadenza_patente ? new Date(customer.scadenza_patente).toLocaleDateString('it-IT') : (customer?.metadata?.patente?.scadenza || ''),
            'DataScadenzaPatente': customer?.scadenza_patente ? new Date(customer.scadenza_patente).toLocaleDateString('it-IT') : (customer?.metadata?.patente?.scadenza || ''),
            'ScadenzaPatente': customer?.scadenza_patente ? new Date(customer.scadenza_patente).toLocaleDateString('it-IT') : (customer?.metadata?.patente?.scadenza || ''),
            'Scadenza': customer?.scadenza_patente ? new Date(customer.scadenza_patente).toLocaleDateString('it-IT') : (customer?.metadata?.patente?.scadenza || ''),

            // Vehicle Fields
            'VehicleBrand': parsedBrand,
            'Marca': parsedBrand,
            'VehicleModel': parsedModel,
            'Modello': parsedModel,
            'VehiclePlate': vehiclePlate,
            'Targa': vehiclePlate,
            'VehicleColor': parsedColor,
            'Colore': parsedColor,
            'VehicleFuel': parsedFuel,
            'Alimentazione': parsedFuel,
            'VehicleSeats': parsedSeats,
            'Posti': parsedSeats,
            'VehicleFuelLevel': '',
            'LivelloCarburante': '',
            'VehicleKMRange': '',
            'KMRange': '',
            'KMOverageFee': booking.km_overage_fee ? `€${(booking.km_overage_fee).toFixed(2)}` : '',
            'SforoPerKM': booking.km_overage_fee ? `€${(booking.km_overage_fee).toFixed(2)}` : '',


            // Rental Specifics
            'PickupLocation': booking.pickup_location || 'Viale Marconi 229, Cagliari, CA, 09100',
            'SedeRitiro': booking.pickup_location || 'Viale Marconi 229, Cagliari, CA, 09100',
            'DropoffLocation': booking.dropoff_location || 'Viale Marconi 229, Cagliari, CA, 09100',
            'SedeRiconsegna': booking.dropoff_location || 'Viale Marconi 229, Cagliari, CA, 09100',
            'PickupDate': pickupDate.toLocaleDateString('it-IT'),
            'DataInizio': pickupDate.toLocaleDateString('it-IT'),
            'PickupTime': pickupDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false }),
            'OraInizio': pickupDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false }),
            'DropoffDate': dropoffDate.toLocaleDateString('it-IT'),
            'DataFine': dropoffDate.toLocaleDateString('it-IT'),
            'DropoffTime': dropoffDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false }),
            'OraFine': dropoffDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false }),
            'TotalDays': Math.ceil((dropoffDate.getTime() - pickupDate.getTime()) / (1000 * 60 * 60 * 24)).toString(),
            'Giorni': Math.ceil((dropoffDate.getTime() - pickupDate.getTime()) / (1000 * 60 * 60 * 24)).toString(),
            'TotalHours': Math.ceil((dropoffDate.getTime() - pickupDate.getTime()) / (1000 * 60 * 60)).toString(),
            'Ore': Math.ceil((dropoffDate.getTime() - pickupDate.getTime()) / (1000 * 60 * 60)).toString(),

            // Insurance and Financial
            'Insurance': booking.booking_details?.insurance || booking.booking_details?.kasko || 'RCA Base',
            'Assicurazione': booking.booking_details?.insurance || booking.booking_details?.kasko || 'RCA Base',
            'Deposit': booking.booking_details?.deposit || booking.booking_details?.cauzione || '0',
            'Cauzione': booking.booking_details?.deposit || booking.booking_details?.cauzione || '0',
            'TotalKM': booking.booking_details?.total_km || booking.booking_details?.km_limit || 'Illimitati',
            'KMTotaliNoleggio': booking.booking_details?.total_km || booking.booking_details?.km_limit || 'Illimitati',

            // Second Driver Fields (Only if second driver exists)
            'SecondDriverName': (booking.booking_details?.second_driver?.name && booking.booking_details?.second_driver?.surname)
                ? `${booking.booking_details.second_driver.name} ${booking.booking_details.second_driver.surname}`
                : '',
            'SecondoGuidatore': (booking.booking_details?.second_driver?.name && booking.booking_details?.second_driver?.surname)
                ? `${booking.booking_details.second_driver.name} ${booking.booking_details.second_driver.surname}`
                : '',
            'SecondDriverBirthDate': (booking.booking_details?.second_driver?.birth_date && booking.booking_details?.second_driver?.name)
                ? new Date(booking.booking_details.second_driver.birth_date).toLocaleDateString('it-IT')
                : '',
            'SecondDriverStatsCode': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.tax_code || '') : '',
            'SecondDriverCity': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.city || '') : '',
            'SecondDriverProvince': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.province || '') : '',
            'SecondDriverGender': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.gender || '') : '',
            'SecondDriverLicenseType': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.license_type || '') : '',
            'SecondDriverLicenseNumber': (booking.booking_details?.second_driver?.license_number && booking.booking_details?.second_driver?.name)
                ? booking.booking_details.second_driver.license_number
                : '',
            'SecondDriverLicenseIssuedBy': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.license_issued_by || '') : '',
            'SecondDriverLicenseIssueDate': (booking.booking_details?.second_driver?.license_issue_date && booking.booking_details?.second_driver?.name)
                ? new Date(booking.booking_details.second_driver.license_issue_date).toLocaleDateString('it-IT')
                : '',
            'SecondDriverLicenseExpiryDate': (booking.booking_details?.second_driver?.license_expiry_date && booking.booking_details?.second_driver?.name)
                ? new Date(booking.booking_details.second_driver.license_expiry_date).toLocaleDateString('it-IT')
                : '',
            'SecondDriverVAT': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.tax_code || '') : '',
            'SecondDriverSex': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.gender || '') : '',
            'SecondDriverAddress': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.address || '') : '',
            'SecondDriverZipCode': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.zip_code || '') : '',
            'SecondDriverBirthPlace': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.birth_city || '') : '',
            'SecondDriverBirthProvince': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.birth_province || '') : '',
            'SecondDriverPhone': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.phone || '') : '',
            'SecondDriverEmail': (booking.booking_details?.second_driver?.name) ? (booking.booking_details?.second_driver?.email || '') : '',

            // Company Data (for business clients)
            'CompanyName': customer?.tipo_cliente === 'azienda' ? customer.denominazione : '',
            'CompanyEmail': customer?.tipo_cliente === 'azienda' ? customer.email : '',
            'CompanyAddress': customer?.tipo_cliente === 'azienda' ? customer.indirizzo : '',
            'CompanyPhone': customer?.tipo_cliente === 'azienda' ? customer.telefono : '',
            'CompanyVAT': customer?.tipo_cliente === 'azienda' ? customer.partita_iva : '',
            'CompanyFiscalCode': customer?.tipo_cliente === 'azienda' ? customer.codice_fiscale : '',
            'CompanyRepresentativeName': customer?.tipo_cliente === 'azienda' ? customer.rappresentante_legale : '',
            'CompanyRepresentativeID': customer?.metadata?.rappresentante?.tipo_documento || '',
            'CompanyRepresentativeIDNumber': customer?.metadata?.rappresentante?.numero_documento || '',
            'CompanyRepresentativeIDIssueDate': customer?.metadata?.rappresentante?.data_rilascio || '',
            'CompanyRepresentativeIDIssuePlace': customer?.metadata?.rappresentante?.luogo_rilascio || '',
            // Combined fields for single text boxes
            'CompanyRepresentativeDocCombined': `${customer?.metadata?.rappresentante?.tipo_documento || ''} ${customer?.metadata?.rappresentante?.numero_documento || ''}`.trim(),
            'CompanyRepresentativeIssueCombined': `${customer?.metadata?.rappresentante?.data_rilascio || ''} ${customer?.metadata?.rappresentante?.luogo_rilascio ? '- ' + customer.metadata.rappresentante.luogo_rilascio : ''}`.trim(),

            // Penalty Clause (Dynamic based on vehicle category)
            'PenaltyClause': insuranceResponsibilityText,

            // Additional Terms/Penalties (Second large text area)
            'AdditionalTerms': additionalTermsText,
        }

        let filledFields = 0
        for (const [key, value] of Object.entries(dataMap)) {
            try {
                // Try to find exact match
                let field = form.getTextField(key)
                if (!field) {
                    // Start of fuzzy fix: try to find field by checking containment if exact match fail? 
                    // No, for now let's rely on the explicit map above.
                }

                if (field) {
                    // Sanitize the value to prevent WinAnsi encoding errors
                    const sanitizedValue = sanitizeForPDF(value)
                    field.setText(sanitizedValue)
                    filledFields++

                    // Log if we had to sanitize (value changed)
                    if (sanitizedValue !== value && value) {
                        console.log(`[generate-contract] Sanitized field '${key}': "${value}" -> "${sanitizedValue}"`)
                    }
                }
            } catch (e) {
                // Field matches might fail if types differ (e.g. checkbox vs text), ignore
                console.error(`[generate-contract] Error setting field '${key}':`, e)
            }
        }

        console.log(`[generate-contract] Filled ${filledFields} fields.`)

        // If no fields were filled, it means field names didn't match or there are no fields.
        if (filledFields === 0) {
            const page = pdfDoc.getPages()[0]
            const { height } = page.getSize()
            const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
            const red = rgb(1, 0, 0)

            const availableFields = form.getFields().map(f => f.getName()).join(', ') || 'None (The PDF has no form fields)'

            page.drawText(sanitizeForPDF(`ERROR: No data filled. Check your PDF form field names.`), { x: 50, y: height - 50, size: 12, font, color: red })
            page.drawText(sanitizeForPDF(`Found fields in PDF: ${availableFields}`), { x: 50, y: height - 70, size: 10, font, color: red })
            page.drawText(sanitizeForPDF(`Expected fields: ${Object.keys(dataMap).join(', ')}`), { x: 50, y: height - 90, size: 8, font, color: red })
        } else {
            // Flatten if we filled fields
            try { form.flatten() } catch (e) { }
        }

        // 6. Save and Upload
        const pdfBytes = await pdfDoc.save()
        // Save to 'filled' folder to keep things organized
        const fileName = `filled/contratto_${bookingId}_${Date.now()}.pdf`

        console.log(`[generate-contract] Uploading filled PDF to storage: ${fileName}`)

        const { error: uploadError } = await supabase.storage
            .from('contracts')
            .upload(fileName, pdfBytes, { contentType: 'application/pdf', upsert: true })

        if (uploadError) {
            const error = `Storage upload failed: ${uploadError.message}`
            console.error(`[generate-contract] ${error}`)
            return { statusCode: 500, body: JSON.stringify({ error }) }
        }

        // 7. Get Public URL
        const { data: { publicUrl } } = supabase.storage
            .from('contracts')
            .getPublicUrl(fileName)

        // 8. Save/Update Contracts Table
        const { error: dbError } = await supabase
            .from('contracts')
            .upsert({
                booking_id: bookingId,
                contract_number: contractNumber,
                contract_date: new Date().toISOString().split('T')[0],
                customer_name: clientName,
                customer_email: booking.customer_email || customer?.email,
                customer_phone: booking.customer_phone || customer?.telefono,
                customer_address: clientAddress,
                customer_tax_code: clientVat,
                customer_license_number: driverLicense,
                vehicle_name: vehicleName,
                rental_start_date: pickupDate.toISOString().split('T')[0],
                rental_end_date: dropoffDate.toISOString().split('T')[0],
                daily_rate: 0, // We rely on total amount mostly
                total_days: Math.ceil((dropoffDate.getTime() - pickupDate.getTime()) / (1000 * 60 * 60 * 24)),
                total_amount: booking.price_total / 100,
                status: 'active',
                pdf_url: publicUrl
            }, { onConflict: 'booking_id' })

        if (dbError) {
            console.error('[generate-contract] Failed to sync with contracts table:', dbError)
        }

        // 8b. Update Booking with contract URL (optional but good for direct access)
        await supabase
            .from('bookings')
            .update({
                contract_url: publicUrl,
                booking_details: {
                    ...booking.booking_details,
                    contract_generated_at: new Date().toISOString()
                }
            })
            .eq('id', bookingId)

        console.log('[generate-contract] Success:', publicUrl)
        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, url: publicUrl })
        }

    } catch (error: any) {
        console.error('[generate-contract] Unexpected error:', error)
        return { statusCode: 500, body: JSON.stringify({ error: error.message, stack: error.stack }) }
    }
}
