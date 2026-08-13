/**
 * Riga di Centralina Pro corrispondente al business di una prenotazione.
 *
 * La Centralina e' UNA PER BUSINESS (roadmap #14): `main` per il Noleggio
 * Terra, poi `business_mare`, `business_aria`, `business_soggiorni`,
 * `business_lavaggio`. L'interfaccia mostra le stesse sezioni per tutti
 * (roadmap #16), quindi un operatore puo' legittimamente configurare l'IVA
 * stando sul Mare.
 *
 * Il difetto era lato lettura: le funzioni fattura leggevano SEMPRE `main`.
 * Le aliquote impostate sugli altri business venivano salvate e mai
 * applicate — senza errore, con l'operatore convinto di aver configurato.
 *
 * Regola: si legge la riga del business, e si ricade su `main` quando quel
 * business non ha impostato la voce. Cosi' chi non configura nulla eredita il
 * regime dell'azienda, e chi configura viene rispettato.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export function businessRowForServiceType(serviceType?: string | null): string {
    switch (String(serviceType || '').toLowerCase()) {
        case 'boat_rental': return 'business_mare'
        case 'heli_rental': return 'business_aria'
        case 'stay_rental': return 'business_soggiorni'
        case 'car_wash':
        case 'mechanical':
        case 'mechanical_service': return 'business_lavaggio'
        default: return 'main'
    }
}

/**
 * Config del business + config di `main`. Il chiamante cerca prima nella
 * prima, poi nella seconda. Una sola query quando il business E' main.
 */
export async function loadBusinessConfig(
    supabase: SupabaseClient,
    serviceType?: string | null
): Promise<{ business: Record<string, unknown> | null; main: Record<string, unknown> | null }> {
    const rowId = businessRowForServiceType(serviceType)
    try {
        const ids = rowId === 'main' ? ['main'] : [rowId, 'main']
        const { data } = await supabase
            .from('centralina_pro_config')
            .select('id, config')
            .in('id', ids)
        const rows = (data || []) as { id: string; config: Record<string, unknown> }[]
        const main = rows.find(r => r.id === 'main')?.config ?? null
        const business = rowId === 'main' ? main : (rows.find(r => r.id === rowId)?.config ?? null)
        return { business, main }
    } catch (err) {
        console.warn('[businessConfig] lettura fallita:', (err as Error).message)
        return { business: null, main: null }
    }
}
