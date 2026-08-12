/**
 * Scadenze veicolo — cron giornaliero (roadmap #44).
 *
 * I dati sono gia' nel cruscotto veicolo: assicurazione, bollo, revisione,
 * intervalli di tagliando/gomme/pastiglie. FleetVehicleDetail li mostra come
 * alert, ma solo A SCHERMO e solo se qualcuno apre quella scheda. Nessuno
 * riceveva niente: un'assicurazione poteva scadere senza che nessuno lo
 * sapesse, e il veicolo continuava a essere noleggiato.
 *
 * Questo cron emette i trigger dei Messaggi di Sistema Pro:
 *   veicolo_scadenza_assicurazione   — assicurazione in scadenza
 *   veicolo_scadenza_generica        — bollo / revisione
 *   veicolo_scadenza_tagliando       — km al tagliando
 *   veicolo_scadenza_gomme           — km alle gomme
 *   veicolo_scadenza_pastiglie       — km alle pastiglie
 *
 * Il testo lo scrive la direzione in Messaggi di Sistema Pro. Se un trigger
 * non ha template, il sender blocca il corpo vuoto e non parte nulla: attivare
 * il cron non genera messaggi finche' i testi non esistono.
 *
 * Destinatari e gate orario ricalcano `processScadenzaCauzioneAvviso`:
 * numeri da Centralina Pro (notifications.cauzioni_staff_phones) con fallback
 * su admins.contatto_interno della direzione, e niente invii di notte.
 */
import { schedule } from '@netlify/functions'
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const SITE_URL = process.env.URL || 'https://platform.dr7ai.com'

/** Giorni di preavviso per le scadenze a data. */
const PREAVVISO_GIORNI = [30, 7, 1, 0]
/** Soglia km sotto la quale si avvisa per le manutenzioni. */
const SOGLIA_KM = 1000

const QUIET_START = 21
const QUIET_END = 8

function romeHour(): number {
    return parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }).format(new Date()), 10)
}
function romeToday(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
}
function giorniA(dateStr: string): number {
    const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number)
    const target = new Date(y, (m || 1) - 1, d || 1)
    const [ty, tm, td] = romeToday().split('-').map(Number)
    const today = new Date(ty, tm - 1, td)
    return Math.round((target.getTime() - today.getTime()) / 86400000)
}

interface Recipient { nome: string; phone: string }

async function resolveStaff(sb: ReturnType<typeof createClient>): Promise<Recipient[]> {
    const out = new Map<string, Recipient>()
    try {
        const { data } = await sb.from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const notif = ((data?.config as any) || {}).notifications || {}
        for (const part of String(notif.cauzioni_staff_phones || '').split(/[\n,;]+/)) {
            const phone = part.replace(/\D/g, '')
            if (phone.length >= 8) out.set(phone, { nome: 'Staff', phone })
        }
    } catch { /* config opzionale */ }
    try {
        const { data: admins } = await sb.from('admins').select('email, nome, contatto_interno')
            .in('email', ['valerio@dr7.app', 'ilenia@dr7.app'])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const a of (admins || []) as any[]) {
            const phone = String(a.contatto_interno || '').replace(/\D/g, '')
            if (phone.length >= 8 && !out.has(phone)) out.set(phone, { nome: a.nome || 'Staff', phone })
        }
    } catch { /* ignore */ }
    return [...out.values()]
}

const cronHandler: Handler = async () => {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return { statusCode: 200, body: JSON.stringify({ skipped: 'missing env' }) }
    }
    const h = romeHour()
    if (h < QUIET_END || h >= QUIET_START) {
        return { statusCode: 200, body: JSON.stringify({ skipped: 'quiet hours', hour: h }) }
    }
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

    const staff = await resolveStaff(sb)
    if (staff.length === 0) {
        return { statusCode: 200, body: JSON.stringify({ skipped: 'nessun destinatario configurato' }) }
    }

    // `select('*')` di proposito: le colonne di manutenzione hanno due
    // generazioni di nomi (last_tire_change_km della migrazione originale,
    // last_tires_front_km/last_tires_rear_km usati da FleetVehicleDetail e
    // forse mai migrati). Elencandole a mano, UNA sola colonna inesistente
    // farebbe fallire l'intera query e il cron non avviserebbe piu' nessuno.
    // Qui si legge quello che c'e', in modo difensivo.
    const { data: vehicles, error } = await sb
        .from('vehicles')
        .select('*')
    if (error) {
        console.error('[vehicle-deadlines] lettura veicoli fallita:', error.message)
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) }
    }

    const today = romeToday()
    let sent = 0, skipped = 0

    for (const v of (vehicles || [])) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const veh = v as any
        // Un solo avviso al giorno per veicolo: evita che 5 scadenze diverse
        // producano 5 messaggi allo stesso numero nello stesso minuto.
        if (veh.deadline_notified_on === today) { skipped++; continue }

        const targa = veh.plate || '—'
        const nome = veh.display_name || veh.name || 'Veicolo'
        const km = Number(veh.current_km || 0)
        const avvisi: { evento: string; dettaglio: string }[] = []

        // ── Scadenze a DATA ──────────────────────────────────────────────────
        const perData: [string, string, string][] = [
            ['insurance_expiry', 'veicolo_scadenza_assicurazione', 'Assicurazione'],
            ['tax_expiry', 'veicolo_scadenza_generica', 'Bollo'],
            ['inspection_expiry', 'veicolo_scadenza_generica', 'Revisione'],
        ]
        for (const [campo, evento, etichetta] of perData) {
            if (!veh[campo]) continue
            const gg = giorniA(veh[campo])
            if (!PREAVVISO_GIORNI.includes(gg) && gg >= 0) continue
            if (gg > 30) continue
            avvisi.push({
                evento,
                dettaglio: gg < 0
                    ? `${etichetta} SCADUTA da ${Math.abs(gg)} giorni (${veh[campo]})`
                    : gg === 0 ? `${etichetta} scade OGGI (${veh[campo]})`
                    : `${etichetta} scade fra ${gg} giorni (${veh[campo]})`,
            })
        }

        // ── Scadenze a KM ────────────────────────────────────────────────────
        // Coppie [ultimo km, intervallo]. Si accettano entrambe le generazioni
        // di nomi: si usa la prima coppia presente sul record.
        const perKm: [string[], string[], string, string][] = [
            [['last_service_km'], ['maintenance_service_interval_km'], 'veicolo_scadenza_tagliando', 'Tagliando'],
            [['last_tire_change_km', 'last_tires_front_km'], ['maintenance_tires_interval_km', 'maintenance_tires_front_interval_km'], 'veicolo_scadenza_gomme', 'Gomme'],
            [['last_tires_rear_km'], ['maintenance_tires_rear_interval_km'], 'veicolo_scadenza_gomme', 'Gomme posteriori'],
            [['last_brake_change_km', 'last_brake_front_km'], ['maintenance_brake_interval_km', 'maintenance_brake_front_interval_km'], 'veicolo_scadenza_pastiglie', 'Pastiglie'],
            [['last_brake_rear_km'], ['maintenance_brake_rear_interval_km'], 'veicolo_scadenza_pastiglie', 'Pastiglie posteriori'],
        ]
        const primoNumero = (campi: string[]): number | null => {
            for (const c of campi) if (veh[c] !== undefined && veh[c] !== null) return Number(veh[c]) || 0
            return null
        }
        if (km > 0) {
            for (const [campiUltimo, campiIntervallo, evento, etichetta] of perKm) {
                const intervallo = primoNumero(campiIntervallo)
                if (intervallo === null || intervallo <= 0) continue
                const prossimo = (primoNumero(campiUltimo) ?? 0) + intervallo
                const mancano = prossimo - km
                if (mancano > SOGLIA_KM) continue
                avvisi.push({
                    evento,
                    dettaglio: mancano <= 0
                        ? `${etichetta}: SUPERATO di ${Math.abs(mancano)} km (previsto a ${prossimo} km, attuali ${km})`
                        : `${etichetta}: mancano ${mancano} km (previsto a ${prossimo} km, attuali ${km})`,
                })
            }
        }

        if (avvisi.length === 0) continue

        // Un messaggio per veicolo, con tutte le sue scadenze. L'evento usato e'
        // quello del primo avviso: se la direzione vuole testi diversi per
        // assicurazione e manutenzione, bastano due template distinti.
        const evento = avvisi[0].evento
        const elenco = avvisi.map(a => `• ${a.dettaglio}`).join('\n')

        for (const r of staff) {
            try {
                await fetch(`${SITE_URL}/.netlify/functions/send-whatsapp-notification`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        customPhone: r.phone,
                        templateKey: evento,
                        templateVars: {
                            nome: r.nome,
                            veicolo: nome, vehicle_name: nome,
                            targa, plate: targa,
                            km: String(km),
                            scadenze: elenco, dettaglio: elenco, elenco,
                        },
                        skipHeader: true,
                    }),
                })
                sent++
            } catch (err) {
                console.warn('[vehicle-deadlines] invio fallito:', (err as Error).message)
            }
        }

        // Marca il veicolo come avvisato oggi. Best-effort: se la colonna non
        // esiste ancora (migrazione non applicata) si logga e si prosegue,
        // ma senza il lock si rischia un avviso al giorno ripetuto.
        const { error: markErr } = await sb.from('vehicles')
            .update({ deadline_notified_on: today }).eq('id', veh.id)
        if (markErr) {
            console.warn('[vehicle-deadlines] impossibile marcare il veicolo (manca la colonna deadline_notified_on?):', markErr.message)
        }
    }

    console.log(`[vehicle-deadlines] inviati ${sent}, saltati ${skipped}`)
    return { statusCode: 200, body: JSON.stringify({ sent, skipped }) }
}

// Ogni giorno alle 07:00 UTC (~9 Rome in estate, ~8 in inverno).
export const handler = schedule('0 7 * * *', cronHandler)
