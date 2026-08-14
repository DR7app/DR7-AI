/**
 * Riga di Centralina Pro corrispondente al business — versione client.
 *
 * Gemella di `netlify/functions/utils/businessConfig.ts`, che fa lo stesso
 * lavoro lato server. Duplicata di proposito: il codice dell'app e quello
 * delle Netlify Functions vengono bundlati a parte e non condividono moduli.
 * Cambiando la mappa, cambiarla in ENTRAMBI.
 *
 * Il difetto che chiude (roadmap #16): la Centralina mostra le stesse sezioni
 * per ogni business, quindi un operatore configura legittimamente i metodi di
 * pagamento stando sul Mare — e il salvataggio finisce davvero nella riga
 * `business_mare`. Ma chi LEGGEVA chiedeva sempre `main`: la configurazione
 * veniva salvata e mai applicata, senza errore, con l'operatore convinto di
 * aver configurato.
 *
 * Regola: si legge la riga del business, e si ricade su `main` quando quel
 * business non ha impostato la voce. Chi non configura eredita il regime
 * dell'azienda, chi configura viene rispettato.
 */
import { supabase } from '../supabaseClient'

export type ProConfig = Record<string, unknown> | null

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
export async function loadBusinessConfig(serviceType?: string | null): Promise<{ business: ProConfig; main: ProConfig }> {
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
        console.warn('[businessConfigClient] lettura fallita:', (err as Error).message)
        return { business: null, main: null }
    }
}

/**
 * Prima lista non vuota fra business e main, sotto `config.<sezione>.<campo>`.
 *
 * Vuota conta come "non configurata" e fa scattare il fallback: una sezione
 * appena creata su un business nuovo e' un array vuoto, non una scelta di
 * non avere metodi di pagamento.
 */
export async function loadBusinessList<T>(
    serviceType: string | null | undefined,
    sezione: string,
    campo: string,
): Promise<T[]> {
    const { business, main } = await loadBusinessConfig(serviceType)
    const pick = (cfg: ProConfig): T[] | null => {
        const sec = cfg?.[sezione] as Record<string, unknown> | undefined
        const list = sec?.[campo]
        return Array.isArray(list) && list.length > 0 ? (list as T[]) : null
    }
    return pick(business) ?? pick(main) ?? []
}
