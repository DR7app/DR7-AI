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
    const { data: profili } = cf
        ? await sb.from('customers_extended').select('id, user_id, email, nome, cognome').eq('codice_fiscale', cf)
        : { data: [] as { id: string; user_id: string | null; email: string | null; nome: string | null; cognome: string | null }[] }
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
    if (!booking && (profili || []).length) {
        const ids = [...new Set((profili || []).flatMap(x => [x.id, x.user_id]).filter(Boolean))] as string[]
        const emails = [...new Set((profili || []).map(x => String(x.email || '').toLowerCase()).filter(e => e.includes('@') && !/[,()]/.test(e)))]
        const filtri = [
            ...(ids.length ? [`user_id.in.(${ids.join(',')})`, `booking_details->>customer_id.in.(${ids.join(',')})`] : []),
            ...emails.map(e => `customer_email.ilike.${e}`),
        ]
        if (filtri.length) {
            const { data } = await sb.from('bookings').select(COLONNE).or(filtri.join(',')).order('pickup_date', { ascending: false }).limit(200)
            const lista = (data || []) as Booking[]
            const targa = soloAlfanumerico(p.targa)
            const inizio = giornoRoma(p.inizio_noleggio || p.consegna)
            booking = lista.find(b => (!targa || soloAlfanumerico(b.vehicle_plate) === targa) && (!inizio || giornoRoma(b.pickup_date) === inizio)) || null
        }
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
