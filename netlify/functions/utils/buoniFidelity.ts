/**
 * WhatsApp al cliente per i buoni Fidelity lavaggio (12/10/2026).
 *
 * Il buono lo emette il database (trigger trg_dr7_punti_lavaggio, tabella
 * fidelity_buoni) per ogni lavaggio pagato, gestionale o sito. Qui, dentro il
 * giro di alarm-engine-cron, si spediscono i buoni non ancora comunicati con
 * il template Pro `pro_fidelity_voucher` (alias fidelity_voucher_whatsapp).
 *
 * Una riga = un messaggio: fidelity_buoni.messaggio_at passa da NULL a adesso
 * in una sola UPDATE prima di spedire, chi arriva secondo non spedisce.
 * Solo buoni recenti: un buono rimasto indietro di giorni non parte a sorpresa.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

const SITE_URL = process.env.URL || 'https://platform.dr7ai.com'
const SITO_PUBBLICO = process.env.PUBLIC_SITE_URL || 'https://www.dr7.app'
const FINESTRA_MS = 48 * 60 * 60_000

function dataIt(iso: string | null): string {
    if (!iso) return ''
    return new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso))
}

export async function inviaBuoniFidelity(sb: SupabaseClient, now: Date, budgetMs: number): Promise<number> {
    const t0 = Date.now()
    const { data: righe, error } = await sb
        .from('fidelity_buoni')
        .select('id, booking_id, customer_extended_id, voucher_code, importo, punti_soglia, punti_rimasti, valido_fino')
        .is('messaggio_at', null)
        .gte('created_at', new Date(now.getTime() - FINESTRA_MS).toISOString())
        .order('created_at', { ascending: true })
        .range(0, 49)
    // Tabella assente (migrazione non ancora eseguita): niente da fare.
    if (error || !righe) return 0

    let inviati = 0
    for (const r of righe) {
        if (Date.now() - t0 > budgetMs) break
        const { data: presa } = await sb
            .from('fidelity_buoni')
            .update({ messaggio_at: new Date().toISOString() })
            .eq('id', r.id)
            .is('messaggio_at', null)
            .select('id')
        if (!presa || presa.length === 0) continue
        const esito = async (e: string) => { await sb.from('fidelity_buoni').update({ messaggio_esito: e }).eq('id', r.id) }

        try {
            const [{ data: booking }, { data: ce }] = await Promise.all([
                sb.from('bookings').select('*').eq('id', r.booking_id).maybeSingle(),
                r.customer_extended_id
                    ? sb.from('customers_extended').select('nome, cognome, ragione_sociale, tipo_cliente, telefono').eq('id', r.customer_extended_id).maybeSingle()
                    : Promise.resolve({ data: null }),
            ])
            // Telefono dalla scheda del cliente (trovata per id), poi dalla prenotazione.
            const phone = String(ce?.telefono || booking?.customer_phone || booking?.booking_details?.customer?.phone || '')
            if (!phone.replace(/\D/g, '')) { await esito('no_phone'); continue }

            const nomeCompleto = ce
                ? (ce.tipo_cliente === 'azienda' ? String(ce.ragione_sociale || '') : `${ce.nome || ''} ${ce.cognome || ''}`.trim())
                : String(booking?.customer_name || '')
            const nome = nomeCompleto.split(/\s+/)[0] || 'Cliente'
            const importo = String(Number(r.importo) || 25)
            const punti = String(r.punti_soglia)
            const scadenza = dataIt(r.valido_fino)
            const giorni = r.valido_fino
                ? String(Math.max(1, Math.round((new Date(r.valido_fino).getTime() - now.getTime()) / 86_400_000)))
                : ''

            const res = await fetch(`${SITE_URL}/.netlify/functions/send-whatsapp-notification`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customPhone: phone,
                    templateKey: 'fidelity_voucher_whatsapp',
                    ...(booking ? { booking } : {}),
                    templateVars: {
                        nome, customer_name: nomeCompleto || nome, cliente: nomeCompleto || nome,
                        codice: r.voucher_code, code: r.voucher_code, voucher: r.voucher_code, buono: r.voucher_code,
                        codice_sconto: r.voucher_code, code_sconto: r.voucher_code, codice_lavaggio: r.voucher_code, code_lavaggio: r.voucher_code,
                        importo, amount: importo,
                        punti, points: punti,
                        punti_rimasti: String(r.punti_rimasti),
                        giorni, valid_days: giorni,
                        scadenza,
                        link: SITO_PUBBLICO, url: SITO_PUBBLICO, sito: SITO_PUBBLICO, website: SITO_PUBBLICO, site: SITO_PUBBLICO,
                    },
                }),
            })
            const out = await res.json().catch(() => ({}))
            if (!res.ok || out?.skipped) { await esito(String(out?.reason || 'send_failed')); continue }
            await esito('inviato')
            inviati++
        } catch (e) {
            console.warn('[buoniFidelity] invio fallito:', r.id, e)
            await esito('errore')
        }
    }
    return inviati
}
