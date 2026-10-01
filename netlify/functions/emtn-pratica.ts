/**
 * EMTN — POST /emtn-pratica  { azione, ... }
 *
 * Pratica EMTN secondo il "Workflow definitivo" (28/09/2026):
 *   crea            { clientId, posizioneId? }  apre la pratica (documenti poi via emtn-analisi-documento)
 *   stato           { analisiId }               stato dell'analisi AI e risultato
 *   invia           { analisiId, risultato, emailCliente? }
 *                   l'operatore conferma i dati (anche modificati): la posizione va in
 *                   CODA APPROVAZIONI, email al cliente, WhatsApp a DR7. Senza email del
 *                   cliente risponde 409 { serveEmail: true } e lo schermo la chiede.
 *   coda            {}                           coda approvazioni (solo direzione)
 *   decisione       { posizioneId, decisione, nota?, risultato? }  (solo direzione)
 *                   approva | integrazione | rettifica | sospendi | rifiuta | legale
 *   posizioni       { clientId }                 posizioni del cliente
 *   mie             {}                           tutte le posizioni dell'azienda (I miei eventi) + coda direzione
 *   risposta_cliente{ posizioneId, testo }       risposta/contestazione del cliente: riapre la verifica
 *   documento       { posizioneId|analisiId, path }  link temporaneo a un documento (area protetta)
 *
 * Nessuna posizione diventa visibile alla rete prima della decisione
 * "approva" (o "rettifica") della direzione. Ogni passaggio resta in
 * emtn_posizioni_storico, senza cancellare le versioni precedenti.
 */
import { Handler } from '@netlify/functions'
import { requireAuth } from './require-auth'
import { audit, clientIp, getServiceSupabase, jsonResponse } from './utils/emtn'
import { userHasRole } from './utils/adminRoles'
import { emailAlCliente, whatsappApprovazione, operatoreSegnalante } from './utils/emtnNotifiche'
import { prenotazioniCliente, documentiPrenotazione, estrattoGestionalePdf } from './utils/emtnGestionale'
import crypto from 'crypto'
import { percorsoStorage } from '../../src/utils/percorsoStorage'
import {
    normalizzaRisultato, motiviRevisioneManuale, categoriaEMTN, etichettaStato, DECISIONI_EMTN,
    type RisultatoAnalisi, type ControlloGestionale,
} from '../../src/utils/emtnMobilityRisk'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const dataIt = (v: unknown) => {
    const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v || '')
}
const euro = (n: number) => `€${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Quello che la rete vede di una posizione approvata: niente documenti, niente dati legali. */
function versionePubblica(r: Pick<RisultatoAnalisi, 'titolo' | 'report' | 'eventi' | 'stato_posizione'>) {
    return {
        titolo: r.titolo,
        report: r.report,
        stato: r.stato_posizione,
        eventi: r.eventi.map(e => ({
            codice: e.codice,
            categoria: categoriaEMTN(e.codice)?.label || String(e.codice),
            stato: e.stato,
            data_evento: e.dati.data_evento ?? null,
            importo_dovuto: e.dati.importo_dovuto ?? e.dati.importo_richiesto ?? null,
            importo_pagato: e.dati.importo_pagato ?? null,
            importo_residuo: e.dati.importo_residuo ?? null,
            ritardo: e.dati.ritardo ?? null,
        })),
        aggiornato_at: new Date().toISOString(),
    }
}

export const handler: Handler = async (event) => {
    const origin = event.headers.origin || event.headers.Origin
    if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {}, origin)
    if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' }, origin)
    const { user, error: authErr } = await requireAuth(event)
    if (authErr) return authErr
    const operatorId = user!.id
    const operatorEmail = user!.email
    const sb = getServiceSupabase()
    const ip = clientIp(event.headers as Record<string, string | undefined>)
    const ua = event.headers['user-agent'] || null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (() => { try { return JSON.parse(event.body || '{}') } catch { return null } })() as any
    if (!body) return jsonResponse(400, { error: 'JSON body invalido' }, origin)
    const azione = String(body.azione || '')

    const storico = (posizioneId: string, azioneStorico: string, extra: Record<string, unknown> = {}) =>
        sb.from('emtn_posizioni_storico').insert({ posizione_id: posizioneId, azione: azioneStorico, operatore_id: operatorId, operatore_email: operatorEmail ?? null, ...extra })

    // ── crea ────────────────────────────────────────────────
    if (azione === 'crea') {
        const clientId = String(body.clientId || '').trim()
        if (!clientId) return jsonResponse(400, { error: 'clientId obbligatorio' }, origin)
        const posizioneId = body.posizioneId ? String(body.posizioneId) : null
        if (posizioneId) {
            const { data: pos } = await sb.from('emtn_posizioni').select('id, client_id').eq('id', posizioneId).maybeSingle()
            if (!pos || pos.client_id !== clientId) return jsonResponse(404, { error: 'Posizione non trovata per questo cliente' }, origin)
        }
        const { data, error } = await sb.from('emtn_analisi')
            .insert({ client_id: clientId, posizione_id: posizioneId, created_by: operatorId, created_by_email: operatorEmail ?? null })
            .select('id').single()
        if (error || !data) return jsonResponse(500, { error: 'Apertura pratica fallita' }, origin)
        await audit(sb, { operatorId, operatorEmail, clientId, action: 'REPORT_EVENT', success: true, ip, userAgent: ua, metadata: { analisi_id: data.id, fase: 'apertura_pratica', posizione_id: posizioneId } })
        return jsonResponse(201, { analisiId: data.id }, origin)
    }

    // ── noleggi del cliente con i documenti che DR7 ha gia' ──
    // Come CARGOS: niente da caricare a mano, i dati vengono dal gestionale.
    // Preselezionato il noleggio dei danni/penali: quello indicato dallo
    // schermo (voce da cui parte la segnalazione) oppure il primo con danni o
    // penali non pagati, poi il primo con danni o penali.
    if (azione === 'noleggi') {
        const clientId = String(body.clientId || '')
        const { data: cliente } = await sb.from('emtn_clients').select('codice_fiscale').eq('id', clientId).maybeSingle()
        const { prenotazioni } = await prenotazioniCliente(sb, cliente?.codice_fiscale || null)
        type Voce = { label?: string; total?: number; amount?: number; quantity?: number; paymentStatus?: string }
        const importo = (v: Voce) => Number(v.total ?? Number(v.amount || 0) * Number(v.quantity || 1))
        const ids = prenotazioni.slice(0, 40).map(b => b.id)
        const { data: contratti } = ids.length
            ? await sb.from('contracts').select('booking_id, contract_number, created_at').in('booking_id', ids).order('created_at', { ascending: false })
            : { data: [] as { booking_id: string; contract_number: string }[] }
        const noleggi = await Promise.all(prenotazioni.slice(0, 40).map(async b => {
            const bd = b.booking_details || {}
            const danni = (Array.isArray(bd.danni) ? bd.danni : []) as Voce[]
            const penali = (Array.isArray(bd.penalties) ? bd.penalties : []) as Voce[]
            const nonPagato = [...danni, ...penali].filter(v => String(v.paymentStatus || '').toLowerCase() !== 'paid').reduce((a, v) => a + importo(v), 0)
            const documenti = (danni.length || penali.length) ? await documentiPrenotazione(sb, b.id) : null
            // Insoluto sul noleggio stesso (non danni/penali): conta come voce aperta.
            const insoluto = !['paid', 'completed', 'succeeded'].includes(String(b.payment_status || '').toLowerCase()) && Number(b.price_total || 0) > 0
                ? Math.max(0, (Number(b.price_total || 0) - Number(b.amount_paid || 0)) / 100) : 0
            return {
                id: b.id, veicolo: b.vehicle_name, targa: b.vehicle_plate, ritiro: b.pickup_date, riconsegna: b.dropoff_date,
                contratto: (contratti || []).find(c => c.booking_id === b.id)?.contract_number || null,
                insoluto: Math.round(insoluto * 100) / 100,
                danni: danni.map(v => ({ label: v.label || 'Danno', importo: importo(v), pagato: String(v.paymentStatus || '').toLowerCase() === 'paid' })),
                penali: penali.map(v => ({ label: v.label || 'Penale', importo: importo(v), pagato: String(v.paymentStatus || '').toLowerCase() === 'paid' })),
                non_pagato: Math.round(nonPagato * 100) / 100,
                documenti: documenti?.map(d => ({ nome: d.nome, tipo: d.tipo, descrizione: d.descrizione })) || null,
            }
        }))
        const richiesto = body.bookingId ? String(body.bookingId) : null
        const conVoci = noleggi.filter(n => n.danni.length || n.penali.length)
        const suggerito = (richiesto && noleggi.some(n => n.id === richiesto) ? richiesto : null)
            || conVoci.find(n => n.non_pagato > 0)?.id
            || noleggi.find(n => n.insoluto > 0)?.id
            || conVoci[0]?.id || null
        // Il noleggio suggerito ha sempre la lista documenti, anche senza voci.
        const sel = noleggi.find(n => n.id === suggerito)
        if (sel && !sel.documenti) sel.documenti = (await documentiPrenotazione(sb, sel.id)).map(d => ({ nome: d.nome, tipo: d.tipo, descrizione: d.descrizione }))
        return jsonResponse(200, { noleggi, suggerito }, origin)
    }

    // ── allega i documenti del gestionale alla pratica ──────
    if (azione === 'allega_gestionale') {
        const analisiId = String(body.analisiId || '')
        const bookingId = String(body.bookingId || '')
        const escludi = new Set<string>(Array.isArray(body.escludi) ? body.escludi.map(String) : [])
        const { data: analisi } = await sb.from('emtn_analisi').select('id, client_id, documenti, created_by, stato').eq('id', analisiId).maybeSingle()
        if (!analisi || analisi.created_by !== operatorId) return jsonResponse(404, { error: 'Pratica non trovata' }, origin)
        if (analisi.stato === 'in_corso' || analisi.stato === 'inviata') return jsonResponse(409, { error: 'Pratica gia\' in analisi o inviata' }, origin)
        const { data: cliente } = await sb.from('emtn_clients').select('codice_fiscale').eq('id', analisi.client_id).maybeSingle()
        const { prenotazioni } = await prenotazioniCliente(sb, cliente?.codice_fiscale || null)
        if (!prenotazioni.some(b => b.id === bookingId)) return jsonResponse(403, { error: 'Il noleggio non appartiene a questo cliente' }, origin)

        const documenti = Array.isArray(analisi.documenti) ? [...analisi.documenti] : []
        const allegati: string[] = []
        const mancanti: string[] = []
        for (const d of await documentiPrenotazione(sb, bookingId)) {
            if (escludi.has(d.nome)) continue
            let dati: Buffer | null = null
            try {
                if (d.tipo === 'estratto') {
                    dati = await estrattoGestionalePdf(sb, bookingId)
                } else if (d.bucket && d.path) {
                    const { data: blob } = await sb.storage.from(d.bucket).download(d.path)
                    dati = blob ? Buffer.from(await blob.arrayBuffer()) : null
                }
            } catch (e) {
                console.error('[emtn-pratica] documento gestionale', d.nome, e)
            }
            if (!dati) { mancanti.push(`${d.descrizione}: file non trovato`); continue }
            const sha256 = crypto.createHash('sha256').update(dati).digest('hex')
            if (documenti.some((x: { sha256?: string }) => x.sha256 === sha256)) continue
            const path = percorsoStorage(`analisi/${analisiId}/${Date.now()}-gestionale-${d.nome}`)
            const { error: upErr } = await sb.storage.from('emtn-documents').upload(path, dati, { contentType: 'application/pdf', upsert: false })
            if (upErr) { mancanti.push(`${d.descrizione}: salvataggio fallito (${upErr.message})`); continue }
            documenti.push({ path, nome: d.nome, mime: 'application/pdf', estensione: 'pdf', size: dati.length, sha256, origine: 'gestionale', caricato_at: new Date().toISOString(), caricato_da: operatorEmail ?? null })
            allegati.push(d.nome)
        }
        await sb.from('emtn_analisi').update({ documenti, booking_id: bookingId }).eq('id', analisiId)
        return jsonResponse(200, { allegati, mancanti }, origin)
    }

    // ── stato ───────────────────────────────────────────────
    if (azione === 'stato') {
        const { data } = await sb.from('emtn_analisi')
            .select('id, client_id, posizione_id, stato, documenti, risultato, avvisi, controlli_gestionale, booking_id, errore, modello, created_by')
            .eq('id', String(body.analisiId || '')).maybeSingle()
        if (!data || data.created_by !== operatorId) return jsonResponse(404, { error: 'Pratica non trovata' }, origin)
        const documenti = (data.documenti || []).map((d: { nome: string; size: number; sha256: string }) => ({ nome: d.nome, size: d.size, sha256: d.sha256 }))
        let emailCliente: string | null = null
        const { data: cliente } = await sb.from('emtn_clients').select('codice_fiscale').eq('id', data.client_id).maybeSingle()
        if (cliente?.codice_fiscale) {
            const { data: ext } = await sb.from('customers_extended').select('email').eq('codice_fiscale', cliente.codice_fiscale).not('email', 'is', null).limit(1).maybeSingle()
            emailCliente = ext?.email || null
        }
        return jsonResponse(200, { ...data, documenti, emailCliente }, origin)
    }

    // ── invia ───────────────────────────────────────────────
    if (azione === 'invia') {
        const analisiId = String(body.analisiId || '')
        const { data: analisi } = await sb.from('emtn_analisi')
            .select('id, client_id, posizione_id, stato, documenti, risultato, controlli_gestionale, booking_id, created_by')
            .eq('id', analisiId).maybeSingle()
        if (!analisi || analisi.created_by !== operatorId) return jsonResponse(404, { error: 'Pratica non trovata' }, origin)
        if (analisi.stato !== 'pronta') return jsonResponse(409, { error: analisi.stato === 'inviata' ? 'Pratica gia\' inviata' : 'Analisi non ancora pronta' }, origin)

        const { risultato, errori } = normalizzaRisultato(body.risultato ?? analisi.risultato)
        if (errori.length) return jsonResponse(422, { error: 'La segnalazione non puo\' essere inviata', errori }, origin)
        const controlli = (analisi.controlli_gestionale || []) as ControlloGestionale[]
        const motivi = motiviRevisioneManuale(risultato, controlli)
        if (motivi.length) risultato.esito_verifica = 'REVISIONE_MANUALE_OBBLIGATORIA'

        // Email del cliente: dal corpo (popup), dalla posizione, dalla scheda cliente.
        const { data: cliente } = await sb.from('emtn_clients').select('codice_fiscale, nome, cognome').eq('id', analisi.client_id).maybeSingle()
        let email = String(body.emailCliente || '').trim()
        let posPrima: Record<string, unknown> | null = null
        if (analisi.posizione_id) {
            const { data } = await sb.from('emtn_posizioni').select('*').eq('id', analisi.posizione_id).maybeSingle()
            posPrima = data || null
            if (!email && data?.email_cliente) email = data.email_cliente
        }
        if (!email && cliente?.codice_fiscale) {
            const { data: ext } = await sb.from('customers_extended').select('email').eq('codice_fiscale', cliente.codice_fiscale).not('email', 'is', null).limit(1).maybeSingle()
            email = String(ext?.email || '').trim()
        }
        if (!email) return jsonResponse(409, { error: 'Email del cliente mancante', serveEmail: true }, origin)
        if (!EMAIL_RE.test(email)) return jsonResponse(400, { error: 'Email del cliente non valida' }, origin)

        const riga = {
            client_id: analisi.client_id,
            booking_id: analisi.booking_id || (posPrima?.booking_id as string | null) || null,
            stato: risultato.stato_posizione,
            titolo: risultato.titolo,
            report: risultato.report,
            eventi: risultato.eventi,
            informazioni_legali: risultato.informazioni_legali,
            revisione_legale: risultato.informazioni_legali.length > 0,
            pratica: risultato.pratica,
            documenti: [...((posPrima?.documenti as unknown[]) || []), ...(analisi.documenti || [])],
            incongruenze: risultato.incongruenze,
            esito_verifica: risultato.esito_verifica,
            controlli_gestionale: controlli,
            motivi_revisione: motivi,
            email_cliente: email,
            in_approvazione: true,
            decisione: null,
            inviata_at: new Date().toISOString(),
            inviata_da: operatorEmail ?? null,
            updated_at: new Date().toISOString(),
        }
        let posizioneId = analisi.posizione_id as string | null
        if (posizioneId) {
            const { error } = await sb.from('emtn_posizioni').update(riga).eq('id', posizioneId)
            if (error) return jsonResponse(500, { error: 'Aggiornamento posizione fallito' }, origin)
            await storico(posizioneId, 'aggiornata', { analisi_id: analisiId, stato_prima: posPrima?.stato ?? null, stato_dopo: riga.stato, snapshot: { prima: posPrima, dopo: riga } })
        } else {
            const { data, error } = await sb.from('emtn_posizioni').insert({ ...riga, created_by: operatorId, created_by_email: operatorEmail ?? null }).select('id').single()
            if (error || !data) return jsonResponse(500, { error: 'Creazione posizione fallita' }, origin)
            posizioneId = data.id as string
            await storico(posizioneId, 'inviata', { analisi_id: analisiId, stato_dopo: riga.stato, snapshot: { dopo: riga } })
        }
        await sb.from('emtn_analisi').update({ stato: 'inviata', posizione_id: posizioneId }).eq('id', analisiId)

        // Comunicazione al cliente (fase 8) e notifica a DR7 (fase 9).
        const operatore = await operatoreSegnalante(sb)
        const nome = `${cliente?.nome || ''} ${cliente?.cognome || ''}`.trim() || risultato.pratica.cliente || 'Cliente'
        const importi = risultato.eventi.map(e => Number(e.dati.importo_residuo ?? e.dati.importo_dovuto ?? e.dati.importo_richiesto)).filter(n => Number.isFinite(n) && n > 0)
        const variabili = {
            nome,
            operatore_segnalante: operatore.nome,
            numero_contratto: risultato.pratica.numero_contratto || 'non indicato',
            veicolo: risultato.pratica.veicolo || '',
            targa: risultato.pratica.targa ? `(${risultato.pratica.targa})` : '',
            data_evento: dataIt(risultato.eventi.find(e => e.dati.data_evento)?.dati.data_evento) || 'non indicata',
            tipologia: risultato.eventi.map(e => categoriaEMTN(e.codice)?.label).filter(Boolean).join(', '),
            descrizione: risultato.report,
            importo: importi.length ? euro(Math.max(...importi)) : 'nessun importo',
            stato: etichettaStato(risultato.stato_posizione),
            email_contatto: operatore.email,
            titolo: risultato.titolo,
            report: risultato.report,
            data: dataIt(new Date().toISOString()),
        }
        const esitoEmail = await emailAlCliente(email, variabili)
        await storico(posizioneId, esitoEmail.ok ? 'email_cliente' : 'email_non_inviata', {
            analisi_id: analisiId,
            nota: esitoEmail.ok ? null : esitoEmail.errore,
            snapshot: { canale: 'email', destinatario: email, oggetto: esitoEmail.oggetto || null, esito: esitoEmail.ok ? 'inviata' : 'non inviata', data: new Date().toISOString() },
        })
        const esitoWa = await whatsappApprovazione({ nome, titolo: risultato.titolo, stato: variabili.stato, operatore: operatorEmail || '', email_cliente: email })
        await storico(posizioneId, 'notifica_approvazione', { nota: esitoWa.ok ? null : esitoWa.errore, snapshot: { canale: 'whatsapp', esito: esitoWa.ok ? 'inviata' : 'non inviata' } })

        await audit(sb, { operatorId, operatorEmail, clientId: analisi.client_id, action: 'REPORT_EVENT', success: true, ip, userAgent: ua, metadata: { fase: 'invio_approvazione', posizione_id: posizioneId, esito_verifica: risultato.esito_verifica, motivi: motivi.length } })
        return jsonResponse(200, { posizioneId, emailInviata: esitoEmail.ok, erroreEmail: esitoEmail.errore || null, notificaDr7: esitoWa.ok, motiviRevisione: motivi }, origin)
    }

    // ── posizioni del cliente ───────────────────────────────
    if (azione === 'posizioni') {
        const clientId = String(body.clientId || '')
        const { data } = await sb.from('emtn_posizioni')
            .select('id, stato, titolo, report, eventi, pratica, esito_verifica, in_approvazione, pubblicata, pubblicato, decisione, nota_revisione, revisione_legale, inviata_at, approvata_at, updated_at, created_at')
            .eq('client_id', clientId).order('created_at', { ascending: false })
        return jsonResponse(200, { posizioni: data || [] }, origin)
    }

    // ── I miei eventi: tutte le posizioni dell'azienda ──────
    // 01/10/2026 (Ophelie): ogni operatore vede tutte le pratiche
    // dell'azienda (questa installazione), non solo le proprie.
    // Con il numero della coda approvazioni per la direzione (Alert sistema).
    if (azione === 'mie') {
        const { data, error } = await sb.from('emtn_posizioni')
            .select('id, client_id, stato, titolo, report, eventi, esito_verifica, in_approvazione, pubblicata, decisione, nota_revisione, revisione_legale, inviata_at, inviata_da, approvata_at, approvata_da, updated_at, created_at, emtn_clients(codice_fiscale, nome, cognome)')
            .order('updated_at', { ascending: false })
            .limit(500)
        if (error) return jsonResponse(500, { error: 'Eventi non disponibili' }, origin)
        let codaDirezione: number | null = null
        if (await userHasRole(operatorEmail, 'direzione')) {
            const { count } = await sb.from('emtn_posizioni').select('id', { count: 'exact', head: true }).eq('in_approvazione', true)
            codaDirezione = count ?? 0
        }
        return jsonResponse(200, { posizioni: data || [], codaDirezione }, origin)
    }

    // ── risposta del cliente (fase 12) ──────────────────────
    if (azione === 'risposta_cliente') {
        const posizioneId = String(body.posizioneId || '')
        const testo = String(body.testo || '').trim()
        if (testo.length < 5) return jsonResponse(400, { error: 'Scrivi la risposta del cliente' }, origin)
        const { data: pos } = await sb.from('emtn_posizioni').select('id, stato').eq('id', posizioneId).maybeSingle()
        if (!pos) return jsonResponse(404, { error: 'Posizione non trovata' }, origin)
        await storico(posizioneId, 'risposta_cliente', { nota: testo.slice(0, 4000), stato_prima: pos.stato, stato_dopo: 'IN_REVISIONE' })
        await sb.from('emtn_posizioni').update({ stato: 'IN_REVISIONE', in_approvazione: true, decisione: null, updated_at: new Date().toISOString() }).eq('id', posizioneId)
        return jsonResponse(200, { ok: true }, origin)
    }

    // ── documento: link temporaneo nell'area protetta ───────
    if (azione === 'documento') {
        const path = String(body.path || '')
        const posizioneId = body.posizioneId ? String(body.posizioneId) : null
        const analisiId = body.analisiId ? String(body.analisiId) : null
        let ammesso = false
        if (posizioneId) {
            const { data } = await sb.from('emtn_posizioni').select('documenti, created_by').eq('id', posizioneId).maybeSingle()
            const suo = data?.created_by === operatorId || await userHasRole(operatorEmail, 'direzione')
            ammesso = !!data && suo && (data.documenti || []).some((d: { path: string }) => d.path === path)
        } else if (analisiId) {
            const { data } = await sb.from('emtn_analisi').select('documenti, created_by').eq('id', analisiId).maybeSingle()
            ammesso = !!data && data.created_by === operatorId && (data.documenti || []).some((d: { path: string }) => d.path === path)
        }
        if (!ammesso) return jsonResponse(403, { error: 'Documento non accessibile' }, origin)
        const { data: link } = await sb.storage.from('emtn-documents').createSignedUrl(path, 300)
        return jsonResponse(200, { url: link?.signedUrl || null }, origin)
    }

    // ── da qui: solo direzione (validazione finale EMTN) ────
    if (!(await userHasRole(operatorEmail, 'direzione'))) {
        return jsonResponse(403, { error: 'Solo la direzione EMTN puo\' approvare le segnalazioni' }, origin)
    }

    if (azione === 'coda') {
        const { data } = await sb.from('emtn_posizioni')
            .select('*, emtn_clients(codice_fiscale, nome, cognome)')
            .eq('in_approvazione', true)
            .order('inviata_at', { ascending: true })
        const ids = (data || []).map(p => p.id)
        const { data: risposte } = ids.length
            ? await sb.from('emtn_posizioni_storico').select('posizione_id, nota, created_at').in('posizione_id', ids).eq('azione', 'risposta_cliente').order('created_at')
            : { data: [] as { posizione_id: string; nota: string; created_at: string }[] }
        const coda = (data || []).map(p => ({ ...p, risposte_cliente: (risposte || []).filter(r => r.posizione_id === p.id) }))
        return jsonResponse(200, { coda }, origin)
    }

    if (azione === 'decisione') {
        const posizioneId = String(body.posizioneId || '')
        const decisione = String(body.decisione || '')
        const nota = String(body.nota || '').trim() || null
        if (!DECISIONI_EMTN.some(d => d.id === decisione)) return jsonResponse(400, { error: 'Decisione non valida' }, origin)
        if (['integrazione', 'sospendi', 'rifiuta', 'legale'].includes(decisione) && !nota) {
            return jsonResponse(400, { error: 'Indica la motivazione della decisione' }, origin)
        }
        const { data: pos } = await sb.from('emtn_posizioni').select('*').eq('id', posizioneId).maybeSingle()
        if (!pos) return jsonResponse(404, { error: 'Posizione non trovata' }, origin)

        const ora = new Date().toISOString()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const agg: Record<string, any> = { decisione, decisione_at: ora, decisione_da: operatorEmail ?? null, nota_revisione: nota, updated_at: ora }

        if (decisione === 'approva' || decisione === 'rettifica') {
            const base = decisione === 'rettifica' ? body.risultato : {
                eventi: pos.eventi, titolo: pos.titolo, report: pos.report, stato_posizione: pos.stato,
                informazioni_legali: pos.informazioni_legali, pratica: pos.pratica, documenti: [], esito_verifica: pos.esito_verifica,
            }
            const { risultato, errori } = normalizzaRisultato(base)
            if (errori.length) return jsonResponse(422, { error: 'Non pubblicabile', errori }, origin)
            if (['DA_VERIFICARE', 'IN_REVISIONE'].includes(risultato.stato_posizione)) risultato.stato_posizione = 'VERIFICATO'
            Object.assign(agg, {
                stato: risultato.stato_posizione,
                titolo: risultato.titolo,
                report: risultato.report,
                eventi: risultato.eventi,
                in_approvazione: false,
                pubblicata: true,
                pubblicato: versionePubblica(risultato),
                pubblicata_at: ora,
                approvata_at: ora,
                approvata_da: operatorEmail ?? null,
            })
        } else if (decisione === 'integrazione') {
            Object.assign(agg, { in_approvazione: false, stato: pos.pubblicata ? pos.stato : 'DA_VERIFICARE' })
        } else if (decisione === 'sospendi') {
            Object.assign(agg, { in_approvazione: false, stato: 'IN_REVISIONE' })
        } else if (decisione === 'rifiuta') {
            // Rifiutata: fuori dalla rete. La versione pubblicata resta nello
            // storico ma non e' piu' mostrata come attuale.
            Object.assign(agg, { in_approvazione: false, pubblicata: false, stato: 'ANNULLATO' })
        } else if (decisione === 'legale') {
            Object.assign(agg, { revisione_legale: true })
        }

        const { error } = await sb.from('emtn_posizioni').update(agg).eq('id', posizioneId)
        if (error) return jsonResponse(500, { error: 'Salvataggio decisione fallito' }, origin)
        await storico(posizioneId, decisione === 'approva' || decisione === 'rettifica' ? 'approvata' : decisione, {
            stato_prima: pos.stato, stato_dopo: agg.stato ?? pos.stato, nota,
            snapshot: { decisione, prima: { stato: pos.stato, titolo: pos.titolo, report: pos.report, eventi: pos.eventi }, dopo: agg },
        })
        await audit(sb, { operatorId, operatorEmail, clientId: pos.client_id, action: 'REPORT_EVENT', success: true, ip, userAgent: ua, metadata: { fase: 'decisione', decisione, posizione_id: posizioneId } })
        return jsonResponse(200, { ok: true, stato: agg.stato ?? pos.stato, pubblicata: agg.pubblicata ?? pos.pubblicata }, origin)
    }

    return jsonResponse(400, { error: `Azione sconosciuta: ${azione}` }, origin)
}
