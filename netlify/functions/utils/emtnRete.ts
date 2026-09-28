/**
 * EMTN — storico della rete (copie vendute).
 *
 * Regola (28/09/2026, direzione): chi compra il gestionale vede la SUA lista
 * clienti; lo storico DR7 lo vede solo digitando un codice fiscale, anonimo.
 * Qui vivono le due meta' della regola:
 *   - righeStoricoRete(): da clienti DR7 a righe anonime (script di import);
 *   - cercaStoricoRete(): lettura per UN codice fiscale (emtn-search).
 * Nessuna funzione elenca la tabella: non aggiungerne.
 */
import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Aggregated } from './emtnClientiDanni'

export interface RigaStoricoRete {
    cf_impronta: string
    tipo: 'danno' | 'penale' | 'insoluto'
    voce: string | null
    importo: number
    pagato: number
    residuo: number
    stato_pagamento: 'paid' | 'partial' | 'pending'
    data_evento: string | null
    giorni_al_saldo: number | null
    lotto: string
}

/** Impronta del codice fiscale: HMAC-SHA256 con la chiave della copia. */
export function improntaCF(cf: string, chiave: string): string {
    return crypto.createHmac('sha256', chiave).update(String(cf).trim().toUpperCase()).digest('hex')
}

/**
 * Toglie dall'etichetta cio' che rimanda a una prenotazione DR7
 * ("Danno prenotazione 88CDFF9D - distrutta macchina" -> "distrutta macchina").
 */
export function voceAnonima(label: string | null | undefined): string | null {
    let v = String(label || '').trim()
    v = v.replace(/^(penale|danno)\s+prenotazione\s+[0-9a-f]{6,}\s*-\s*/i, '')
    v = v.replace(/^(penale|danno)\s*-\s*/i, '')
    v = v.replace(/\b[0-9a-f]{8}\b/gi, '').replace(/\s+/g, ' ').trim()
    return v ? v.slice(0, 120) : null
}

/**
 * Da clienti DR7 a righe anonime. Solo clienti con codice fiscale: senza CF
 * nessuno potrebbe mai ritrovarli. `dal` (YYYY-MM-DD) tiene solo gli eventi
 * da quella data (es. contratti firmati con la clausola sulla rete).
 */
export function righeStoricoRete(clients: Aggregated[], chiave: string, lotto: string, dal?: string | null): RigaStoricoRete[] {
    const out: RigaStoricoRete[] = []
    for (const c of clients) {
        if (!c.codice_fiscale) continue
        const impronta = improntaCF(c.codice_fiscale, chiave)
        for (const ev of c.events) {
            const data = ev.eventDate ? String(ev.eventDate).slice(0, 10) : null
            if (dal && (!data || data < dal)) continue
            out.push({
                cf_impronta: impronta,
                tipo: ev.kind,
                voce: voceAnonima(ev.label),
                importo: Math.round(ev.amount * 100) / 100,
                pagato: Math.round(ev.amountPaid * 100) / 100,
                residuo: Math.round(ev.remaining * 100) / 100,
                stato_pagamento: ev.paymentStatus,
                data_evento: data,
                giorni_al_saldo: ev.daysToPay,
                lotto,
            })
        }
    }
    return out
}

export interface EventoRete {
    tipo: 'danno' | 'penale' | 'insoluto'
    voce: string | null
    importo: number
    pagato: number
    residuo: number
    statoPagamento: 'paid' | 'partial' | 'pending'
    dataEvento: string | null
    giorniAlSaldo: number | null
}

/**
 * Storico della rete per UN codice fiscale. Vuoto se la copia non ha la
 * chiave (es. l'installazione DR7) o la tabella non esiste ancora.
 */
export async function cercaStoricoRete(sb: SupabaseClient, cf: string): Promise<EventoRete[]> {
    const chiave = process.env.EMTN_RETE_CHIAVE
    if (!chiave || !cf) return []
    const { data, error } = await sb
        .from('emtn_storico_rete')
        .select('tipo, voce, importo, pagato, residuo, stato_pagamento, data_evento, giorni_al_saldo')
        .eq('cf_impronta', improntaCF(cf, chiave))
        .order('data_evento', { ascending: false })
        .limit(200)
    if (error) {
        console.warn('[emtn-rete] lettura storico non riuscita:', error.message)
        return []
    }
    return (data || []).map(r => ({
        tipo: r.tipo,
        voce: r.voce,
        importo: Number(r.importo) || 0,
        pagato: Number(r.pagato) || 0,
        residuo: Number(r.residuo) || 0,
        statoPagamento: r.stato_pagamento,
        dataEvento: r.data_evento,
        giorniAlSaldo: r.giorni_al_saldo,
    }))
}
