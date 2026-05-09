import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../../supabaseClient'
import { authFetch } from '../../../utils/authFetch'
import toast from 'react-hot-toast'

interface SystemMessage {
    id: string
    message_key: string
    label: string
    description: string
    message_body: string
    is_automatic: boolean
    is_enabled: boolean
    include_header: boolean
    trigger_event: string
    trigger_offset_hours: number
    send_hour: number | null
    target_category: string
    target_status: string
    /** Se true, dopo il WhatsApp invia anche email (stesso body). */
    send_email?: boolean
    /** Oggetto email; se vuoto, fallback al label del template. */
    email_subject?: string | null
    // Filtri avanzati (migration 20260509_system_messages_more_filters)
    target_service_type?: string  // 'rental'|'car_wash'|'mechanical'|'all'
    target_with_deposit?: string  // 'yes'|'no'|'all'
    target_plate?: string | null  // targa esatta opzionale
    target_payment_method?: string // 'card'|'wallet'|'cash'|'bonifico'|'all'
    target_amount_min?: number | null  // euro
    target_amount_max?: number | null  // euro
    created_at: string
    updated_at: string
}

interface CustomerResult {
    id: string
    nome: string
    cognome: string
    telefono: string
    full_name: string
}

interface SentMessageLog {
    id: string
    customer_name: string
    customer_phone: string
    message_text: string
    template_label: string | null
    sent_at: string
    status: string
}

const TRIGGER_LABELS: Record<string, string> = {
    // Booking lifecycle
    'before_pickup': 'Prima del ritiro',
    'after_pickup': 'Dopo il ritiro',
    'before_dropoff': 'Prima della riconsegna',
    'after_dropoff': 'Dopo la riconsegna',
    'on_booking': 'Alla creazione della prenotazione',
    'on_payment': 'Al pagamento ricevuto',
    'on_signature': 'Dopo la firma del contratto',
    'on_extension': 'Dopo una proroga',
    'on_preventivo': 'Invio preventivo (gestito separatamente)',
    // Cauzione lifecycle
    'on_cauzione_created': 'Nuova cauzione creata',
    'on_cauzione_due': 'Cauzione in scadenza',
    'on_cauzione_overdue': 'Cauzione scaduta',
    'on_cauzione_collected': 'Cauzione incassata',
    'on_cauzione_refunded': 'Cauzione restituita',
    // Customer lifecycle
    'on_first_booking': 'Prima prenotazione del cliente',
    'on_inactive_30d': 'Cliente inattivo da 30 giorni',
    'on_inactive_90d': 'Cliente inattivo da 90 giorni',
    // Documenti
    'on_doc_uploaded': 'Documento caricato',
    'on_doc_verified': 'Documento verificato',
    // Pagamento
    'on_payment_failed': 'Pagamento fallito',
    'on_payment_link_expired': 'Link pagamento scaduto',
    // Scadenze
    'on_scadenza_3d': 'Scadenza tra 3 giorni',
    'on_scadenza_7d': 'Scadenza tra 7 giorni',
}

// Descrizioni in linguaggio naturale per ogni evento — mostrate sotto la select.
const TRIGGER_DESCRIPTIONS: Record<string, string> = {
    'before_pickup': 'Il messaggio parte prima del ritiro veicolo. Es. 24 ore prima per ricordare al cliente.',
    'after_pickup': 'Il messaggio parte dopo il ritiro veicolo. Es. 1 ora dopo per chiedere come e\' andato.',
    'before_dropoff': 'Il messaggio parte prima della riconsegna. Es. 24 ore prima per ricordare orario.',
    'after_dropoff': 'Il messaggio parte dopo la riconsegna. Es. 1 ora dopo per richiesta IBAN cauzione.',
    'on_booking': 'Il messaggio parte quando la prenotazione viene creata. Es. 0 ore = subito.',
    'on_payment': 'Il messaggio parte quando il pagamento viene ricevuto.',
    'on_signature': 'Il messaggio parte dopo che il cliente firma il contratto.',
    'on_extension': 'Il messaggio parte dopo una proroga del noleggio.',
    'on_preventivo': 'I preventivi usano un canale separato (vedi Preventivi). Non gestito dal cron.',
    'on_cauzione_created': 'Quando viene aperta una nuova cauzione (in CauzioniTab). Offset 0 = subito.',
    'on_cauzione_due': 'Quando manca poco alla scadenza_cauzione (offset = giorni prima della scadenza).',
    'on_cauzione_overdue': 'Quando la cauzione e\' scaduta (data passata) e non ancora chiusa.',
    'on_cauzione_collected': 'Quando admin segna la cauzione come incassata.',
    'on_cauzione_refunded': 'Quando admin segna la cauzione come restituita al cliente.',
    'on_first_booking': 'Solo alla PRIMA prenotazione di un cliente nuovo. Perfetto per messaggio di benvenuto.',
    'on_inactive_30d': 'Cliente che non prenota da 30 giorni. Cron giornaliero.',
    'on_inactive_90d': 'Cliente che non prenota da 90 giorni. Cron giornaliero.',
    'on_doc_uploaded': 'Quando il cliente carica un documento (patente, CI). Offset 0 = subito.',
    'on_doc_verified': 'Quando admin verifica il documento. Offset 0 = subito.',
    'on_payment_failed': 'Quando un pagamento Nexi fallisce. Offset 0 = subito.',
    'on_payment_link_expired': 'Quando un link di pagamento scade senza pagamento.',
    'on_scadenza_3d': 'Per qualunque scadenza in Scadenze (assicurazione, bollo, ecc.). 3 giorni prima.',
    'on_scadenza_7d': 'Stesso ma 7 giorni prima.',
}

const CATEGORY_LABELS: Record<string, string> = {
    'all': 'Tutti i veicoli',
    'exotic': 'Supercar / Exotic',
    'urban': 'Utilitarie',
    'aziendali': 'Aziendali',
    'furgone': 'Furgoni',
}

// ── Legenda variabili template ────────────────────────────────────────────────
// Mirror esatto delle variabili sostituite dai code-path:
//   send-whatsapp-notification (comuni), nexi-nuovo-addebito (email),
//   nexi-payment-callback (link pagamento), signature-* (OTP/firma),
//   send-birthday-messages, cancel-unpaid-nexi-bookings, review-send,
//   generate-penalty-invoice, maxi-promo-gap-cron, promo-incassi-cron.
// Aggiornare in coppia col code-path.
type TemplateVar = { key: string; description: string; example?: string; aliases?: string[] }
type RecipeSnippet = { label: string; snippet: string; preview?: string }
type VarGroup = { label: string; scope: 'common' | 'specific'; scopeNote?: string; items: TemplateVar[]; recipes?: RecipeSnippet[] }
const TEMPLATE_VAR_GROUPS: VarGroup[] = [
    // ═══ SEMPRE DISPONIBILI ═══════════════════════════════════════════════════
    {
        label: 'Cliente',
        scope: 'common',
        items: [
            { key: 'nome', description: 'Solo il nome del cliente', example: 'Marco' },
            { key: 'customer_name', description: 'Nome e cognome completo', example: 'Marco Bianchi', aliases: ['cliente'] },
            { key: 'customer_email', description: 'Email del cliente', example: 'marco@esempio.it' },
            { key: 'customer_phone', description: 'Numero di telefono del cliente', example: '+39 349 1234567' },
        ],
    },
    {
        label: 'Prenotazione',
        scope: 'common',
        items: [
            { key: 'booking_id', description: 'Codice breve della prenotazione', example: 'A1B2C3D4', aliases: ['booking_ref', 'bookingRef'] },
            { key: 'vehicle_name', description: "Modello dell'auto", example: 'Audi RS3' },
            { key: 'plate', description: "Targa dell'auto", example: 'AB123CD', aliases: ['targa'] },
            { key: 'service_name', description: 'Tipo di servizio (lavaggio, tagliando, ecc.)', example: 'Lavaggio Premium', aliases: ['servizio'] },
        ],
    },
    {
        label: 'Luoghi',
        scope: 'common',
        items: [
            { key: 'pickup_location', description: 'Indirizzo di ritiro', example: 'DR7 Cagliari, Via Sonnino 1' },
            { key: 'dropoff_location', description: 'Indirizzo di riconsegna (se vuoto usa il ritiro)', example: 'DR7 Cagliari' },
        ],
    },
    {
        label: 'Date e orari (noleggio)',
        scope: 'common',
        items: [
            { key: 'pickup_date', description: 'Data di ritiro', example: '12/05/2026' },
            { key: 'pickup_time', description: 'Orario di ritiro', example: '11:00' },
            { key: 'dropoff_date', description: 'Data di riconsegna', example: '15/05/2026' },
            { key: 'dropoff_time', description: 'Orario di riconsegna', example: '10:00' },
        ],
    },
    {
        label: 'Date e orari (lavaggio / meccanica)',
        scope: 'common',
        items: [
            { key: 'date', description: "Data dell'appuntamento", example: 'lunedì 12 maggio 2026' },
            { key: 'time', description: "Orario dell'appuntamento", example: '15:30' },
        ],
    },
    {
        label: 'Pagamento',
        scope: 'common',
        items: [
            { key: 'total', description: 'Importo totale in euro', example: '450,00', aliases: ['totale', 'importo', 'amount'] },
            { key: 'payment_status', description: 'Stato del pagamento', example: 'Pagato / Da saldare', aliases: ['pagamento', 'payment_info'] },
            { key: 'deposit', description: 'Cauzione (importo) o "Senza cauzione"', example: '€500 - In attesa' },
        ],
    },
    {
        label: 'Assicurazione e Km',
        scope: 'common',
        items: [
            { key: 'insurance', description: 'Nome assicurazione scelta dal cliente', example: 'Kasko Black' },
            { key: 'km_info', description: 'Km inclusi nel noleggio', example: '300 Km / Illimitati' },
            { key: 'km_package', description: 'Pacchetto km con eventuale costo', example: '300 Km (€20,00)' },
        ],
    },
    {
        label: 'Note',
        scope: 'common',
        items: [
            { key: 'notes', description: 'Note inserite in prenotazione', example: 'Cliente arriva in serata', aliases: ['note', 'nota'] },
        ],
    },
    {
        label: 'Marketing & Link',
        scope: 'common',
        scopeNote: "Configurabili in Marketing → Social Links. Lì puoi anche aggiungere link personalizzati extra (es. {tiktok}, {youtube}); ognuno diventa una variabile dal titolo che gli dai.",
        items: [
            { key: 'website', description: 'URL del sito DR7', example: 'https://dr7empire.com', aliases: ['sito'] },
            { key: 'review_link', description: 'Link recensione Google', example: 'https://g.page/r/.../review' },
            { key: 'instagram', description: 'URL profilo Instagram', example: 'https://instagram.com/dr7empire' },
            { key: 'facebook', description: 'URL pagina Facebook', example: 'https://facebook.com/dr7empire' },
        ],
    },

    // ═══ DISPONIBILI SOLO IN FLUSSI SPECIFICI ═════════════════════════════════
    {
        label: 'Email Addebito',
        scope: 'specific',
        scopeNote: 'Solo nei template "Email Addebito — Corpo" / "— Oggetto" (flusso Addebito MIT).',
        items: [
            { key: 'contract_ref', description: 'Riferimento del contratto / prenotazione', example: 'DR7-A1B2C3D4' },
            { key: 'causale', description: "Motivo dell'addebito", example: 'Danni carrozzeria' },
        ],
    },
    {
        label: 'Link di Pagamento (Pay by Link)',
        scope: 'specific',
        scopeNote: 'Solo nei template "Richiesta Pagamento" / "Link Pagamento" inviati con Nexi paybylink.',
        items: [
            { key: 'link', description: 'URL completo del link di pagamento Nexi', aliases: ['payment_link'] },
        ],
    },
    {
        label: 'OTP Firma Contratto',
        scope: 'specific',
        scopeNote: 'Solo nel template OTP firma (signature_otp_whatsapp / pro_richiesta_otp).',
        items: [
            { key: 'otp', description: 'Codice OTP a 6 cifre', example: '482917' },
            { key: 'expiryMinutes', description: 'Minuti di validita\' del codice', example: '10' },
        ],
    },
    {
        label: 'Link Firma Documento',
        scope: 'specific',
        scopeNote: 'Solo nei template che inviano un link di firma (document_signature_link / signature_request_link / pro_richiesta_firma).',
        items: [
            { key: 'signerName', description: 'Nome di chi deve firmare', example: 'Marco Bianchi' },
            { key: 'docName', description: 'Nome del documento da firmare', example: 'Contratto DR7-A1B2C3D4', aliases: ['contractNumber'] },
            { key: 'signingUrl', description: 'Link diretto alla pagina di firma' },
        ],
    },
    {
        label: 'Compleanno Cliente',
        scope: 'specific',
        scopeNote: 'Solo nel template Compleanno (birthday_message), riempite dal cron giornaliero.',
        items: [
            { key: 'codice', description: 'Codice sconto generico', example: 'DR7-BIRTH-9F2A' },
            { key: 'codice_supercar', description: 'Codice sconto Supercar' },
            { key: 'codice_noleggio', description: 'Codice sconto noleggio (alias di codice_supercar)' },
            { key: 'codice_lavaggio', description: 'Codice sconto lavaggio premium' },
        ],
    },
    {
        label: 'Cancellazione Prenotazione',
        scope: 'specific',
        scopeNote: 'Solo quando il cron cancel-unpaid-nexi-bookings annulla una prenotazione non pagata.',
        items: [
            { key: 'custName', description: 'Nome cliente' },
            { key: 'bookingRef', description: 'Riferimento prenotazione cancellata' },
            { key: 'link_status', description: 'Stato del link Nexi (disattivato / non trovato)', example: 'disattivato' },
        ],
    },
    {
        label: 'Cashback / Bonus Wallet',
        scope: 'specific',
        scopeNote: 'Solo quando un pagamento card genera cashback DR7 Club (wallet_bonus_credit).',
        items: [
            { key: 'custName', description: 'Nome cliente' },
            { key: 'bonusEur', description: 'Importo cashback in euro', example: '12,00' },
            { key: 'cardLabel', description: 'Tipo carta usata', example: 'Credito / Bancomat' },
            { key: 'percentLabel', description: 'Percentuale cashback applicata', example: '3% / 6%' },
            { key: 'newBalance', description: 'Nuovo saldo wallet dopo il bonus', example: '120,00' },
        ],
    },
    {
        label: 'Voucher Fidelity / Codice Sconto',
        scope: 'specific',
        scopeNote: 'Solo nei template voucher fidelity (250 punti) o codice sconto post-recensione.',
        items: [
            { key: 'codice', description: 'Codice sconto univoco', example: 'DR7-FID-9F2A', aliases: ['code'] },
        ],
    },
    {
        label: 'Fattura PDF',
        scope: 'specific',
        scopeNote: 'Solo quando viene allegata una fattura via WhatsApp (penalty_invoice_pdf_whatsapp / invoice_pdf_whatsapp).',
        items: [
            { key: 'numero_fattura', description: 'Numero progressivo della fattura', example: '2026/00123' },
        ],
    },
    {
        label: 'Maxi Promo Gap / Promo Incassi',
        scope: 'specific',
        scopeNote: 'Solo nei template promozionali generati dai cron (maxi-promo-gap / promo-incassi).',
        items: [
            { key: 'gap_days', description: "Numero di giorni di gap di disponibilita'" },
            { key: 'percentage', description: 'Sconto percentuale offerto', example: '15%' },
            { key: 'hint_link', description: 'Link diretto alla prenotazione del veicolo' },
        ],
    },
    {
        label: 'Preventivo — Veicolo & Date',
        scope: 'specific',
        scopeNote: 'Solo nei template "Preventivo WhatsApp" / "Preventivo senza sconto".',
        items: [
            { key: 'vehicle_year', description: 'Anno modello in formato compatto', example: 'MY2024' },
            { key: 'vehicle_specs', description: 'Specs complete (nome + anno + cv + 0-100)', example: 'Porsche Macan GTS my 2024 440cv 0-100 3,9s' },
            { key: 'vehicle_specs_short', description: 'Solo specs tecniche, senza nome veicolo', example: '440 CV • 0-100 km/h in 3,9s' },
            { key: 'rental_days', description: 'Numero di giorni di noleggio', example: '6' },
            { key: 'daily_rate', description: 'Tariffa giornaliera a listino', example: '€149,00' },
            { key: 'rental_total', description: 'Totale noleggio (giorni × tariffa)', example: '€894,00' },
        ],
    },
    {
        label: 'Preventivo — Voci di costo (per riga)',
        scope: 'specific',
        scopeNote: 'Usali al posto di {pricing_lines} per scegliere quali voci appaiono nel messaggio. Vuoto se la voce non si applica.',
        items: [
            { key: 'rental_line', description: 'Riga noleggio completa', example: '6 giorni — €149,00/giorno = €894,00' },
            { key: 'insurance_line', description: 'Riga assicurazione', example: 'Kasko Base = €534,00' },
            { key: 'lavaggio_line', description: 'Riga lavaggio finale (se incluso)', example: 'Lavaggio Finale = €9,90' },
            { key: 'no_cauzione_line', description: 'Riga No Cauzione (se richiesta)', example: 'No cauzione = €147,00' },
            { key: 'km_line', description: 'Riga km inclusi o illimitati', example: 'Km inclusi: 360 Km' },
            { key: 'second_driver_line', description: 'Riga secondo guidatore', example: 'Secondo guidatore = €60,00' },
            { key: 'dr7_flex_line', description: 'Riga DR7 Flex', example: 'DR7 Flex = €54,00' },
            { key: 'cauzione_veicoli_line', description: 'Riga cauzione veicoli', example: 'Cauzione veicolo = €1.500,00' },
            { key: 'delivery_line', description: 'Riga consegna a domicilio', example: 'Consegna = €40,00' },
            { key: 'pickup_line', description: 'Riga ritiro a domicilio', example: 'Ritiro = €40,00' },
            { key: 'experience_line', description: 'Riga servizi experience', example: 'Servizi experience = €120,00' },
            { key: 'pricing_lines', description: 'Tutte le voci sopra concatenate (legacy)', example: '6 giorni — €149,00/giorno = €894,00\\nKasko Base = €534,00\\n...' },
        ],
    },
    {
        label: 'Preventivo — Totali & Coefficienti',
        scope: 'specific',
        scopeNote: 'Solo nei template Preventivo. Coefficienti opt-in via checkbox al momento dell\'invio.',
        items: [
            { key: 'subtotal_listino', description: 'Subtotale a listino (prima dei coefficienti Pro)', example: '€1.575,00' },
            { key: 'subtotal', description: 'Subtotale dopo coefficienti', example: '€1.434,22' },
            { key: 'total', description: 'Totale finale (sconto applicato se presente)', example: '€1.290,00' },
            { key: 'coefficienti', description: 'Blocco multilinea con tutti i coefficienti applicati', example: 'Coefficienti applicati:\\n- Stagione: x1,15\\n...' },
            { key: 'coefficiente_combinato', description: 'Solo il moltiplicatore combinato', example: 'x1,2143' },
        ],
    },
    {
        label: 'Preventivo — Prezzo & Sconto',
        scope: 'specific',
        scopeNote: 'Solo due variabili da ricordare: {total} e\' SEMPRE il prezzo finale (con o senza sconto), {sconto} e\' la riga sconto (vuota se non c\'e\').',
        items: [
            { key: 'total', description: 'Il prezzo finale (sempre valorizzato)', example: '€1.290,00' },
            { key: 'sconto', description: 'Riga sconto pronta (vuota se nessuno sconto)', example: 'sconto valido 24h €1.290,00', aliases: ['sconto_line'] },
        ],
        recipes: [
            {
                label: 'Preventivo senza sconto',
                snippet: 'Prezzo: {total}',
                preview: 'Prezzo: €1.575,00',
            },
            {
                label: 'Preventivo con sconto (la riga sconto si nasconde se non applicato)',
                snippet: 'Prezzo: {total}\n{sconto}',
                preview: 'Prezzo: €1.290,00\nsconto valido 24h €1.290,00',
            },
        ],
    },
]

function TemplateVarLegend({ defaultOpen = false }: { defaultOpen?: boolean } = {}) {
    const [expanded, setExpanded] = useState(defaultOpen)
    // Carica i link personalizzati creati in Marketing → Social Links
    // (centralina_pro_config.config.marketing.custom_links). Ogni link
    // genera un chip aggiuntivo sotto "Marketing & Link" con la propria
    // variabile {<slug>}. Aggiornamento real-time via postgres_changes:
    // l'admin aggiunge un link nel sub-tab Social Links → la legenda qui
    // ne mostra il chip al prossimo render senza refresh.
    const [customLinks, setCustomLinks] = useState<Array<{ slug: string; title: string; url: string }>>([])
    // Stato di "configurato" dei 4 link fissi: se admin svuota il valore in
    // Social Links, il chip corrispondente sparisce dalla legenda. Cosi'
    // l'admin sa subito quali variabili torneranno effettivamente piene.
    const [marketingFixed, setMarketingFixed] = useState<{
        website: boolean; review_link: boolean; instagram: boolean; facebook: boolean
    }>({ website: true, review_link: true, instagram: true, facebook: true })
    useEffect(() => {
        let cancelled = false
        const loadMarketing = async () => {
            const { data } = await supabase
                .from('centralina_pro_config')
                .select('config')
                .eq('id', 'main')
                .maybeSingle()
            if (cancelled) return
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const mk = ((data?.config || {}) as any).marketing || {}
            // Custom links
            const raw = Array.isArray(mk.custom_links) ? mk.custom_links : []
            const list: Array<{ slug: string; title: string; url: string }> = []
            for (const l of raw as Array<{ title?: string; url?: string }>) {
                if (typeof l?.title !== 'string' || typeof l?.url !== 'string') continue
                if (!l.url.trim()) continue
                const slug = l.title.toLowerCase().trim()
                    .replace(/[^a-z0-9\s\-_]/g, '')
                    .replace(/[\s\-]+/g, '_')
                    .replace(/_+/g, '_')
                    .replace(/^_|_$/g, '')
                    .substring(0, 30)
                if (slug) list.push({ slug, title: l.title, url: l.url })
            }
            setCustomLinks(list)
            // Fixed: chip visibile solo se URL non vuoto
            setMarketingFixed({
                website: typeof mk.website_url === 'string' && mk.website_url.trim().length > 0,
                review_link: typeof mk.google_review_link === 'string' && mk.google_review_link.trim().length > 0,
                instagram: typeof mk.instagram_url === 'string' && mk.instagram_url.trim().length > 0,
                facebook: typeof mk.facebook_url === 'string' && mk.facebook_url.trim().length > 0,
            })
        }
        loadMarketing()
        const sub = supabase
            .channel('legend-marketing-sync')
            .on('postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'centralina_pro_config', filter: 'id=eq.main' },
                () => loadMarketing())
            .subscribe()
        return () => { cancelled = true; sub.unsubscribe() }
    }, [])

    const copy = (k: string) => {
        navigator.clipboard?.writeText(`{${k}}`)
        toast.success(`{${k}} copiato — incollalo nel messaggio`)
    }
    // Inietta i custom_links nel gruppo "Marketing & Link" come chip extra,
    // e nasconde i 4 chip fissi quando il rispettivo URL e' vuoto in
    // Marketing → Social Links.
    const groupsWithCustomLinks: VarGroup[] = TEMPLATE_VAR_GROUPS.map(g => {
        if (g.label !== 'Marketing & Link') return g
        const visibleFixed = g.items.filter(it => {
            if (it.key === 'website') return marketingFixed.website
            if (it.key === 'review_link') return marketingFixed.review_link
            if (it.key === 'instagram') return marketingFixed.instagram
            if (it.key === 'facebook') return marketingFixed.facebook
            return true
        })
        const extras: TemplateVar[] = customLinks.map(l => ({
            key: l.slug,
            description: `${l.title} (link personalizzato)`,
            example: l.url,
        }))
        return { ...g, items: [...visibleFixed, ...extras] }
    }).filter(g => g.items.length > 0)
    const totalVars = groupsWithCustomLinks.reduce((s, g) => s + g.items.length, 0)
    return (
        <div className="mt-2 rounded-lg border border-dr7-gold/30 bg-dr7-gold/5 overflow-hidden">
            <button
                type="button"
                onClick={() => setExpanded(e => !e)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-semibold text-theme-text-primary hover:bg-dr7-gold/10 transition-colors"
            >
                <span className="flex items-center gap-2 text-left">
                    <svg className="w-4 h-4 text-dr7-gold shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                    <span>Quali campi posso inserire nel messaggio?</span>
                    <span className="px-1.5 py-0.5 rounded-full bg-dr7-gold/20 text-dr7-gold text-[10px] font-bold">
                        {totalVars} disponibili
                    </span>
                </span>
                <svg
                    className={`w-3.5 h-3.5 text-theme-text-muted transition-transform shrink-0 ${expanded ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
                </svg>
            </button>
            {expanded && (
                <div className="px-3 pb-3 space-y-4 border-t border-dr7-gold/20">
                    <div className="text-[12px] text-theme-text-secondary mt-3 leading-relaxed">
                        Scrivi il messaggio in italiano normale e quando vuoi inserire un dato del cliente o della prenotazione,
                        usa una di queste etichette tra parentesi graffe (es. <code className="bg-theme-bg-tertiary px-1 rounded text-dr7-gold">{'{nome}'}</code>).
                        Quando il messaggio viene inviato, ogni etichetta viene sostituita automaticamente con il dato reale.
                        <br/>
                        <span className="text-theme-text-muted">Tocca un'etichetta per copiarla negli appunti.</span>
                    </div>

                    {/* FORMATTAZIONE WhatsApp */}
                    <div>
                        <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-sky-500/20">
                            <span className="px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/40 text-[9px] font-bold uppercase tracking-wide">Formattazione</span>
                            <span className="text-[10px] text-theme-text-muted">Caratteri speciali e sintassi WhatsApp — passano nel messaggio cosi' come li scrivi</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {([
                                { code: '•', label: 'Bullet point', preview: '• Voce 1\n• Voce 2', tip: 'Mac: ⌥+8 — Win: Alt+0149' },
                                { code: '·', label: 'Bullet piccolo', preview: '· Voce' },
                                { code: '*testo*', label: 'Grassetto', preview: '*Totale*: €1.290' },
                                { code: '_testo_', label: 'Corsivo', preview: '_valido 24h_' },
                                { code: '~testo~', label: 'Barrato', preview: '~€1.500~ €1.290' },
                                { code: '```testo```', label: 'Monospaziato', preview: '```DR7-A1B2C3```' },
                            ] as const).map(f => (
                                <button
                                    key={f.code}
                                    type="button"
                                    onClick={() => {
                                        navigator.clipboard?.writeText(f.code)
                                        toast.success(`${f.code} copiato`)
                                    }}
                                    className="flex items-start gap-2 px-2 py-2 rounded border border-theme-border bg-theme-bg-secondary hover:border-sky-500/50 hover:bg-sky-500/5 text-left transition-colors"
                                    title={'tip' in f ? f.tip : 'Tocca per copiare'}
                                >
                                    <code className="bg-theme-bg-tertiary px-1.5 py-0.5 rounded text-dr7-gold text-[11px] shrink-0">{f.code}</code>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[11px] font-semibold text-theme-text-primary">{f.label}</div>
                                        <div className="text-[10px] text-theme-text-muted whitespace-pre-line truncate">{f.preview}</div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* SEMPRE DISPONIBILI */}
                    <div>
                        <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-emerald-500/20">
                            <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 text-[9px] font-bold uppercase tracking-wide">Sempre disponibili</span>
                            <span className="text-[10px] text-theme-text-muted">Funzionano in ogni template Pro inviato in flussi prenotazione</span>
                        </div>
                        <div className="space-y-3">
                            {groupsWithCustomLinks.filter(g => g.scope === 'common').map(group => (
                                <div key={group.label}>
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1.5">
                                        {group.label}
                                    </div>
                                    {group.scopeNote && (
                                        <div className="text-[10px] text-theme-text-muted/80 italic mb-1.5 leading-tight">{group.scopeNote}</div>
                                    )}
                                    <div className="flex flex-wrap gap-1.5">
                                        {group.items.map(v => (
                                            <button
                                                key={v.key}
                                                type="button"
                                                onClick={() => copy(v.key)}
                                                title={[
                                                    v.description,
                                                    v.example ? `Esempio: ${v.example}` : null,
                                                    v.aliases?.length ? `Alias: ${v.aliases.map(a => `{${a}}`).join(', ')}` : null,
                                                ].filter(Boolean).join('\n')}
                                                className="group inline-flex flex-col items-start px-2 py-1.5 rounded-md bg-theme-bg-primary border border-theme-border hover:border-dr7-gold/60 hover:bg-dr7-gold/5 transition-colors text-left"
                                            >
                                                <code className="font-mono text-[11px] text-dr7-gold leading-tight">{`{${v.key}}`}</code>
                                                <span className="text-[10px] text-theme-text-secondary leading-tight">
                                                    {v.description}
                                                </span>
                                                {v.example && (
                                                    <span className="text-[9px] text-theme-text-muted leading-tight">
                                                        es. {v.example}
                                                    </span>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* SOLO IN FLUSSI SPECIFICI */}
                    <div>
                        <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-amber-500/20">
                            <span className="px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/40 text-[9px] font-bold uppercase tracking-wide">Solo in flussi specifici</span>
                            <span className="text-[10px] text-theme-text-muted">Funzionano solo se il template viene usato nel flusso indicato</span>
                        </div>
                        <div className="space-y-3">
                            {TEMPLATE_VAR_GROUPS.filter(g => g.scope === 'specific').map(group => (
                                <div key={group.label}>
                                    <div className="flex items-baseline gap-2 mb-1.5">
                                        <div className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">{group.label}</div>
                                    </div>
                                    {group.scopeNote && (
                                        <div className="text-[10px] text-theme-text-muted/80 italic mb-1.5 leading-tight">{group.scopeNote}</div>
                                    )}
                                    <div className="flex flex-wrap gap-1.5">
                                        {group.items.map(v => (
                                            <button
                                                key={v.key}
                                                type="button"
                                                onClick={() => copy(v.key)}
                                                title={[
                                                    v.description,
                                                    v.example ? `Esempio: ${v.example}` : null,
                                                    v.aliases?.length ? `Alias: ${v.aliases.map(a => `{${a}}`).join(', ')}` : null,
                                                ].filter(Boolean).join('\n')}
                                                className="group inline-flex flex-col items-start px-2 py-1.5 rounded-md bg-theme-bg-primary border border-amber-500/20 hover:border-amber-500/60 hover:bg-amber-500/5 transition-colors text-left"
                                            >
                                                <code className="font-mono text-[11px] text-amber-300 leading-tight">{`{${v.key}}`}</code>
                                                <span className="text-[10px] text-theme-text-secondary leading-tight">
                                                    {v.description}
                                                </span>
                                                {v.example && (
                                                    <span className="text-[9px] text-theme-text-muted leading-tight">
                                                        es. {v.example}
                                                    </span>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                    {group.recipes && group.recipes.length > 0 && (
                                        <div className="mt-3 pt-2 border-t border-amber-500/15">
                                            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300/70 mb-1.5">Snippet pronti</div>
                                            <div className="space-y-1.5">
                                                {group.recipes.map((r, i) => (
                                                    <button
                                                        key={i}
                                                        type="button"
                                                        onClick={() => {
                                                            navigator.clipboard?.writeText(r.snippet)
                                                            toast.success(`"${r.label}" copiato`)
                                                        }}
                                                        className="block w-full text-left rounded-md border border-amber-500/20 bg-theme-bg-primary hover:border-amber-500/60 hover:bg-amber-500/5 transition-colors p-2"
                                                    >
                                                        <div className="text-[10px] text-amber-300/90 font-semibold mb-1">{r.label}</div>
                                                        <code className="block font-mono text-[11px] text-theme-text-primary break-all whitespace-pre-wrap">{r.snippet}</code>
                                                        {r.preview && (
                                                            <div className="text-[10px] text-theme-text-muted mt-1 italic">
                                                                Esempio: {r.preview}
                                                            </div>
                                                        )}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

// Organized by KIND of message (purpose), not by service.
// All pro_* keys start with empty body — admin fills them in from scratch.
type ProTemplateDef = { key: string; label: string; description: string }
const PRO_MESSAGE_CATEGORIES: { label: string; templates: ProTemplateDef[] }[] = [
  // Wrapper messages — top of the list, never numbered.
  {
    label: 'Wrapper Messaggio',
    templates: [
      { key: 'pro_wrapper_header', label: 'Header Messaggio', description: 'Testo in cima a ogni messaggio (opzionale)' },
      { key: 'pro_wrapper_footer', label: 'Footer Messaggio', description: 'Testo in fondo a ogni messaggio (opzionale)' },
    ],
  },
  {
    label: 'Conferma',
    templates: [
      { key: 'pro_conferma_noleggio',          label: 'Conferma Noleggio',             description: 'Conferma al cliente dopo creazione prenotazione noleggio' },
      { key: 'pro_conferma_lavaggio',          label: 'Conferma Lavaggio',             description: 'Conferma al cliente dopo prenotazione lavaggio' },
      { key: 'pro_conferma_meccanica',         label: 'Conferma Meccanica',            description: 'Conferma al cliente dopo prenotazione meccanica' },
      { key: 'pro_conferma_pagamento',         label: 'Conferma Pagamento',            description: 'Conferma ricezione pagamento' },
      { key: 'pro_conferma_contratto_firmato', label: 'Conferma Contratto Firmato',    description: 'Conferma dopo firma contratto' },
      { key: 'pro_conferma_preventivo',        label: 'Conferma Preventivo Inviato',   description: 'Conferma invio preventivo al cliente' },
    ],
  },
  {
    label: 'Modifica',
    templates: [
      { key: 'pro_modifica_noleggio',  label: 'Modifica Noleggio',  description: 'Comunicazione al cliente dopo modifica di una prenotazione noleggio' },
      { key: 'pro_modifica_lavaggio',  label: 'Modifica Lavaggio',  description: 'Comunicazione al cliente dopo modifica di una prenotazione lavaggio' },
      { key: 'pro_modifica_meccanica', label: 'Modifica Meccanica', description: 'Comunicazione al cliente dopo modifica di una prenotazione meccanica' },
    ],
  },
  {
    label: 'Email',
    templates: [
      { key: 'pro_email_addebito',         label: 'Email Addebito — Corpo',    description: 'Corpo dell\'email di comunicazione addebito (var: {customer_name}, {contract_ref}, {amount}, {causale})' },
      { key: 'pro_email_addebito_subject', label: 'Email Addebito — Oggetto',  description: 'Oggetto dell\'email di addebito (var: {contract_ref})' },
    ],
  },
  {
    label: 'Promemoria',
    templates: [
      { key: 'pro_promemoria_pickup',        label: 'Promemoria Ritiro',         description: 'Promemoria prima del ritiro veicolo' },
      { key: 'pro_promemoria_dropoff',       label: 'Promemoria Riconsegna',     description: 'Promemoria prima della riconsegna veicolo' },
      { key: 'pro_promemoria_checkin',       label: 'Promemoria Check-in',       description: 'Promemoria check-in lavaggio / meccanica' },
      { key: 'pro_promemoria_checkout',      label: 'Promemoria Check-out',      description: 'Promemoria check-out lavaggio / meccanica' },
      { key: 'pro_promemoria_firma',         label: 'Promemoria Firma',          description: 'Promemoria firma contratto pendente' },
      { key: 'pro_promemoria_pagamento',     label: 'Promemoria Pagamento',      description: 'Promemoria pagamento da saldare' },
      { key: 'pro_promemoria_appuntamento',  label: 'Promemoria Appuntamento',   description: 'Promemoria generico appuntamento' },
    ],
  },
  {
    label: 'Richieste al Cliente',
    templates: [
      { key: 'pro_richiesta_pagamento',  label: 'Richiesta Pagamento',        description: 'Invio link di pagamento al cliente' },
      { key: 'pro_richiesta_firma',      label: 'Richiesta Firma',            description: 'Invio link firma contratto' },
      { key: 'pro_richiesta_otp',        label: 'Richiesta OTP',              description: 'Invio codice OTP per conferma firma' },
      { key: 'pro_richiesta_iban',       label: 'Richiesta IBAN',             description: 'Richiesta IBAN per rimborso cauzione' },
      { key: 'pro_richiesta_documenti',  label: 'Richiesta Documenti',        description: 'Richiesta documenti aggiuntivi al cliente' },
    ],
  },
  {
    label: 'Notifiche Admin',
    templates: [
      { key: 'pro_admin_nuova_prenotazione', label: 'Admin: Nuova Prenotazione', description: 'Alert interno per nuova prenotazione' },
      { key: 'pro_admin_nuovo_preventivo',   label: 'Admin: Nuovo Preventivo',   description: 'Alert interno per nuovo preventivo dal sito' },
      { key: 'pro_admin_contratto_firmato',  label: 'Admin: Contratto Firmato',  description: 'Alert interno dopo firma contratto' },
      { key: 'pro_admin_pagamento_ricevuto', label: 'Admin: Pagamento Ricevuto', description: 'Alert interno dopo pagamento ricevuto' },
      { key: 'pro_admin_annullamento',       label: 'Admin: Annullamento',       description: 'Alert interno per annullamento prenotazione' },
      { key: 'pro_admin_carta_bloccata',     label: 'Admin: Carta Bloccata',     description: 'Alert interno per carta prepagata bloccata' },
    ],
  },
  {
    label: 'Documenti',
    templates: [
      { key: 'pro_documento_contratto', label: 'Invio Contratto PDF',  description: 'Messaggio che accompagna il PDF del contratto' },
      { key: 'pro_documento_fattura',   label: 'Invio Fattura PDF',    description: 'Messaggio che accompagna il PDF della fattura' },
      { key: 'pro_documento_penale',    label: 'Invio Penale PDF',     description: 'Messaggio che accompagna il PDF della penale' },
      { key: 'pro_documento_ricevuta',  label: 'Invio Ricevuta',       description: 'Messaggio che accompagna la ricevuta di pagamento' },
    ],
  },
  {
    label: 'Annullamenti & Rimborsi',
    templates: [
      { key: 'pro_annullamento_cliente', label: 'Annullamento al Cliente', description: 'Comunicazione annullamento prenotazione al cliente' },
      { key: 'pro_rimborso_iniziato',    label: 'Rimborso Iniziato',       description: 'Notifica al cliente che il rimborso è in lavorazione' },
      { key: 'pro_rimborso_completato',  label: 'Rimborso Completato',     description: 'Notifica al cliente a rimborso completato' },
    ],
  },
  {
    label: 'Marketing',
    templates: [
      { key: 'pro_marketing_recensione', label: 'Richiesta Recensione', description: 'Richiesta di recensione dopo il servizio' },
      { key: 'pro_marketing_compleanno', label: 'Messaggio Compleanno', description: 'Auguri di compleanno al cliente' },
      { key: 'pro_marketing_referral',   label: 'Codice Referral',      description: 'Invio codice referral al cliente' },
      { key: 'pro_marketing_rinnovo',    label: 'Promemoria Rinnovo',   description: 'Promemoria rinnovo membership DR7 Club' },
      { key: 'pro_wallet_bonus_cliente', label: 'Bonus Wallet Cliente', description: 'Notifica bonus wallet accreditato al cliente' },
    ],
  },
  {
    label: 'Wrapper Messaggio',
    templates: [
      { key: 'pro_wrapper_header', label: 'Header Messaggio', description: 'Testo in cima a ogni messaggio (opzionale)' },
      { key: 'pro_wrapper_footer', label: 'Footer Messaggio', description: 'Testo in fondo a ogni messaggio (opzionale)' },
    ],
  },
]

const ALL_PRO_TEMPLATES: ProTemplateDef[] = PRO_MESSAGE_CATEGORIES.flatMap(c => c.templates)

// Wrappers are never numbered and never bulk-deleted by "Elimina non attivi"
const WRAPPER_KEYS = new Set(['pro_wrapper_header', 'pro_wrapper_footer'])


export default function MessaggiSistemaProTab() {
    // Template state
    const [templates, setTemplates] = useState<SystemMessage[]>([])
    const [loading, setLoading] = useState(true)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editBody, setEditBody] = useState('')
    const [editLabel, setEditLabel] = useState('')
    const [saving, setSaving] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')

    // New template form
    const [showNewForm, setShowNewForm] = useState(false)
    const [newLabel, setNewLabel] = useState('')
    const [newDescription, setNewDescription] = useState('')
    const [newBody, setNewBody] = useState('')
    const [newIsAutomatic, setNewIsAutomatic] = useState(false)
    const [newTriggerEvent, setNewTriggerEvent] = useState('before_dropoff')
    const [newTriggerOffset, setNewTriggerOffset] = useState(24)
    const [newSendHour, setNewSendHour] = useState<number | null>(9)
    const [newTargetCategory, setNewTargetCategory] = useState('all')
    // Filtri avanzati (migration 20260509)
    const [newTargetServiceType, setNewTargetServiceType] = useState('all')
    const [newTargetWithDeposit, setNewTargetWithDeposit] = useState('all')
    const [newTargetPlate, setNewTargetPlate] = useState('')
    const [newTargetPaymentMethod, setNewTargetPaymentMethod] = useState('all')
    const [newTargetAmountMin, setNewTargetAmountMin] = useState('')
    const [newTargetAmountMax, setNewTargetAmountMax] = useState('')
    const [creatingNew, setCreatingNew] = useState(false)

    // Send section state
    const [sendMode, setSendMode] = useState<'template' | 'free'>('template')
    const [selectedTemplateId, setSelectedTemplateId] = useState('')
    const [freeText, setFreeText] = useState('')
    const [customerSearch, setCustomerSearch] = useState('')
    const [customerResults, setCustomerResults] = useState<CustomerResult[]>([])
    const [selectedCustomers, setSelectedCustomers] = useState<CustomerResult[]>([])
    const [searching, setSearching] = useState(false)
    const [sending, setSending] = useState(false)
    const [sendProgress, setSendProgress] = useState({ current: 0, total: 0 })
    const [showResults, setShowResults] = useState(false)
    const searchRef = useRef<HTMLDivElement>(null)

    // Sent messages log
    const [sentLogs, setSentLogs] = useState<SentMessageLog[]>([])
    const [logsLoading, setLogsLoading] = useState(false)

    useEffect(() => {
        loadTemplates()
        loadSentLogs()
    }, [])

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
                setShowResults(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    async function loadTemplates() {
        setLoading(true)
        try {
            // Fetch every pro_* row AND any pro_custom_* the admin created
            const { data, error } = await supabase
                .from('system_messages')
                .select('*')
                .like('message_key', 'pro_%')
                .order('created_at', { ascending: true })

            if (error) throw error
            let rows = data || []

            // Auto-seed all pro_* rows ONLY on first-ever visit (zero rows exist).
            // After that, respect user deletions — a deleted template must stay deleted.
            const missing = rows.length === 0
                ? ALL_PRO_TEMPLATES
                : []
            if (missing.length > 0) {
                const toInsert = missing.map(t => ({
                    message_key: t.key,
                    label: t.label,
                    description: t.description,
                    message_body: '',
                    is_automatic: false,
                    is_enabled: false,
                    include_header: false,
                    trigger_event: 'before_dropoff',
                    trigger_offset_hours: 24,
                    send_hour: 9,
                    target_category: 'all',
                    target_status: 'confirmed,active',
                }))
                const { data: inserted, error: insErr } = await supabase
                    .from('system_messages')
                    .insert(toInsert)
                    .select()
                if (insErr) {
                    console.error('Auto-seed pro templates failed:', insErr)
                } else if (inserted) {
                    rows = [...rows, ...inserted]
                }
            }

            // One-time cleanup: flip include_header=false on untouched seeded rows
            // (empty body + manual + disabled = admin hasn't configured yet)
            const untouchedWithHeader = rows.filter(r =>
                r.include_header === true &&
                !r.message_body &&
                r.is_automatic === false &&
                r.is_enabled === false
            )
            if (untouchedWithHeader.length > 0) {
                const ids = untouchedWithHeader.map(r => r.id)
                const { error: upErr } = await supabase
                    .from('system_messages')
                    .update({ include_header: false })
                    .in('id', ids)
                if (upErr) {
                    console.error('Reset include_header on untouched pro rows failed:', upErr)
                } else {
                    rows = rows.map(r => ids.includes(r.id) ? { ...r, include_header: false } : r)
                }
            }

            setTemplates(rows)
        } catch (err: unknown) {
            console.error('Error loading templates:', err)
            toast.error('Errore caricamento messaggi')
        } finally {
            setLoading(false)
        }
    }

    async function loadSentLogs() {
        setLogsLoading(true)
        try {
            const { data, error } = await supabase
                .from('sent_messages_log')
                .select('*')
                .order('sent_at', { ascending: false })
                .limit(100)

            if (error && error.code !== '42P01') throw error
            setSentLogs(data || [])
        } catch (err: unknown) {
            console.error('Error loading sent logs:', err)
        } finally {
            setLogsLoading(false)
        }
    }

    async function handleSaveEdit(id: string) {
        const trimmedLabel = editLabel.trim()
        if (!trimmedLabel) {
            toast.error('Il titolo non può essere vuoto')
            return
        }
        setSaving(true)
        try {
            // Try the Netlify function first (service-role, bypasses RLS).
            // Fall back to direct supabase.update() if the function errors.
            const updatedAt = new Date().toISOString()
            const payload = { message_body: editBody, label: trimmedLabel }
            let saved = false
            try {
                const response = await authFetch('/.netlify/functions/update-system-message', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, ...payload })
                })
                if (response.ok) {
                    saved = true
                } else {
                    const result = await response.json().catch(() => ({}))
                    console.warn('[Pro] update-system-message fn failed, falling back:', result)
                }
            } catch (fnErr) {
                console.warn('[Pro] update-system-message fn threw, falling back:', fnErr)
            }

            if (!saved) {
                const { data, error } = await supabase
                    .from('system_messages')
                    .update({ ...payload, updated_at: updatedAt })
                    .eq('id', id)
                    .select()
                    .single()
                if (error) throw error
                if (!data) throw new Error('Nessuna riga aggiornata')
            }

            // Re-fetch to be certain DB state matches UI
            const { data: fresh } = await supabase
                .from('system_messages')
                .select('*')
                .eq('id', id)
                .single()
            if (fresh) {
                setTemplates(prev => prev.map(t => t.id === id ? fresh : t))
            } else {
                setTemplates(prev => prev.map(t => t.id === id ? { ...t, ...payload, updated_at: updatedAt } : t))
            }
            setEditingId(null)
            toast.success('Messaggio salvato')
        } catch (err: unknown) {
            const _errMsg = err instanceof Error ? err.message : String(err)
            console.error('Error saving template:', err)
            toast.error('Errore salvataggio: ' + _errMsg)
        } finally {
            setSaving(false)
        }
    }

    async function handleCreateTemplate() {
        if (!newLabel.trim()) {
            toast.error('Il nome del messaggio è obbligatorio')
            return
        }
        setCreatingNew(true)
        const messageKey = 'pro_custom_' + newLabel
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, '_')
            .substring(0, 40) + '_' + Date.now()

        try {
            const { data, error } = await supabase
                .from('system_messages')
                .insert({
                    message_key: messageKey,
                    label: newLabel.trim(),
                    description: newDescription.trim(),
                    message_body: newBody.trim(),
                    is_automatic: newIsAutomatic,
                    is_enabled: true,
                    trigger_event: newTriggerEvent,
                    trigger_offset_hours: newTriggerOffset,
                    send_hour: newSendHour,
                    target_category: newTargetCategory,
                    target_status: 'confirmed,active',
                    target_service_type: newTargetServiceType,
                    target_with_deposit: newTargetWithDeposit,
                    target_plate: newTargetPlate.trim() || null,
                    target_payment_method: newTargetPaymentMethod,
                    target_amount_min: newTargetAmountMin ? parseFloat(newTargetAmountMin) : null,
                    target_amount_max: newTargetAmountMax ? parseFloat(newTargetAmountMax) : null,
                })
                .select()
                .single()

            if (error) throw error
            setTemplates(prev => [...prev, data])
            setShowNewForm(false)
            setNewLabel('')
            setNewDescription('')
            setNewBody('')
            setNewIsAutomatic(false)
            setNewTriggerEvent('before_dropoff')
            setNewTriggerOffset(24)
            setNewSendHour(9)
            setNewTargetCategory('all')
            toast.success('Nuovo messaggio Pro creato')
        } catch (err: unknown) {
            const _errMsg = err instanceof Error ? err.message : String(err)
            console.error('Error creating template:', err)
            toast.error('Errore creazione: ' + _errMsg)
        } finally {
            setCreatingNew(false)
        }
    }

    async function handleToggleAutomatic(template: SystemMessage) {
        try {
            const newVal = !template.is_automatic
            const { error } = await supabase
                .from('system_messages')
                .update({ is_automatic: newVal, updated_at: new Date().toISOString() })
                .eq('id', template.id)
            if (error) throw error
            setTemplates(prev => prev.map(t => t.id === template.id ? { ...t, is_automatic: newVal } : t))
            toast.success(newVal ? 'Invio automatico attivato' : 'Invio automatico disattivato')
        } catch (err: unknown) {
            const _errMsg = err instanceof Error ? err.message : String(err)
            toast.error('Errore: ' + _errMsg)
        }
    }

    async function handleToggleEnabled(template: SystemMessage) {
        try {
            const newVal = !template.is_enabled
            const { error } = await supabase
                .from('system_messages')
                .update({ is_enabled: newVal, updated_at: new Date().toISOString() })
                .eq('id', template.id)
            if (error) throw error
            setTemplates(prev => prev.map(t => t.id === template.id ? { ...t, is_enabled: newVal } : t))
            toast.success(newVal ? 'Messaggio attivato' : 'Messaggio disattivato')
        } catch (err: unknown) {
            const _errMsg = err instanceof Error ? err.message : String(err)
            toast.error('Errore: ' + _errMsg)
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function handleUpdateAutomation(templateId: string, field: string, value: any) {
        try {
            const { error } = await supabase
                .from('system_messages')
                .update({ [field]: value, updated_at: new Date().toISOString() })
                .eq('id', templateId)
            if (error) throw error
            setTemplates(prev => prev.map(t => t.id === templateId ? { ...t, [field]: value } : t))
        } catch (err: unknown) {
            const _errMsg = err instanceof Error ? err.message : String(err)
            toast.error('Errore: ' + _errMsg)
        }
    }

    async function handleDeleteTemplate(template: SystemMessage) {
        if (!confirm(`Eliminare definitivamente il messaggio "${template.label}"?\n\nQuesta operazione non è reversibile.`)) return

        try {
            let deleted = false
            try {
                const res = await authFetch('/.netlify/functions/delete-system-message', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: template.id }),
                })
                const json = await res.json().catch(() => ({}))
                if (res.ok && !json?.error) {
                    deleted = true
                } else {
                    console.warn('[Pro] delete-system-message fn failed, falling back:', json)
                }
            } catch (fnErr) {
                console.warn('[Pro] delete-system-message fn threw, falling back:', fnErr)
            }

            if (!deleted) {
                const { error } = await supabase
                    .from('system_messages')
                    .delete()
                    .eq('id', template.id)
                if (error) throw error
            }

            // Verify the row is really gone before updating UI
            const { data: stillThere } = await supabase
                .from('system_messages')
                .select('id')
                .eq('id', template.id)
                .maybeSingle()
            if (stillThere) throw new Error('Il messaggio non è stato rimosso dal database')

            setTemplates(prev => prev.filter(t => t.id !== template.id))
            toast.success('Messaggio eliminato')
        } catch (err: unknown) {
            const _errMsg = err instanceof Error ? err.message : String(err)
            console.error('Error deleting template:', err)
            toast.error('Errore eliminazione: ' + _errMsg)
        }
    }

    async function searchCustomers(query: string) {
        setCustomerSearch(query)
        if (query.length < 2) {
            setCustomerResults([])
            setShowResults(false)
            return
        }

        setSearching(true)
        setShowResults(true)
        try {
            const q = query.toLowerCase()
            const { data: byName } = await supabase
                .from('customers_extended')
                .select('id, nome, cognome, telefono')
                .or(`nome.ilike.%${q}%,cognome.ilike.%${q}%`)
                .limit(20)

            const cleanQ = query.replace(/[\s\-+()]/g, '')
            const { data: byPhone } = await supabase
                .from('customers_extended')
                .select('id, nome, cognome, telefono')
                .ilike('telefono', `%${cleanQ}%`)
                .limit(10)

            const merged = new Map<string, CustomerResult>()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const process = (items: any[] | null) => {
                items?.forEach(c => {
                    if (c.telefono && !merged.has(c.id)) {
                        merged.set(c.id, {
                            id: c.id,
                            nome: c.nome || '',
                            cognome: c.cognome || '',
                            telefono: c.telefono,
                            full_name: `${c.nome || ''} ${c.cognome || ''}`.trim() || 'Cliente',
                        })
                    }
                })
            }
            process(byName)
            process(byPhone)

            const selectedIds = new Set(selectedCustomers.map(c => c.id))
            setCustomerResults(Array.from(merged.values()).filter(c => !selectedIds.has(c.id)))
        } catch (err: unknown) {
            console.error('Error searching customers:', err)
        } finally {
            setSearching(false)
        }
    }

    function addCustomer(customer: CustomerResult) {
        setSelectedCustomers(prev => [...prev, customer])
        setCustomerResults(prev => prev.filter(c => c.id !== customer.id))
        setCustomerSearch('')
        setShowResults(false)
    }

    function removeCustomer(id: string) {
        setSelectedCustomers(prev => prev.filter(c => c.id !== id))
    }

    function getMessageText(): string {
        if (sendMode === 'free') return freeText
        const template = templates.find(t => t.id === selectedTemplateId)
        return template?.message_body || ''
    }

    function getPreviewText(): string {
        const text = getMessageText()
        if (!text) return ''
        const firstName = selectedCustomers.length > 0
            ? (selectedCustomers[0].nome || selectedCustomers[0].full_name.split(' ')[0])
            : '{nome}'
        return text.replace(/\{nome\}/g, firstName)
    }

    function cleanPhone(phone: string): string {
        let cleaned = phone.replace(/[\s\-+()]/g, '').replace(/[^\d]/g, '')
        if (cleaned.startsWith('00')) {
            cleaned = cleaned.substring(2)
        }
        if (cleaned.length === 10) {
            cleaned = '39' + cleaned
        }
        return cleaned
    }

    async function handleSend() {
        const messageText = getMessageText()
        if (!messageText.trim()) {
            toast.error('Scrivi o seleziona un messaggio')
            return
        }
        if (selectedCustomers.length === 0) {
            toast.error('Seleziona almeno un cliente')
            return
        }

        const customersWithPhone = selectedCustomers.filter(c => c.telefono)
        if (customersWithPhone.length === 0) {
            toast.error('Nessun cliente selezionato ha un numero di telefono')
            return
        }

        if (!confirm(`Inviare il messaggio WhatsApp a ${customersWithPhone.length} cliente/i?`)) return

        setSending(true)
        setSendProgress({ current: 0, total: customersWithPhone.length })
        let successCount = 0
        let failCount = 0

        for (let i = 0; i < customersWithPhone.length; i++) {
            const customer = customersWithPhone[i]
            const firstName = customer.nome || customer.full_name.split(' ')[0]
            const personalizedMessage = messageText.replace(/\{nome\}/g, firstName)
            const phone = cleanPhone(customer.telefono)

            setSendProgress({ current: i + 1, total: customersWithPhone.length })

            try {
                const response = await fetch('/.netlify/functions/send-whatsapp-notification', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        customMessage: personalizedMessage,
                        customPhone: phone,
                        skipHeader: sendMode === 'free'
                          || !(templates.find(t => t.id === selectedTemplateId)?.include_header),
                    }),
                })

                const result = await response.json()
                if (response.ok && result.success) {
                    successCount++
                    const templateLabel = sendMode === 'template'
                        ? templates.find(t => t.id === selectedTemplateId)?.label || null
                        : null
                    await supabase.from('sent_messages_log').insert({
                        customer_id: customer.id,
                        customer_name: customer.full_name,
                        customer_phone: phone,
                        message_text: personalizedMessage,
                        template_label: templateLabel,
                        status: 'sent',
                    })
                } else {
                    failCount++
                    console.error(`Failed to send to ${customer.full_name}:`, result)
                }
            } catch (err) {
                failCount++
                console.error(`Error sending to ${customer.full_name}:`, err)
            }

            if (i < customersWithPhone.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1500))
            }
        }

        setSending(false)
        setSendProgress({ current: 0, total: 0 })

        if (successCount > 0) {
            toast.success(`Inviato a ${successCount} cliente/i`)
        }
        if (failCount > 0) {
            toast.error(`${failCount} invio/i fallito/i`)
        }

        if (successCount > 0) {
            setSelectedCustomers([])
            setFreeText('')
            loadSentLogs()
        }
    }

    if (loading) {
        return <div className="text-center py-10 text-dr7-gold">Caricamento messaggi...</div>
    }

    // Canonical sort order: follow PRO_MESSAGE_CATEGORIES declaration, then any custom pro_custom_*
    const keyOrder: Record<string, number> = {}
    ALL_PRO_TEMPLATES.forEach((t, i) => { keyOrder[t.key] = i })
    const sortedTemplates = [...templates].sort((a, b) => {
        const ai = keyOrder[a.message_key] ?? 9999
        const bi = keyOrder[b.message_key] ?? 9999
        if (ai !== bi) return ai - bi
        return (a.label || '').localeCompare(b.label || '')
    })

    // Dynamic numbering: 1..N for every non-wrapper template currently in DB, in sorted order.
    // Wrappers (pro_wrapper_header, pro_wrapper_footer) never get a number.
    const templateNumberById: Record<string, number> = {}
    sortedTemplates
        .filter(t => !WRAPPER_KEYS.has(t.message_key))
        .forEach((t, i) => { templateNumberById[t.id] = i + 1 })

    const q = searchQuery.trim().toLowerCase()
    const filteredTemplates = q
        ? sortedTemplates.filter(t =>
            (t.label || '').toLowerCase().includes(q) ||
            (t.description || '').toLowerCase().includes(q) ||
            (t.message_body || '').toLowerCase().includes(q) ||
            (t.message_key || '').toLowerCase().includes(q)
          )
        : sortedTemplates

    return (
        <div className="space-y-8">
            {/* ═══════════ SECTION A: Template Manager (Pro) ═══════════ */}
            <div className="space-y-4">
                <div className="flex justify-between items-center">
                    <div>
                        <h3 className="text-lg font-bold text-theme-text-primary">Messaggi di Sistema Pro</h3>
                        <p className="text-theme-text-primary text-sm">Template dei messaggi WhatsApp organizzati per tipologia</p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setShowNewForm(!showNewForm)}
                            className="px-5 py-2.5 rounded-full font-semibold text-sm transition-colors bg-dr7-gold text-white hover:bg-[#0A8FA3]"
                        >
                            + Nuovo Messaggio
                        </button>
                    </div>
                </div>

                {/* New Template Form */}
                {showNewForm && (
                    <div className="bg-theme-bg-secondary rounded-xl border border-dr7-gold/30 p-5 space-y-4 animate-fadeIn">
                        <h4 className="font-semibold text-theme-text-primary">Nuovo Template Pro</h4>
                        <div>
                            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Nome del messaggio</label>
                            <input
                                type="text"
                                value={newLabel}
                                onChange={e => setNewLabel(e.target.value)}
                                placeholder="es. Promemoria appuntamento"
                                className="w-full px-4 py-2.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/50"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Testo del messaggio</label>
                            <textarea
                                value={newBody}
                                onChange={e => setNewBody(e.target.value)}
                                rows={5}
                                placeholder="Buongiorno {nome},&#10;&#10;..."
                                className="w-full px-4 py-2.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/50 font-mono text-sm"
                            />
                            <TemplateVarLegend />
                            <p className="text-[11px] text-theme-text-muted mt-1.5">Esempio rapido: <code className="bg-theme-bg-tertiary px-1.5 py-0.5 rounded text-dr7-gold">{"{nome}"}</code> verrà sostituito col nome del cliente.</p>
                        </div>

                        <div className="border border-theme-border rounded-lg p-4">
                            <label className="flex items-center gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={newIsAutomatic}
                                    onChange={e => setNewIsAutomatic(e.target.checked)}
                                    className="w-5 h-5 rounded border-theme-border accent-dr7-gold"
                                />
                                <div>
                                    <span className="text-sm font-semibold text-theme-text-primary">Invio Automatico</span>
                                    <p className="text-xs text-theme-text-muted">Il messaggio verrà inviato automaticamente quando le condizioni sono soddisfatte</p>
                                </div>
                            </label>

                            {newIsAutomatic && (
                                <>
                                <div className="mt-3 mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-300/90 leading-relaxed">
                                    Il messaggio verrà inviato automaticamente da un cron che gira ogni 15 minuti. Per ogni cliente verrà inviato una sola volta (no doppioni).
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="col-span-2">
                                        <label className="block text-xs font-medium text-theme-text-muted mb-1">Evento</label>
                                        <select value={newTriggerEvent} onChange={e => setNewTriggerEvent(e.target.value)}
                                            className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm">
                                            {Object.entries(TRIGGER_LABELS).map(([k, v]) => (
                                                <option key={k} value={k}>{v}</option>
                                            ))}
                                        </select>
                                        <p className="text-[11px] text-theme-text-muted mt-1.5">
                                            {TRIGGER_DESCRIPTIONS[newTriggerEvent] || ''}
                                        </p>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-theme-text-muted mb-1">Quanto prima/dopo (ore)</label>
                                        <input type="number" value={newTriggerOffset} onChange={e => setNewTriggerOffset(parseInt(e.target.value) || 0)}
                                            className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm" />
                                        <p className="text-xs text-theme-text-muted mt-1">1 = 1 ora · 24 = 1 giorno · 48 = 2 giorni · 0 = subito</p>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-theme-text-muted mb-1">Ora di invio (Roma)</label>
                                        <select value={newSendHour ?? ''} onChange={e => setNewSendHour(e.target.value === '' ? null : parseInt(e.target.value))}
                                            className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm">
                                            <option value="">Appena possibile</option>
                                            {Array.from({ length: 24 }, (_, i) => (
                                                <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-theme-text-muted mb-1">Categoria veicolo</label>
                                        <select value={newTargetCategory} onChange={e => setNewTargetCategory(e.target.value)}
                                            className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm">
                                            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                                                <option key={k} value={k}>{v}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                {/* Filtri avanzati — phase 1 */}
                                <div className="mt-4 pt-4 border-t border-theme-border/40">
                                    <div className="text-[11px] font-bold uppercase tracking-wider text-theme-text-muted mb-2">Filtri avanzati</div>
                                    <p className="text-[11px] text-theme-text-muted mb-3 italic">
                                        Restringi quando il messaggio parte. Esempio: solo prenotazioni noleggio con cauzione, oppure solo veicolo "AB123CD".
                                    </p>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-medium text-theme-text-muted mb-1">Tipo servizio</label>
                                            <select value={newTargetServiceType} onChange={e => setNewTargetServiceType(e.target.value)}
                                                className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm">
                                                <option value="all">Tutti i servizi</option>
                                                <option value="rental">Solo noleggio veicoli</option>
                                                <option value="prime_wash">Solo Prime Wash (lavaggio + meccanica)</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-theme-text-muted mb-1">Cauzione</label>
                                            <select value={newTargetWithDeposit} onChange={e => setNewTargetWithDeposit(e.target.value)}
                                                className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm">
                                                <option value="all">Tutte le prenotazioni</option>
                                                <option value="yes">Solo con cauzione</option>
                                                <option value="no">Solo senza cauzione</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-theme-text-muted mb-1">Targa specifica</label>
                                            <input
                                                type="text"
                                                value={newTargetPlate}
                                                onChange={e => setNewTargetPlate(e.target.value.toUpperCase())}
                                                placeholder="es. AB123CD (vuoto = tutti)"
                                                className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm font-mono uppercase"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-theme-text-muted mb-1">Metodo pagamento</label>
                                            <select value={newTargetPaymentMethod} onChange={e => setNewTargetPaymentMethod(e.target.value)}
                                                className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm">
                                                <option value="all">Tutti i metodi</option>
                                                <option value="card">Carta di credito</option>
                                                <option value="wallet">Credit Wallet</option>
                                                <option value="cash">Contanti</option>
                                                <option value="bonifico">Bonifico</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-theme-text-muted mb-1">Importo min (€)</label>
                                            <input
                                                type="number"
                                                value={newTargetAmountMin}
                                                onChange={e => setNewTargetAmountMin(e.target.value)}
                                                placeholder="vuoto = nessun limite"
                                                className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-theme-text-muted mb-1">Importo max (€)</label>
                                            <input
                                                type="number"
                                                value={newTargetAmountMax}
                                                onChange={e => setNewTargetAmountMax(e.target.value)}
                                                placeholder="vuoto = nessun limite"
                                                className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm"
                                            />
                                        </div>
                                    </div>
                                </div>
                                </>
                            )}
                        </div>

                        <div className="flex gap-2 justify-end">
                            <button
                                onClick={() => { setShowNewForm(false); setNewLabel(''); setNewDescription(''); setNewBody('') }}
                                className="px-4 py-2 rounded-full text-sm font-medium bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover transition-colors"
                            >
                                Annulla
                            </button>
                            <button
                                onClick={handleCreateTemplate}
                                disabled={creatingNew || !newLabel.trim()}
                                className="px-5 py-2 rounded-full text-sm font-semibold bg-dr7-gold text-white hover:bg-[#0A8FA3] transition-colors disabled:opacity-50"
                            >
                                {creatingNew ? 'Salvataggio...' : 'Crea Messaggio'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Search */}
                <div className="relative">
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Cerca messaggio (es. compleanno, noleggio, firma...)"
                        className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/50 text-sm"
                    />
                    <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-theme-text-muted hover:text-theme-text-primary text-lg leading-none"
                            aria-label="Svuota ricerca"
                        >
                            &times;
                        </button>
                    )}
                </div>

                {/* Template list — flat */}
                <div className="space-y-2">
                    {filteredTemplates.length === 0 && (
                        <div className="text-center py-8 text-theme-text-muted border border-theme-border rounded-lg">
                            {q ? `Nessun messaggio trovato per "${searchQuery}"` : 'Nessun messaggio'}
                        </div>
                    )}
                    {filteredTemplates.map((template) => (
                                        <details key={template.id} className={`border rounded-lg overflow-hidden ${template.is_enabled === false ? 'border-red-500/30 opacity-60' : 'border-theme-border'}`}>
                                            <summary className="px-4 py-3 cursor-pointer hover:bg-theme-bg-hover/30">
                                                <div className="flex items-center gap-3">
                                                    <button
                                                        onClick={(e) => { e.preventDefault(); handleToggleEnabled(template) }}
                                                        className={`w-10 h-5 rounded-full relative transition-colors shrink-0 ${template.is_enabled !== false ? 'bg-green-500' : 'bg-gray-600'}`}
                                                    >
                                                        <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all ${template.is_enabled !== false ? 'left-5' : 'left-0.5'}`} />
                                                    </button>
                                                    {templateNumberById[template.id] && (
                                                        <span className="shrink-0 inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-dr7-gold/20 text-dr7-gold text-[11px] font-bold">
                                                            {templateNumberById[template.id]}
                                                        </span>
                                                    )}
                                                    <span className="font-semibold text-theme-text-primary text-sm min-w-0">{template.label}</span>
                                                    <div className="flex items-center gap-1.5 ml-auto shrink-0">
                                                        <button
                                                            onClick={(e) => { e.preventDefault(); handleToggleAutomatic(template) }}
                                                            className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                                                                template.is_automatic
                                                                    ? 'bg-green-600/20 text-green-400 hover:bg-green-600/30'
                                                                    : 'bg-purple-600/20 text-purple-400 hover:bg-purple-600/30'
                                                            }`}
                                                        >
                                                            {template.is_automatic ? 'Automatico' : 'Manuale'}
                                                        </button>
                                                        {template.is_enabled === false && (
                                                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-600/20 text-red-400">OFF</span>
                                                        )}
                                                        <button
                                                            onClick={(e) => {
                                                                e.preventDefault()
                                                                e.stopPropagation()
                                                                const newVal = !template.include_header
                                                                authFetch('/.netlify/functions/update-system-message', {
                                                                    method: 'POST',
                                                                    headers: { 'Content-Type': 'application/json' },
                                                                    body: JSON.stringify({ id: template.id, include_header: newVal })
                                                                }).then(res => {
                                                                    if (!res.ok) { toast.error('Errore aggiornamento'); return }
                                                                    setTemplates(prev => prev.map(t => t.id === template.id ? { ...t, include_header: newVal } : t))
                                                                    toast.success(newVal ? 'Header/Footer attivato' : 'Header/Footer disattivato')
                                                                }).catch(() => toast.error('Errore di rete'))
                                                            }}
                                                            className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                                                                template.include_header
                                                                    ? 'bg-blue-600/20 text-blue-400 hover:bg-blue-600/30'
                                                                    : 'bg-gray-600/20 text-gray-500 hover:bg-gray-600/30'
                                                            }`}
                                                        >
                                                            {template.include_header ? 'H/F ✓' : 'H/F ✗'}
                                                        </button>
                                                        <button
                                                            onClick={(e) => {
                                                                e.preventDefault()
                                                                e.stopPropagation()
                                                                const newVal = !template.send_email
                                                                authFetch('/.netlify/functions/update-system-message', {
                                                                    method: 'POST',
                                                                    headers: { 'Content-Type': 'application/json' },
                                                                    body: JSON.stringify({ id: template.id, send_email: newVal })
                                                                }).then(res => {
                                                                    if (!res.ok) { toast.error('Errore aggiornamento'); return }
                                                                    setTemplates(prev => prev.map(t => t.id === template.id ? { ...t, send_email: newVal } : t))
                                                                    toast.success(newVal ? 'Invio email attivato' : 'Invio email disattivato')
                                                                }).catch(() => toast.error('Errore di rete'))
                                                            }}
                                                            title="Invia anche via email lo stesso testo del WhatsApp"
                                                            className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                                                                template.send_email
                                                                    ? 'bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30'
                                                                    : 'bg-gray-600/20 text-gray-500 hover:bg-gray-600/30'
                                                            }`}
                                                        >
                                                            {template.send_email ? 'Email ✓' : 'Email ✗'}
                                                        </button>
                                                        <button
                                                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDeleteTemplate(template) }}
                                                            title="Elimina definitivamente"
                                                            aria-label="Elimina"
                                                            className="p-1.5 rounded-full bg-red-600/20 text-red-400 hover:bg-red-600/40 hover:text-red-300 transition-colors"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                <polyline points="3 6 5 6 21 6" />
                                                                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                                                <path d="M10 11v6" />
                                                                <path d="M14 11v6" />
                                                                <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                </div>
                                                <p className="text-xs text-theme-text-primary mt-1 ml-[52px]">{template.description}</p>
                                            </summary>

                                            <div className="p-4 border-t border-theme-border space-y-3">
                                                {template.send_email && (
                                                    <div className="px-3 py-2.5 rounded-lg bg-emerald-600/5 border border-emerald-600/20">
                                                        <label className="block text-[11px] font-medium uppercase tracking-wide text-emerald-400 mb-1">
                                                            Oggetto email
                                                        </label>
                                                        <input
                                                            type="text"
                                                            defaultValue={template.email_subject || ''}
                                                            placeholder={`(default: ${template.label})`}
                                                            onBlur={(e) => {
                                                                const newVal = e.target.value.trim() || null
                                                                if (newVal === (template.email_subject || null)) return
                                                                authFetch('/.netlify/functions/update-system-message', {
                                                                    method: 'POST',
                                                                    headers: { 'Content-Type': 'application/json' },
                                                                    body: JSON.stringify({ id: template.id, email_subject: newVal })
                                                                }).then(res => {
                                                                    if (!res.ok) { toast.error('Errore aggiornamento oggetto'); return }
                                                                    setTemplates(prev => prev.map(t => t.id === template.id ? { ...t, email_subject: newVal } : t))
                                                                    toast.success('Oggetto email aggiornato')
                                                                }).catch(() => toast.error('Errore di rete'))
                                                            }}
                                                            className="w-full px-3 py-2 rounded-md bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                                                        />
                                                        <p className="text-[11px] text-theme-text-muted mt-1.5">
                                                            Il corpo email è lo stesso del WhatsApp. Se lasci vuoto, l'oggetto sarà il titolo del template.
                                                        </p>
                                                    </div>
                                                )}
                                                {template.is_automatic && (
                                                    <div className="flex flex-wrap items-center gap-3 px-3 py-2.5 rounded-lg bg-theme-bg-primary border border-theme-border/50">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                                                            <select value={template.trigger_event || 'before_dropoff'}
                                                                onChange={e => handleUpdateAutomation(template.id, 'trigger_event', e.target.value)}
                                                                className="text-xs bg-transparent border-none text-theme-text-secondary focus:outline-none cursor-pointer">
                                                                {Object.entries(TRIGGER_LABELS).map(([k, v]) => (
                                                                    <option key={k} value={k}>{v}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                        <span className="text-theme-text-muted text-xs">―</span>
                                                        <div className="flex items-center gap-1">
                                                            <input type="number" value={template.trigger_offset_hours || 24}
                                                                onChange={e => handleUpdateAutomation(template.id, 'trigger_offset_hours', parseInt(e.target.value) || 0)}
                                                                className="w-12 text-xs text-center bg-dr7-gold/15 text-dr7-gold font-bold rounded-full px-2 py-1 border-none focus:outline-none" />
                                                            <span className="text-xs text-dr7-gold font-bold">ore</span>
                                                        </div>
                                                        <span className="text-theme-text-muted text-xs">―</span>
                                                        <div className="flex items-center gap-1">
                                                            <select value={template.send_hour ?? ''}
                                                                onChange={e => handleUpdateAutomation(template.id, 'send_hour', e.target.value === '' ? null : parseInt(e.target.value))}
                                                                className="text-xs bg-transparent border-none text-theme-text-secondary focus:outline-none cursor-pointer">
                                                                <option value="">Subito</option>
                                                                {Array.from({ length: 24 }, (_, i) => (
                                                                    <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                        <span className="text-theme-text-muted text-xs">―</span>
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                                                            <select value={template.target_category || 'all'}
                                                                onChange={e => handleUpdateAutomation(template.id, 'target_category', e.target.value)}
                                                                className="text-xs bg-transparent border-none text-theme-text-secondary focus:outline-none cursor-pointer">
                                                                {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                                                                    <option key={k} value={k}>{v}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                    </div>
                                                )}

                                                {editingId === template.id ? (
                                                    <div className="space-y-3">
                                                        <div>
                                                            <label className="block text-xs font-medium text-theme-text-primary mb-1">Titolo</label>
                                                            <input
                                                                type="text"
                                                                value={editLabel}
                                                                onChange={e => setEditLabel(e.target.value)}
                                                                placeholder="Titolo del messaggio"
                                                                className="w-full px-4 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/50 text-sm"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="block text-xs font-medium text-theme-text-primary mb-1">Messaggio</label>
                                                            <textarea
                                                                value={editBody}
                                                                onChange={e => setEditBody(e.target.value)}
                                                                rows={6}
                                                                placeholder="Buongiorno {nome},&#10;&#10;..."
                                                                className="w-full px-4 py-2.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/50 font-mono text-sm"
                                                            />
                                                            <TemplateVarLegend />
                            <p className="text-[11px] text-theme-text-muted mt-1.5">Esempio rapido: <code className="bg-theme-bg-tertiary px-1.5 py-0.5 rounded text-dr7-gold">{"{nome}"}</code> verrà sostituito col nome del cliente.</p>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <>
                                                        <pre className="px-4 py-3 rounded-lg bg-theme-bg-primary text-xs text-theme-text-secondary whitespace-pre-wrap max-h-72 overflow-y-auto border border-theme-border">
                                                            {template.message_body}
                                                        </pre>
                                                        {template.include_header === true && (
                                                            <p className="text-[11px] text-amber-400 mt-1">
                                                                Wrapper attivo: header/footer da “Intestazione/Piè di pagina” verranno aggiunti automaticamente.
                                                            </p>
                                                        )}
                                                    </>
                                                )}

                                                <div className="flex gap-2 justify-end">
                                                    {editingId === template.id ? (
                                                        <>
                                                            <button onClick={() => setEditingId(null)}
                                                                className="px-3 py-1.5 rounded-full text-xs font-medium bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover transition-colors">Annulla</button>
                                                            <button onClick={() => handleSaveEdit(template.id)} disabled={saving}
                                                                className="px-3 py-1.5 rounded-full text-xs font-semibold bg-dr7-gold text-white hover:bg-[#0A8FA3] transition-colors disabled:opacity-50">
                                                                {saving ? 'Salvataggio...' : 'Salva'}
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <button onClick={() => { setEditingId(template.id); setEditBody(template.message_body); setEditLabel(template.label) }}
                                                                className="px-3 py-1.5 rounded-full text-xs font-medium bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover transition-colors">Modifica</button>
                                                            <button onClick={() => handleDeleteTemplate(template)}
                                                                className="px-3 py-1.5 rounded-full text-xs font-medium bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors">Elimina</button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </details>
                                    ))}
                </div>
            </div>

            {/* ═══════════ SECTION B: Invia Messaggio Manuale ═══════════ */}
            <details className="border border-theme-border rounded-lg overflow-hidden">
                <summary className="p-4 cursor-pointer hover:bg-theme-bg-hover/30 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-600/20 text-green-400">INVIO</span>
                        <span className="font-medium text-theme-text-primary">Invia Messaggio Manuale</span>
                    </div>
                    <span className="text-xs text-theme-text-muted">Template o testo libero via WhatsApp</span>
                </summary>
                <div className="p-4 border-t border-theme-border space-y-4">

                    <div className="flex gap-2">
                        <button
                            onClick={() => setSendMode('template')}
                            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                                sendMode === 'template'
                                    ? 'bg-dr7-gold text-white'
                                    : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
                            }`}
                        >
                            Da Template
                        </button>
                        <button
                            onClick={() => setSendMode('free')}
                            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                                sendMode === 'free'
                                    ? 'bg-dr7-gold text-white'
                                    : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
                            }`}
                        >
                            Testo Libero
                        </button>
                    </div>

                    {sendMode === 'template' ? (
                        <div>
                            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Seleziona template</label>
                            <select
                                value={selectedTemplateId}
                                onChange={e => setSelectedTemplateId(e.target.value)}
                                className="w-full px-4 py-2.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/50"
                            >
                                <option value="">-- Scegli un messaggio --</option>
                                {templates.filter(t => t.message_body).map(t => (
                                    <option key={t.id} value={t.id}>{t.label}</option>
                                ))}
                            </select>
                        </div>
                    ) : (
                        <div>
                            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Messaggio</label>
                            <textarea
                                value={freeText}
                                onChange={e => setFreeText(e.target.value)}
                                rows={5}
                                placeholder="Buongiorno {nome},&#10;&#10;..."
                                className="w-full px-4 py-2.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/50 font-mono text-sm"
                            />
                            <TemplateVarLegend />
                            <p className="text-[11px] text-theme-text-muted mt-1.5">Esempio rapido: <code className="bg-theme-bg-tertiary px-1.5 py-0.5 rounded text-dr7-gold">{"{nome}"}</code> verrà sostituito col nome del cliente.</p>
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-theme-text-secondary mb-1">Destinatari</label>

                        {selectedCustomers.length > 0 && (
                            <div className="flex flex-wrap gap-2 mb-2">
                                {selectedCustomers.map(c => (
                                    <span
                                        key={c.id}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-dr7-gold/20 text-dr7-gold border border-dr7-gold/30"
                                    >
                                        {c.full_name}
                                        <button
                                            onClick={() => removeCustomer(c.id)}
                                            className="hover:text-red-400 transition-colors text-lg leading-none"
                                        >
                                            &times;
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}

                        <div ref={searchRef} className="relative">
                            <input
                                type="text"
                                value={customerSearch}
                                onChange={e => searchCustomers(e.target.value)}
                                onFocus={() => { if (customerResults.length > 0) setShowResults(true) }}
                                placeholder="Cerca per nome o telefono..."
                                className="w-full px-4 py-2.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/50"
                            />
                            {searching && (
                                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-theme-text-muted text-sm">
                                    Ricerca...
                                </div>
                            )}

                            {showResults && customerResults.length > 0 && (
                                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-theme-bg-secondary border border-theme-border rounded-lg shadow-xl max-h-60 overflow-y-auto">
                                    {customerResults.map(c => (
                                        <button
                                            key={c.id}
                                            onClick={() => addCustomer(c)}
                                            className="w-full text-left px-4 py-2.5 hover:bg-theme-bg-hover transition-colors border-b border-theme-border last:border-0"
                                        >
                                            <span className="font-medium text-theme-text-primary">{c.full_name}</span>
                                            <span className="text-theme-text-muted text-sm ml-2">{c.telefono}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                            {showResults && customerSearch.length >= 2 && customerResults.length === 0 && !searching && (
                                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-theme-bg-secondary border border-theme-border rounded-lg shadow-xl px-4 py-3 text-theme-text-muted text-sm">
                                    Nessun cliente trovato con numero di telefono
                                </div>
                            )}
                        </div>
                    </div>

                    {getMessageText() && (
                        <div>
                            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Anteprima</label>
                            <pre className="px-4 py-3 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-secondary text-sm whitespace-pre-wrap font-sans">
                                {getPreviewText()}
                            </pre>
                        </div>
                    )}

                    <div className="flex items-center gap-4">
                        <button
                            onClick={handleSend}
                            disabled={sending || !getMessageText().trim() || selectedCustomers.length === 0}
                            className="px-6 py-2.5 rounded-full font-semibold text-sm transition-colors bg-dr7-gold text-white hover:bg-[#0A8FA3] disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {sending
                                ? `Invio ${sendProgress.current}/${sendProgress.total}...`
                                : `Invia WhatsApp (${selectedCustomers.length})`
                            }
                        </button>
                        {sending && (
                            <span className="text-theme-text-muted text-sm">
                                Invio in corso... Non chiudere la pagina
                            </span>
                        )}
                    </div>
                </div>
            </details>

            {/* ═══════════ SECTION C: Storico Messaggi Inviati ═══════════ */}
            <div className="space-y-3">
                <div className="flex justify-between items-center">
                    <h3 className="text-lg font-bold text-theme-text-primary">Storico Messaggi Inviati</h3>
                    <button
                        onClick={loadSentLogs}
                        className="px-4 py-2 rounded-full text-sm font-medium bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover transition-colors"
                    >
                        Aggiorna
                    </button>
                </div>

                {logsLoading ? (
                    <div className="text-center py-6 text-dr7-gold">Caricamento storico...</div>
                ) : sentLogs.length === 0 ? (
                    <div className="text-center py-8 text-theme-text-muted border border-theme-border rounded-lg">
                        Nessun messaggio inviato ancora
                    </div>
                ) : (
                    <div className="space-y-2">
                        {sentLogs.map(log => (
                            <details key={log.id} className="border border-theme-border rounded-lg overflow-hidden">
                                <summary className="p-3 cursor-pointer hover:bg-theme-bg-hover/30 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-600/20 text-green-400">
                                            {log.status === 'sent' ? 'Inviato' : log.status}
                                        </span>
                                        {log.template_label && (
                                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-600/20 text-blue-400">
                                                {log.template_label}
                                            </span>
                                        )}
                                        <span className="font-medium text-theme-text-primary text-sm">{log.customer_name}</span>
                                        <span className="text-xs text-theme-text-muted font-mono">{log.customer_phone}</span>
                                    </div>
                                    <span className="text-xs text-theme-text-muted">
                                        {new Date(log.sent_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </summary>
                                <pre className="p-4 bg-theme-bg-primary text-xs text-theme-text-secondary whitespace-pre-wrap border-t border-theme-border max-h-72 overflow-y-auto">
                                    {log.message_text}
                                </pre>
                            </details>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
