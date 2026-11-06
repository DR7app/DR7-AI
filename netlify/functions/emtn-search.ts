/**
 * EMTN — POST /emtn-search
 *
 * Ricerca per codice fiscale, oppure (22/09/2026, direzione) per cliente
 * ESTERO senza codice fiscale: nome + cognome + data di nascita. Ogni
 * chiamata genera una riga in emtn_access_logs.
 *
 * 22/09/2026 (direzione): niente piu' OTP al cliente. Il report e gli eventi
 * si vedono subito; resta il log di ogni consultazione.
 *
 * Body: { codiceFiscale } oppure { estero: true, nome, cognome, dataNascita,
 *         nazionalita, documentoTipo: 'carta_identita'|'passaporto', documentoNumero }
 * Returns: { client, stats, recentEvents, ... }
 */
import { Handler } from '@netlify/functions'
import { requireAuth } from './require-auth'
import {
    audit,
    clientIp,
    getServiceSupabase,
    isValidCF,
    jsonResponse,
    normalizeCF,
} from './utils/emtn'
import { copiaDellaRete } from './utils/emtnRete'
import { calcolaReportCliente, type ExtRow } from './utils/emtnScoreCliente'
import { salvaScoreClienti } from './utils/emtnScorePersistito'

export const handler: Handler = async (event) => {
    const origin = event.headers.origin || event.headers.Origin
    if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {}, origin)
    if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' }, origin)

    const { user, error: authErr } = await requireAuth(event)
    if (authErr) return authErr
    const operatorId = user!.id
    const operatorEmail = user!.email

    const sb = getServiceSupabase()
    const body = (() => { try { return JSON.parse(event.body || '{}') } catch { return null } })()
    if (!body) return jsonResponse(400, { error: 'JSON body invalido' }, origin)

    const ip = clientIp(event.headers as Record<string, string | undefined>)
    const ua = event.headers['user-agent'] || null

    // Cliente estero: nessun codice fiscale, si riconosce da nome + cognome +
    // data di nascita.
    const estero = body.estero === true
    const nomeE = String(body.nome || '').trim().replace(/\s+/g, ' ')
    const cognomeE = String(body.cognome || '').trim().replace(/\s+/g, ' ')
    const nascitaE = /^\d{4}-\d{2}-\d{2}$/.test(String(body.dataNascita || '')) ? String(body.dataNascita) : ''
    const nazionalitaE = String(body.nazionalita || '').trim().replace(/\s+/g, ' ')
    const docTipoE = body.documentoTipo === 'passaporto' ? 'passaporto' : body.documentoTipo === 'carta_identita' ? 'carta_identita' : ''
    const docNumE = String(body.documentoNumero || '').replace(/\s+/g, '').toUpperCase()
    const cf = estero ? '' : normalizeCF(String(body.codiceFiscale || ''))

    if (estero) {
        if (!nomeE || !cognomeE || !nascitaE || !nazionalitaE || !docTipoE || !docNumE) {
            await audit(sb, { operatorId, operatorEmail, action: 'SEARCH', success: false, ip, userAgent: ua, metadata: { reason: 'estero_incompleto' } })
            return jsonResponse(400, { error: 'Cliente estero: servono nome, cognome, data di nascita, nazionalita\' e documento (tipo e numero)' }, origin)
        }
    } else if (!isValidCF(cf)) {
        await audit(sb, { operatorId, operatorEmail, action: 'SEARCH', success: false, ip, userAgent: ua, metadata: { reason: 'invalid_cf', cf } })
        return jsonResponse(400, { error: 'Codice fiscale mancante o invalido (cliente straniero? usa "Estero")' }, origin)
    }

    // Find or create client. Estero: prima per documento, poi per nome +
    // cognome + data di nascita (stessa persona, documento nuovo o mancante).
    const COLONNE_ESTERO = 'id, codice_fiscale, nome, cognome, data_nascita, created_at, nazionalita, documento_tipo, documento_numero'
    const segnalaMigrazione = (e: { code?: string; message?: string } | null) =>
        !!e && (e.code === '42703' || e.code === 'PGRST204' || /documento_|nazionalita/.test(e.message || ''))
    if (estero) {
        const perDoc = await sb
            .from('emtn_clients')
            .select(COLONNE_ESTERO)
            .eq('documento_tipo', docTipoE)
            .ilike('documento_numero', docNumE)
            .limit(1)
            .maybeSingle()
        if (segnalaMigrazione(perDoc.error)) {
            return jsonResponse(500, { error: 'Clienti esteri non ancora attivi: eseguire in Supabase la migrazione 20260922_emtn_clienti_esteri.sql' }, origin)
        }
        if (perDoc.data) {
            const d = perDoc.data as { nome?: string | null; cognome?: string | null; data_nascita?: string | null }
            const stessaPersona = String(d.nome || '').toLowerCase() === nomeE.toLowerCase()
                && String(d.cognome || '').toLowerCase() === cognomeE.toLowerCase()
                && String(d.data_nascita || '') === nascitaE
            if (!stessaPersona) {
                await audit(sb, { operatorId, operatorEmail, action: 'SEARCH', success: false, ip, userAgent: ua, metadata: { reason: 'documento_di_altra_persona' } })
                return jsonResponse(409, { error: `Questo documento e' gia' registrato su EMTN a nome di ${[d.nome, d.cognome].filter(Boolean).join(' ')} (nato il ${d.data_nascita || 'n/d'}). Controlla i dati.` }, origin)
            }
        }
    }
    const { data: existing } = estero
        ? await sb
            .from('emtn_clients')
            .select(COLONNE_ESTERO)
            .is('codice_fiscale', null)
            .ilike('nome', nomeE)
            .ilike('cognome', cognomeE)
            .eq('data_nascita', nascitaE)
            .limit(1)
            .maybeSingle()
        : await sb
            .from('emtn_clients')
            .select('id, codice_fiscale, nome, cognome, data_nascita, created_at')
            .eq('codice_fiscale', cf)
            .maybeSingle()

    let client = existing
    if (!client) {
        const { data: created, error: insErr } = await sb
            .from('emtn_clients')
            .insert(estero ? {
                codice_fiscale: null,
                nome: nomeE,
                cognome: cognomeE,
                data_nascita: nascitaE,
                nazionalita: nazionalitaE,
                documento_tipo: docTipoE,
                documento_numero: docNumE,
            } : {
                codice_fiscale: cf,
                nome: body.nome ? String(body.nome).trim() : null,
                cognome: body.cognome ? String(body.cognome).trim() : null,
                data_nascita: body.dataNascita || null,
            })
            .select('id, codice_fiscale, nome, cognome, data_nascita, created_at')
            .single()
        if (insErr) {
            await audit(sb, { operatorId, operatorEmail, action: 'SEARCH', success: false, ip, userAgent: ua, metadata: { reason: 'insert_failed', error: insErr.message, details: insErr.details, hint: insErr.hint, code: insErr.code } })
            // Espone il vero motivo (RLS, CHECK constraint, NOT NULL, ecc.)
            // cosi\' chi riceve l'errore puo\' agire invece di vedere un
            // generico "Inserimento cliente fallito".
            const parts = [insErr.message, insErr.details, insErr.hint ? `hint: ${insErr.hint}` : '', insErr.code ? `(${insErr.code})` : ''].filter(Boolean)
            // Clienti esteri: serve la migrazione che rende facoltativo il CF.
            if (estero && (insErr.code === '23502' || segnalaMigrazione(insErr))) {
                return jsonResponse(500, { error: 'Clienti esteri non ancora attivi: eseguire in Supabase la migrazione 20260922_emtn_clienti_esteri.sql' }, origin)
            }
            return jsonResponse(500, { error: `Inserimento cliente fallito: ${parts.join(' — ')}` }, origin)
        }
        client = created
    }

    // Estero gia' noto: nazionalita' e documento si aggiornano con quelli
    // dati adesso (documento rinnovato, prima ricerca senza documento).
    if (estero && client) {
        const c = client as { id: string; nazionalita?: string | null; documento_tipo?: string | null; documento_numero?: string | null }
        if (c.nazionalita !== nazionalitaE || c.documento_tipo !== docTipoE || c.documento_numero !== docNumE) {
            const { error: updErr } = await sb.from('emtn_clients')
                .update({ nazionalita: nazionalitaE, documento_tipo: docTipoE, documento_numero: docNumE })
                .eq('id', c.id)
            if (!updErr) client = { ...client, nazionalita: nazionalitaE, documento_tipo: docTipoE, documento_numero: docNumE } as typeof client
        }
    }

    // 07/11/2026: il calcolo e' in utils/emtnScoreCliente.ts (lo stesso per
    // il badge della lista prenotazioni e per il ricalcolo programmato).
    const {
        ext, profili, emtnScore, storicoScore, sc, recentEvents, storicoRete, reteResiduo,
        dr7Damages, dr7Penalties, unpaidDamageTotal, unpaidPenaltyTotal, lastBookingDate, firstBookingDate,
        totalRentals, regularRentals,
    } = await calcolaReportCliente(sb, { cf, estero, nomeE, cognomeE, nascitaE }, client!, operatorEmail ?? null)
    // Il numero resta anche nel database (emtn_score_clienti): lo leggono il
    // badge della lista prenotazioni, l'allarme e il blocco del sito.
    if (!estero) await salvaScoreClienti(sb, profili, { clientId: client!.id, cf, risultato: emtnScore })

    function buildAddress(e: ExtRow | null): string | null {
        if (!e) return null
        const street = e.indirizzo || e.sede_legale || null
        const city = e.citta_residenza || null
        const cap = e.codice_postale || null
        const parts: string[] = []
        if (street) parts.push(String(street))
        if (cap || city) parts.push([cap, city].filter(Boolean).join(' '))
        return parts.join(', ') || null
    }
    // Sesso derivato dal CF: il 10° carattere (index 9, ovvero il giorno
    // di nascita: 1-31 maschio, 41-71 femmina).
    function sexFromCF(c: string): 'M' | 'F' | null {
        const m = c.match(/^[A-Z]{6}[0-9]{2}[A-Z]([0-9]{2})/)
        if (!m) return null
        const day = parseInt(m[1], 10)
        return day > 31 ? 'F' : 'M'
    }
    function dobFromCF(c: string): string | null {
        // CF: AAAAAA YY M DD CCCC X — month letter A=jan…T=dec, day 1-31 (m) o 41-71 (f).
        // Anno a due cifre — assume <30 → 20xx, >=30 → 19xx.
        const m = c.match(/^[A-Z]{6}(\d{2})([ABCDEHLMPRST])(\d{2})/)
        if (!m) return null
        const yy = parseInt(m[1], 10)
        const monthMap: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5, H: 6, L: 7, M: 8, P: 9, R: 10, S: 11, T: 12 }
        const mm = monthMap[m[2]]
        let day = parseInt(m[3], 10)
        if (day > 40) day -= 40
        const year = yy < 30 ? 2000 + yy : 1900 + yy
        if (!mm || day < 1 || day > 31) return null
        return `${year.toString().padStart(4, '0')}-${mm.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
    }

    const band = emtnScore.band
    const riskScore = emtnScore.score
    const riskLevel = emtnScore.level
    const message =
        band === 'green' ? 'Prenotazione confermata.'
        : band === 'yellow' ? 'La prenotazione e\' in verifica. Ti contatteremo a breve.'
        : 'La richiesta e\' in revisione amministrativa.'

    // 22/09/2026 (direzione): niente OTP, il report e' sempre sbloccato.
    const unlocked = true

    await audit(sb, {
        operatorId, operatorEmail, action: 'SEARCH', success: true, ip, userAgent: ua,
        clientId: client!.id, metadata: { unlocked, estero },
    })

    // Cliente arricchito: union dei campi emtn_clients + customers_extended
    // + derivati da bookings. Il frontend (EMTNClient) li legge tutti.
    const enrichedClient = {
        ...(client as Record<string, unknown>),
        email: ext?.email || null,
        phone: ext?.telefono || null,
        address: buildAddress(ext),
        customer_since: firstBookingDate || (ext?.created_at ?? null),
        last_seen_at: lastBookingDate,
        source: ext ? 'customers_extended' : 'emtn',
        date_of_birth: (client as { data_nascita?: string | null }).data_nascita || ext?.data_nascita || (cf ? dobFromCF(cf) : null),
        sex: cf ? sexFromCF(cf) : null,
        nationality: estero ? nazionalitaE : 'IT',
        // Stesso numero di "Eventi documentati" nella scheda EMTN Score.
        events: sc.negative_events,
    }

    return jsonResponse(200, {
        client: enrichedClient,
        stats: sc,
        riskBand: band,
        riskScore,
        riskLevel,
        message,
        reportUnlocked: unlocked,
        recentEvents,
        score: { ...emtnScore, storico: storicoScore },
        // Copia venduta: score in sola consultazione (niente intervento manuale).
        scoreSolaConsultazione: copiaDellaRete(),
        dr7History: {
            // Visibile sempre all'admin DR7: e' la cronologia interna
            // della tua azienda, niente OTP serve qui.
            totalBookings: totalRentals,
            regularBookings: regularRentals,
            damages: dr7Damages,
            penalties: dr7Penalties,
            unpaidDamageTotal: Math.round(unpaidDamageTotal * 100) / 100,
            unpaidPenaltyTotal: Math.round(unpaidPenaltyTotal * 100) / 100,
            lastBookingDate,
            firstBookingDate,
        },
        // Eventi di altri operatori della rete: nessun nome, nessun operatore.
        rete: {
            eventi: storicoRete,
            residuo: Math.round(reteResiduo * 100) / 100,
        },
    }, origin)
}
