/**
 * WhatsApp al nuovo investitore.
 *
 * 06/10/2026 (direzione): salvando un nuovo investitore in Amministrazione >
 * Investitori partono due messaggi, in quest'ordine:
 *  1. `investor_welcome`           -> pro_investitore_benvenuto
 *  2. `investor_name_publication`  -> pro_investitore_autorizzazione_nome
 * Il testo sta SOLO in Messaggi di Sistema Pro > Investitori (mai nel codice).
 * Un template spento o vuoto = quel messaggio non parte, e lo si dice.
 * L'invio passa da send-whatsapp-notification: Green API, lingua dal
 * prefisso del telefono, interruttore invio_whatsapp di System Control.
 */
import { supabase } from '../supabaseClient'
import { authFetch } from './authFetch'
import { numeroWhatsapp } from './messaggioCodiceSconto'

export const MESSAGGI_INVESTITORE = [
    { evento: 'investor_welcome', chiave: 'pro_investitore_benvenuto', etichetta: 'Benvenuto' },
    { evento: 'investor_name_publication', chiave: 'pro_investitore_autorizzazione_nome', etichetta: 'Autorizzazione nome sul sito' },
] as const

interface RigaTemplate {
    message_key: string
    message_body: string | null
    is_enabled: boolean | null
    handled_events: string[] | null
}

/** Template di ogni evento: prima chi ha l'evento assegnato, poi la key canonica. */
async function caricaTemplate(): Promise<Map<string, string | null>> {
    const { data } = await supabase
        .from('system_messages')
        .select('message_key, message_body, is_enabled, handled_events')
        .in('message_key', [...MESSAGGI_INVESTITORE.map(m => m.chiave)])
    const { data: perEvento } = await supabase
        .from('system_messages')
        .select('message_key, message_body, is_enabled, handled_events')
        .overlaps('handled_events', MESSAGGI_INVESTITORE.map(m => m.evento))
    const righe = [...((perEvento || []) as RigaTemplate[]), ...((data || []) as RigaTemplate[])]
    const usabile = (r: RigaTemplate) => r.is_enabled !== false && !!(r.message_body || '').trim()
    const out = new Map<string, string | null>()
    for (const m of MESSAGGI_INVESTITORE) {
        const r = righe.find(x => (x.handled_events || []).includes(m.evento) && usabile(x))
            || righe.find(x => x.message_key === m.chiave && usabile(x))
        out.set(m.evento, r?.message_body || null)
    }
    return out
}

/** Persona: nome di battesimo; societa': ragione sociale intera. */
function token(nome: string, tipo: 'persona' | 'societa'): Record<string, string> {
    const completo = nome.trim()
    const battesimo = tipo === 'societa' ? completo : (completo.split(/\s+/)[0] || completo)
    return {
        nome: battesimo,
        name: battesimo,
        nome_completo: completo,
        customer_name: completo,
        cliente: completo,
    }
}

export interface EsitoInvio { etichetta: string; inviato: boolean; motivo?: string }

export async function inviaMessaggiInvestitore(inv: { nome: string; tipo: 'persona' | 'societa'; telefono: string | null }): Promise<EsitoInvio[]> {
    const numero = numeroWhatsapp(inv.telefono)
    if (!numero) return MESSAGGI_INVESTITORE.map(m => ({ etichetta: m.etichetta, inviato: false, motivo: 'telefono mancante o non valido' }))
    const template = await caricaTemplate()
    const t = token(inv.nome, inv.tipo)
    const esiti: EsitoInvio[] = []
    for (const m of MESSAGGI_INVESTITORE) {
        const body = template.get(m.evento)
        if (!body) { esiti.push({ etichetta: m.etichetta, inviato: false, motivo: 'template spento o vuoto in Messaggi di Sistema Pro' }); continue }
        const testo = body.replace(/\{(\w+)\}/g, (intero, k: string) => (t[k] !== undefined ? t[k] : intero))
        try {
            const res = await authFetch('/.netlify/functions/send-whatsapp-notification', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ customMessage: testo, customPhone: numero, type: `Investitore: ${m.etichetta}` }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) esiti.push({ etichetta: m.etichetta, inviato: false, motivo: data.message || `HTTP ${res.status}` })
            // 200 non vuol dire inviato: skipped = variabile non risolta o interruttore spento.
            else if (data.skipped) esiti.push({ etichetta: m.etichetta, inviato: false, motivo: data.message || data.reason || 'scartato dal server' })
            else esiti.push({ etichetta: m.etichetta, inviato: true })
        } catch (e) {
            esiti.push({ etichetta: m.etichetta, inviato: false, motivo: e instanceof Error ? e.message : String(e) })
        }
        // Il secondo parte dopo il primo: su WhatsApp devono arrivare in ordine.
        await new Promise(r => setTimeout(r, 1500))
    }
    return esiti
}
