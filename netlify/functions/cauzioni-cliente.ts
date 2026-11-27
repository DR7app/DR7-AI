/**
 * cauzioni-cliente — area cliente del sito > "Le mie cauzioni".
 *
 * 27/11/2026 (video di Valerio, confermato dalla direzione). Il cliente vede da
 * solo, senza chiedere:
 *  - le sue cauzioni: importo, come le ha versate, stato, giorno di sblocco;
 *  - i prossimi noleggi: quanta cauzione chiedono, quanta e' gia' coperta da
 *    cauzioni versate, quanto resta da integrare;
 *  - e paga lui l'integrazione con la pre-autorizzazione, la stessa dei link
 *    del gestionale (nexi-create-preauth): fondi bloccati, non incassati.
 *
 * La cauzione gia' versata vale anche per i noleggi successivi: chi ha 2000
 * versati e prenota un'auto da 5000 integra 3000. Il collegamento si scrive in
 * DB (mig. 20261127_cauzione_riutilizzabile): quando l'integrazione risulta
 * versata, la cauzione di origine resta fino alla riconsegna dell'ultima
 * prenotazione coperta (+ i soliti 14 giorni lavorativi).
 *
 * Identita': SOLO l'utente del token. Cauzioni del cliente = scheda cliente
 * con quel user_id, oppure prenotazioni di quell'utente. Mai per email o
 * telefono (vedi caso Stara 05/10: email vuota = cauzioni di un estraneo).
 *
 * GET  -> { cauzioni, prenotazioni, versato }
 * POST { bookingId } -> integrazione: { paymentUrl } oppure { coperta: true }
 */
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { getCorsOrigin } from './cors-headers'
import { handler as creaPreauth } from './nexi-create-preauth'

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const STATI_CHIUSI_PRENOTAZIONE = ['cancelled', 'annullata', 'completed', 'completata', 'rejected', 'rifiutata']
// Opzioni che NON chiedono una cauzione in denaro.
const SENZA_CAUZIONE = ['no_deposit', 'vehicle_deposit']

type Cauzione = {
    id: string
    cliente_id: string
    veicolo_id: string | null
    riferimento_contratto_id: string | null
    importo: number
    metodo: string
    stato: string
    data_restituzione_veicolo: string | null
    scadenza_cauzione: string | null
    data_incasso: string | null
    data_restituzione: string | null
    nexi_transaction_id: string | null
    nexi_order_id: string | null
    prenotazioni_coperte: string[] | null
    integra_cauzioni: string[] | null
    created_at: string
}

type Prenotazione = {
    id: string
    vehicle_id: string | null
    vehicle_name: string | null
    pickup_date: string | null
    dropoff_date: string | null
    status: string | null
    deposit_amount: number | null
    booking_details: Record<string, unknown> | null
    customer_email: string | null
    customer_name: string | null
}

// Stessa lettura del tab Cauzioni e di public.dr7_cauzione_versata().
function versata(c: Cauzione): boolean {
    if (['Restituita', 'Sbloccata', 'Danno'].includes(c.stato)) return false
    if (c.stato === 'Bloccata') return !c.data_incasso
    if (c.stato === 'Incassata') return true
    if (c.metodo === 'preautorizzazione' && c.nexi_transaction_id) return true
    return !!c.data_incasso
}

// Come la vede il cliente.
function statoCliente(c: Cauzione): { codice: string; etichetta: string } {
    if (c.stato === 'Restituita' || c.stato === 'Sbloccata') return { codice: 'restituita', etichetta: 'Restituita' }
    if (c.stato === 'Danno' || (c.stato === 'Bloccata' && c.data_incasso)) return { codice: 'trattenuta', etichetta: 'Trattenuta' }
    if (c.metodo === 'preautorizzazione' && c.nexi_transaction_id) return { codice: 'versata', etichetta: 'Pre-autorizzata (fondi bloccati)' }
    if (versata(c)) return { codice: 'versata', etichetta: 'Versata' }
    return { codice: 'da_versare', etichetta: 'Da versare' }
}

function cauzioneRichiesta(b: Prenotazione): number {
    const d = (b.booking_details || {}) as Record<string, unknown>
    const opz = String(d.depositOption || '')
    if (SENZA_CAUZIONE.includes(opz)) return 0
    const n = Number(b.deposit_amount ?? d.deposit ?? d.deposit_amount ?? 0)
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0
}

async function leggiTutto(userId: string) {
    const { data: schede } = await supabase
        .from('customers_extended').select('id').eq('user_id', userId)
    const clienteIds = (schede || []).map(s => s.id as string)

    const { data: pren } = await supabase
        .from('bookings')
        .select('id, vehicle_id, vehicle_name, pickup_date, dropoff_date, status, deposit_amount, booking_details, customer_email, customer_name')
        .eq('user_id', userId)
        .order('pickup_date', { ascending: false })
        .limit(300)
    const prenotazioni = (pren || []) as Prenotazione[]
    const bookingIds = prenotazioni.map(b => b.id)

    const campi = 'id, cliente_id, veicolo_id, riferimento_contratto_id, importo, metodo, stato, data_restituzione_veicolo, scadenza_cauzione, data_incasso, data_restituzione, nexi_transaction_id, nexi_order_id, prenotazioni_coperte, integra_cauzioni, created_at'
    const righe: Cauzione[] = []
    if (clienteIds.length) {
        const { data } = await supabase.from('cauzioni').select(campi).in('cliente_id', clienteIds)
        righe.push(...((data || []) as Cauzione[]))
    }
    if (bookingIds.length) {
        const { data } = await supabase.from('cauzioni').select(campi).in('riferimento_contratto_id', bookingIds)
        for (const r of (data || []) as Cauzione[]) if (!righe.some(x => x.id === r.id)) righe.push(r)
    }
    righe.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    return { clienteIds, prenotazioni, cauzioni: righe }
}

function riepilogo(prenotazioni: Prenotazione[], cauzioni: Cauzione[]) {
    const versate = cauzioni.filter(versata)
    const totaleVersato = Math.round(versate.reduce((s, c) => s + Number(c.importo || 0), 0) * 100) / 100
    const adesso = Date.now()
    const perId = new Map(prenotazioni.map(b => [b.id, b]))
    const attiva = (x: Prenotazione) => !STATI_CHIUSI_PRENOTAZIONE.includes(String(x.status || '').toLowerCase())
        || ['completed', 'completata'].includes(String(x.status || '').toLowerCase())
    const sovrapposte = (x: Prenotazione, y: Prenotazione) => {
        if (!attiva(x) || !x.pickup_date || !x.dropoff_date || !y.pickup_date || !y.dropoff_date) return false
        return new Date(x.pickup_date).getTime() < new Date(y.dropoff_date).getTime()
            && new Date(y.pickup_date).getTime() < new Date(x.dropoff_date).getTime()
    }
    const prossime = prenotazioni
        .filter(b => !STATI_CHIUSI_PRENOTAZIONE.includes(String(b.status || '').toLowerCase()))
        .filter(b => b.dropoff_date && new Date(b.dropoff_date).getTime() > adesso)
        .map(b => {
            const richiesta = cauzioneRichiesta(b)
            // Una cauzione non copre due auto nello stesso momento: vale per b
            // solo se nessun altro noleggio che gia' copre si sovrappone a b.
            const utili = versate.filter(c => {
                const sue = [c.riferimento_contratto_id, ...(c.prenotazioni_coperte || [])]
                    .filter((id): id is string => !!id && id !== b.id)
                return !sue.some(id => {
                    const altra = perId.get(id)
                    return !!altra && sovrapposte(altra, b)
                })
            })
            const disponibile = Math.round(utili.reduce((s, c) => s + Number(c.importo || 0), 0) * 100) / 100
            const coperta = Math.min(richiesta, disponibile)
            const daIntegrare = Math.max(0, Math.round((richiesta - disponibile) * 100) / 100)
            const collegata = versate.some(c => c.riferimento_contratto_id === b.id || (c.prenotazioni_coperte || []).includes(b.id))
            return { b, richiesta, coperta, daIntegrare, collegata, utili: utili.map(c => c.id) }
        })
        .filter(x => x.richiesta > 0)
    return { versate, totaleVersato, prossime }
}

const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json',
    }
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Metodo non consentito' }) }
    }

    const jwt = String(event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '')
    if (!jwt) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Accedi per vedere le tue cauzioni' }) }
    const { data: ud } = await supabase.auth.getUser(jwt)
    const utente = ud?.user
    if (!utente) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Sessione scaduta: accedi di nuovo' }) }

    try {
        const { clienteIds, prenotazioni, cauzioni } = await leggiTutto(utente.id)
        const { versate, totaleVersato, prossime } = riepilogo(prenotazioni, cauzioni)
        const nomeVeicolo = (id: string | null) => {
            const n = String(prenotazioni.find(b => b.id === id)?.vehicle_name || '').trim()
            return n && !/^\?+$/.test(n) ? n : null
        }
        // Nome dalla flotta quando la prenotazione non lo dice.
        const veicoloIds = [...new Set([...cauzioni.map(c => c.veicolo_id), ...prossime.map(x => x.b.vehicle_id)].filter((v): v is string => !!v))]
        const nomiFlotta = new Map<string, string>()
        if (veicoloIds.length) {
            const { data: vv } = await supabase.from('vehicles').select('id, display_name').in('id', veicoloIds)
            for (const v of (vv || []) as { id: string; display_name: string | null }[]) if (v.display_name) nomiFlotta.set(v.id, v.display_name)
        }

        if (event.httpMethod === 'GET') {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    versato: totaleVersato,
                    cauzioni: cauzioni.map(c => ({
                        id: c.id,
                        importo: Number(c.importo || 0),
                        metodo: c.metodo,
                        stato: statoCliente(c),
                        veicolo: nomeVeicolo(c.riferimento_contratto_id) || (c.veicolo_id ? nomiFlotta.get(c.veicolo_id) || null : null),
                        riconsegna: c.data_restituzione_veicolo,
                        sblocco: c.scadenza_cauzione,
                        restituita_il: c.data_restituzione,
                        noleggi_coperti: (c.prenotazioni_coperte || []).map(id => nomeVeicolo(id)).filter(Boolean),
                    })),
                    prenotazioni: prossime.map(x => ({
                        id: x.b.id,
                        veicolo: nomeVeicolo(x.b.id) || (x.b.vehicle_id ? nomiFlotta.get(x.b.vehicle_id) || null : null),
                        ritiro: x.b.pickup_date,
                        riconsegna: x.b.dropoff_date,
                        richiesta: x.richiesta,
                        coperta: x.coperta,
                        da_integrare: x.daIntegrare,
                        collegata: x.collegata,
                    })),
                }),
            }
        }

        // ── POST: integra o usa la cauzione versata per una prenotazione ──
        const { bookingId } = JSON.parse(event.body || '{}')
        const voce = prossime.find(x => x.b.id === bookingId)
        if (!voce) {
            return { statusCode: 404, headers, body: JSON.stringify({ error: 'Prenotazione non trovata tra i tuoi prossimi noleggi' }) }
        }
        const b = voce.b
        const daAppoggiare = voce.utili.filter(id => versate.find(c => c.id === id)?.riferimento_contratto_id !== b.id)

        // Tutto coperto: si collega e basta, niente da pagare.
        if (voce.daIntegrare <= 0) {
            for (const id of daAppoggiare) {
                const { error } = await supabase.rpc('dr7_cauzione_copri_prenotazione', { p_cauzione_id: id, p_booking_id: b.id })
                if (error) throw new Error(error.message)
            }
            return { statusCode: 200, headers, body: JSON.stringify({ coperta: true }) }
        }

        const clienteId = clienteIds[0]
            || cauzioni.find(c => c.riferimento_contratto_id === b.id)?.cliente_id
            || null
        if (!clienteId) {
            return { statusCode: 409, headers, body: JSON.stringify({ error: 'Profilo cliente non collegato: contatta DR7 per completare la cauzione.' }) }
        }

        // La riga della cauzione di integrazione: quella aperta e non ancora
        // versata di questa prenotazione, altrimenti una nuova. Mai una gia'
        // versata (e' parte del fondo, non va ricaricata).
        const apertaNonVersata = cauzioni.find(c =>
            c.riferimento_contratto_id === b.id && !versata(c)
            && !['Restituita', 'Sbloccata', 'Danno', 'Bloccata', 'Incassata'].includes(c.stato))
        const riconsegna = b.dropoff_date
            ? new Date(b.dropoff_date).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' })
            : new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' })
        let cauzioneId: string
        if (apertaNonVersata) {
            const { error } = await supabase.from('cauzioni').update({
                importo: voce.daIntegrare,
                metodo: 'preautorizzazione',
                integra_cauzioni: daAppoggiare,
            }).eq('id', apertaNonVersata.id)
            if (error) throw new Error(error.message)
            cauzioneId = apertaNonVersata.id
        } else {
            const { data: nuova, error } = await supabase.from('cauzioni').insert({
                cliente_id: clienteId,
                veicolo_id: b.vehicle_id,
                riferimento_contratto_id: b.id,
                data_restituzione_veicolo: riconsegna,
                importo: voce.daIntegrare,
                metodo: 'preautorizzazione',
                stato: 'Attiva',
                integra_cauzioni: daAppoggiare,
                note: daAppoggiare.length
                    ? `Integrazione dal sito: ${voce.richiesta} richiesti, ${voce.coperta} gia' versati`
                    : 'Cauzione versata dal sito (area cliente)',
            }).select('id').single()
            if (error || !nuova) throw new Error(error?.message || 'cauzione non creata')
            cauzioneId = nuova.id as string
        }

        // Stesso link pre-autorizzazione del gestionale.
        const token = process.env.ADMIN_API_TOKEN || ''
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res: any = await creaPreauth({
            httpMethod: 'POST',
            headers: { authorization: `Bearer ${token}`, origin: event.headers.origin || '' },
            body: JSON.stringify({
                cauzioneId,
                bookingId: b.id,
                customerId: clienteId,
                amount: voce.daIntegrare,
                customerEmail: utente.email || b.customer_email || '',
                customerName: b.customer_name || '',
                description: daAppoggiare.length
                    ? `Integrazione cauzione ${b.vehicle_name || ''}`.trim()
                    : `Cauzione ${b.vehicle_name || ''}`.trim(),
                expirationHours: 24,
            }),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any, {} as any, (() => undefined) as any)
        const out = res?.body ? JSON.parse(res.body) : {}
        if (!res || res.statusCode !== 200 || !out.paymentUrl) {
            console.error('[cauzioni-cliente] link non creato:', res?.statusCode, out)
            return { statusCode: 502, headers, body: JSON.stringify({ error: 'Pagamento non disponibile in questo momento, riprova piu\' tardi.' }) }
        }
        return { statusCode: 200, headers, body: JSON.stringify({ paymentUrl: out.paymentUrl, importo: voce.daIntegrare }) }
    } catch (err) {
        console.error('[cauzioni-cliente]', err)
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Errore, riprova piu\' tardi.' }) }
    }
}

export { handler }
