/**
 * EMTN — controllo incrociato con il gestionale DR7 (workflow, fase 3).
 *
 * EMTN vive nello stesso database del gestionale: prenotazione, contratto,
 * veicolo, date, fatture, danni, penali e pagamenti si confrontano con quello
 * che l'AI ha letto nei documenti. Il risultato e' una lista di controlli
 * (ok / diverso / non trovato / informativo) che finisce nella coda di
 * approvazione. Un controllo "diverso" porta la pratica in revisione manuale
 * obbligatoria; nessun controllo decide da solo.
 *
 * Come ricorda la specifica: una fattura prova l'esistenza del documento
 * contabile, non la fondatezza del credito; una voce "danno" nel gestionale
 * non prova l'attribuzione del danno al cliente.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import type { ControlloGestionale, RisultatoAnalisi } from '../../../src/utils/emtnMobilityRisk'

const soloAlfanumerico = (v: unknown) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/** Data AAAA-MM-GG da "GG/MM/AAAA", ISO o timestamp, nel fuso di Roma. */
export function giornoRoma(v: unknown): string | null {
    const s = String(v || '').trim()
    if (!s) return null
    const it = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/)
    if (it) return `${it[3]}-${it[2].padStart(2, '0')}-${it[1].padStart(2, '0')}`
    const t = Date.parse(s)
    if (!Number.isFinite(t)) return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
    return new Date(t).toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
}

const euro = (n: number) => `€${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

type Booking = {
    id: string
    vehicle_name: string | null
    vehicle_plate: string | null
    pickup_date: string | null
    dropoff_date: string | null
    price_total: number | null
    amount_paid: number | null
    payment_status: string | null
    status: string | null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    booking_details: any
}

const COLONNE = 'id, vehicle_name, vehicle_plate, pickup_date, dropoff_date, price_total, amount_paid, payment_status, status, booking_details'

type Profilo = { id: string; user_id: string | null; email: string | null; nome: string | null; cognome: string | null }

/**
 * Schede cliente e prenotazioni DR7 di un codice fiscale. Stessi collegamenti
 * di emtn-search: id scheda, user_id, customer_id nel JSON, email.
 */
export async function prenotazioniCliente(sb: SupabaseClient, codiceFiscale: string | null): Promise<{ profili: Profilo[]; prenotazioni: Booking[] }> {
    const cf = soloAlfanumerico(codiceFiscale)
    if (!cf) return { profili: [], prenotazioni: [] }
    const { data } = await sb.from('customers_extended').select('id, user_id, email, nome, cognome').eq('codice_fiscale', cf)
    const profili = (data || []) as Profilo[]
    const ids = [...new Set(profili.flatMap(x => [x.id, x.user_id]).filter(Boolean))] as string[]
    const emails = [...new Set(profili.map(x => String(x.email || '').toLowerCase()).filter(e => e.includes('@') && !/[,()]/.test(e)))]
    const filtri = [
        ...(ids.length ? [`user_id.in.(${ids.join(',')})`, `booking_details->>customer_id.in.(${ids.join(',')})`] : []),
        ...emails.map(e => `customer_email.ilike.${e}`),
        `booking_details->>codice_fiscale.eq.${cf}`,
        `booking_details->customer->>codice_fiscale.eq.${cf}`,
    ]
    const { data: righe } = await sb.from('bookings').select(COLONNE).or(filtri.join(',')).order('pickup_date', { ascending: false }).limit(200)
    const prenotazioni = ((righe || []) as Booking[]).filter(b => !['cancelled', 'annullata'].includes(String(b.status || '').toLowerCase()))
    return { profili, prenotazioni }
}

/** Bucket e percorso da un URL dello storage Supabase (pubblico o firmato). */
export function percorsoDaUrlStorage(url: unknown): { bucket: string; path: string } | null {
    const m = String(url || '').match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/([^?]+)/)
    return m ? { bucket: m[1], path: decodeURIComponent(m[2]) } : null
}

export interface DocumentoGestionale {
    nome: string
    tipo: 'contratto' | 'fattura' | 'estratto'
    descrizione: string
    bucket?: string
    path?: string
}

/**
 * Documenti che DR7 ha gia' per una prenotazione: il contratto (firmato se
 * c'e') e le fatture. L'estratto del gestionale si genera a parte.
 */
export async function documentiPrenotazione(sb: SupabaseClient, bookingId: string): Promise<DocumentoGestionale[]> {
    const out: DocumentoGestionale[] = []
    const { data: contratti } = await sb.from('contracts').select('contract_number, pdf_url, signed_pdf_url, created_at').eq('booking_id', bookingId).order('created_at', { ascending: false }).limit(1)
    const c = (contratti || [])[0]
    const pc = c ? (percorsoDaUrlStorage(c.signed_pdf_url) || percorsoDaUrlStorage(c.pdf_url)) : null
    if (c && pc) out.push({ nome: `contratto_${c.contract_number}${c.signed_pdf_url ? '_firmato' : ''}.pdf`, tipo: 'contratto', descrizione: `Contratto ${c.contract_number}${c.signed_pdf_url ? ' (firmato)' : ''}`, ...pc })
    const { data: fatture } = await sb.from('fatture').select('numero_fattura, importo_totale, tipo_fattura, stato, pdf_url').eq('booking_id', bookingId).order('created_at')
    for (const f of fatture || []) {
        const pf = percorsoDaUrlStorage(f.pdf_url)
        if (pf) out.push({ nome: `fattura_${f.numero_fattura}.pdf`, tipo: 'fattura', descrizione: `Fattura ${f.numero_fattura} ${euro(Number(f.importo_totale || 0))} (${f.tipo_fattura || 'standard'})`, ...pf })
    }
    out.push({ nome: `estratto_gestionale_${bookingId.slice(0, 8).toUpperCase()}.pdf`, tipo: 'estratto', descrizione: 'Estratto del gestionale: date, km, danni, penali, pagamenti, estensioni' })
    return out
}

/** Testo leggibile dal font standard del PDF (WinAnsi): niente simboli esotici. */
const perPdf = (t: string) => t.replace(/[→]/g, '->').replace(/[^\x20-\x7E\u00A0-\u00FF€]/g, '')

/**
 * Estratto del gestionale per l'analisi: cio' che DR7 ha registrato sulla
 * prenotazione, in un PDF che l'AI legge insieme agli altri documenti.
 */
export async function estrattoGestionalePdf(sb: SupabaseClient, bookingId: string): Promise<Buffer | null> {
    const { data } = await sb.from('bookings').select(COLONNE + ', customer_name, customer_email').eq('id', bookingId).maybeSingle()
    if (!data) return null
    const b = data as unknown as Booking & { customer_name: string | null; customer_email: string | null }
    const bd = b.booking_details || {}
    const ora = (v: string | null) => v ? new Date(v).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : 'n/d'
    const { data: c } = await sb.from('contracts').select('contract_number, signed_pdf_url').eq('booking_id', bookingId).order('created_at', { ascending: false }).limit(1).maybeSingle()
    const { data: fatture } = await sb.from('fatture').select('numero_fattura, data_emissione, importo_totale, tipo_fattura, stato').eq('booking_id', bookingId).order('created_at')
    const voci = (arr: unknown, nome: string) => (Array.isArray(arr) ? arr : []).map((v: { label?: string; total?: number; amount?: number; quantity?: number; paymentStatus?: string; date?: string }) =>
        `  - ${nome}: ${v.label || '-'} · ${euro(Number(v.total ?? Number(v.amount || 0) * Number(v.quantity || 1)))} · ${String(v.paymentStatus || '').toLowerCase() === 'paid' ? 'pagato' : 'non pagato'}${v.date ? ` · ${v.date}` : ''}`)
    const righe = [
        'ESTRATTO DEL GESTIONALE DR7 (dati registrati dall\'operatore)',
        `Prenotazione: DR7-${b.id.slice(0, 8).toUpperCase()}`,
        `Cliente: ${b.customer_name || '-'} (${b.customer_email || '-'})`,
        `Contratto: ${c?.contract_number || 'non presente'}${c?.signed_pdf_url ? ' (firmato)' : ''}`,
        `Veicolo: ${b.vehicle_name || '-'} · Targa: ${b.vehicle_plate || '-'}`,
        `Consegna: ${ora(b.pickup_date)}`,
        `Riconsegna prevista (attuale): ${ora(b.dropoff_date)}`,
        `Km inclusi: ${bd.unlimited_km ? 'illimitati' : (bd.km_limit || 'n/d')}`,
        `Totale noleggio: ${b.price_total != null ? euro(b.price_total / 100) : 'n/d'} · Stato pagamento: ${b.payment_status || 'n/d'}${b.amount_paid != null ? ` · Incassato: ${euro(b.amount_paid / 100)}` : ''}`,
        `Stato prenotazione: ${b.status || 'n/d'}`,
        '',
        'Estensioni:',
        ...((Array.isArray(bd.extension_history) ? bd.extension_history : []).map((e: { previous_dropoff?: string; new_dropoff?: string; additional_amount?: number; payment_status?: string; km_added?: number }) =>
            `  - da ${ora(e.previous_dropoff || null)} a ${ora(e.new_dropoff || null)} · ${euro(Number(e.additional_amount || 0))} · ${e.payment_status || 'n/d'}${e.km_added ? ` · +${e.km_added} km` : ''}`)),
        'Danni registrati:', ...voci(bd.danni, 'Danno'),
        'Penali registrate:', ...voci(bd.penalties, 'Penale'),
        '',
        'Fatture / documenti contabili:',
        ...((fatture || []).map(f => `  - ${f.numero_fattura} del ${String(f.data_emissione || '').split('-').reverse().join('/')} · ${euro(Number(f.importo_totale || 0))} · ${f.tipo_fattura || 'standard'} · ${f.stato}`)),
        '',
        'Nota: la presenza di una fattura o di una voce nel gestionale non prova da sola la fondatezza del credito ne\' l\'attribuzione del danno.',
    ]
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    let page = doc.addPage([595, 842])
    let y = 800
    for (const r of righe) {
        // a capo semplice sulle righe lunghe
        const parti = perPdf(r).match(/.{1,95}(\s|$)/g) || ['']
        for (const parte of parti) {
            if (y < 50) { page = doc.addPage([595, 842]); y = 800 }
            page.drawText(parte.trimEnd(), { x: 40, y, size: 10, font })
            y -= 15
        }
    }
    return Buffer.from(await doc.save())
}

export async function controlloGestionale(
    sb: SupabaseClient,
    codiceFiscale: string | null,
    r: RisultatoAnalisi,
): Promise<{ controlli: ControlloGestionale[]; bookingId: string | null }> {
    const controlli: ControlloGestionale[] = []
    const p = r.pratica
    const cf = soloAlfanumerico(codiceFiscale)

    // Cliente e codice fiscale
    const cfDoc = soloAlfanumerico(p.codice_fiscale)
    if (cfDoc && cf) {
        controlli.push({ controllo: 'Codice fiscale', esito: cfDoc === cf ? 'ok' : 'diverso', documento: cfDoc, gestionale: cf })
    }
    const { profili, prenotazioni } = await prenotazioniCliente(sb, cf)
    controlli.push({
        controllo: 'Cliente nel gestionale',
        esito: (profili || []).length ? 'ok' : 'non_trovato',
        gestionale: (profili || [])[0] ? `${profili![0].nome || ''} ${profili![0].cognome || ''}`.trim() : null,
    })

    // Prenotazione: prima dal numero di contratto, poi da targa + data.
    let booking: Booking | null = null
    let contrattoGestionale: string | null = null
    const numeroDoc = soloAlfanumerico(p.numero_contratto)
    if (numeroDoc) {
        const { data: contratti } = await sb.from('contracts').select('contract_number, booking_id').not('booking_id', 'is', null).ilike('contract_number', `%${numeroDoc.slice(-6)}%`).limit(20)
        const trovato = (contratti || []).find(c => soloAlfanumerico(c.contract_number) === numeroDoc)
        if (trovato) {
            contrattoGestionale = trovato.contract_number
            const { data } = await sb.from('bookings').select(COLONNE).eq('id', trovato.booking_id).maybeSingle()
            booking = (data as Booking) || null
        }
    }
    if (!booking && prenotazioni.length) {
        const targa = soloAlfanumerico(p.targa)
        const inizio = giornoRoma(p.inizio_noleggio || p.consegna)
        booking = prenotazioni.find(b => (!targa || soloAlfanumerico(b.vehicle_plate) === targa) && (!inizio || giornoRoma(b.pickup_date) === inizio)) || null
    }
    controlli.push({ controllo: 'Prenotazione nel gestionale', esito: booking ? 'ok' : 'non_trovato', gestionale: booking ? `DR7-${booking.id.slice(0, 8).toUpperCase()}` : null })
    if (!booking) return { controlli, bookingId: null }

    if (!contrattoGestionale) {
        const { data: c } = await sb.from('contracts').select('contract_number').eq('booking_id', booking.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
        contrattoGestionale = c?.contract_number || null
    }
    if (numeroDoc || contrattoGestionale) {
        controlli.push({
            controllo: 'Numero contratto',
            esito: !contrattoGestionale ? 'non_trovato' : !numeroDoc ? 'info' : soloAlfanumerico(contrattoGestionale) === numeroDoc ? 'ok' : 'diverso',
            documento: p.numero_contratto, gestionale: contrattoGestionale,
        })
    }

    const confronta = (controllo: string, doc: string | null, gest: string | null, uguali: (a: string, b: string) => boolean) => {
        if (!doc && !gest) return
        controlli.push({ controllo, esito: !doc || !gest ? 'info' : uguali(doc, gest) ? 'ok' : 'diverso', documento: doc, gestionale: gest })
    }
    confronta('Targa', p.targa, booking.vehicle_plate, (a, b) => soloAlfanumerico(a) === soloAlfanumerico(b))
    confronta('Veicolo', p.veicolo, booking.vehicle_name, () => true)
    const riga = controlli[controlli.length - 1]
    if (riga?.controllo === 'Veicolo') riga.esito = 'info'
    confronta('Inizio noleggio', giornoRoma(p.inizio_noleggio || p.consegna), giornoRoma(booking.pickup_date), (a, b) => a === b)
    confronta('Riconsegna prevista', giornoRoma(p.riconsegna_prevista || p.fine_noleggio), giornoRoma(booking.dropoff_date), (a, b) => a === b)

    const bd = booking.booking_details || {}
    if (booking.price_total != null) controlli.push({ controllo: 'Importo noleggio', esito: 'info', gestionale: euro(booking.price_total / 100) })
    const estensioni = Array.isArray(bd.extension_history) ? bd.extension_history : []
    if (estensioni.length) {
        controlli.push({ controllo: 'Estensioni', esito: 'info', gestionale: estensioni.map((e: { additional_amount?: number; payment_status?: string }) => `${euro(Number(e.additional_amount || 0))} (${e.payment_status || 'n/d'})`).join(', ') })
    }
    if (bd.km_limit) controlli.push({ controllo: 'Chilometraggio incluso', esito: 'info', gestionale: String(bd.km_limit) })

    const voci = (arr: unknown, nome: string) => {
        const lista = Array.isArray(arr) ? arr as { label?: string; total?: number; amount?: number; quantity?: number; paymentStatus?: string }[] : []
        if (!lista.length) return
        controlli.push({
            controllo: `${nome} registrati nel gestionale`, esito: 'info',
            gestionale: lista.map(v => `${v.label || nome}: ${euro(Number(v.total ?? Number(v.amount || 0) * Number(v.quantity || 1)))}${String(v.paymentStatus || '').toLowerCase() === 'paid' ? ' (pagato)' : ' (non pagato)'}`).join('; '),
        })
    }
    voci(bd.danni, 'Danni')
    voci(bd.penalties, 'Penali')

    const { data: fatture } = await sb.from('fatture').select('numero_fattura, data_emissione, importo_totale, stato, tipo_fattura').eq('booking_id', booking.id).order('created_at')
    controlli.push({
        controllo: 'Fatture / documenti contabili',
        esito: (fatture || []).length ? 'info' : 'non_trovato',
        gestionale: (fatture || []).map(f => `${f.numero_fattura} del ${String(f.data_emissione || '').split('-').reverse().join('/')} ${euro(Number(f.importo_totale || 0))} (${f.tipo_fattura || 'standard'}, ${f.stato})`).join('; ') || null,
    })
    controlli.push({
        controllo: 'Pagamenti noleggio', esito: 'info',
        gestionale: `${booking.payment_status || 'n/d'}${booking.amount_paid != null ? `, incassati ${euro(booking.amount_paid / 100)}` : ''}`,
    })

    return { controlli, bookingId: booking.id }
}
