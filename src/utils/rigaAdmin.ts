/**
 * La riga `admins` dell'utente collegato, letta UNA volta sola.
 *
 * 03/09/2026 — all'avvio del gestionale la stessa riga veniva chiesta al
 * database quattro volte, da quattro punti che ne volevano colonne diverse:
 * `AdminRoute` (role, archived_at), `useAdminRole` (permessi e nome),
 * `BrandSedeContext` (brand e sede), `VehicleAlarmContext` (permissions).
 * Quattro round-trip in fila prima ancora di disegnare qualcosa, su ogni
 * apertura di ogni tab.
 *
 * Qui la riga si legge una volta con TUTTE le colonne che servono a quei
 * quattro, e chi arriva mentre la lettura e' in corso aspetta la stessa
 * promessa invece di aprirne un'altra.
 *
 * Il fallback storico resta: se il database e' indietro e non ha
 * `archived_at` / `brand_id` / `sede_id`, si rilegge con le sole colonne
 * sicure invece di far fallire l'accesso. ([[feedback_migrazione_manuale_serve_fallback]])
 */

import { supabase } from '../supabaseClient'

export interface RigaAdmin {
    id?: string
    user_id?: string
    role?: string | null
    nome?: string | null
    can_view_financials?: boolean | null
    permissions?: unknown
    archived_at?: string | null
    brand_id?: string | null
    sede_id?: string | null
}

/** Tutte le colonne che servono ai quattro chiamanti, in una sola lettura. */
const COLONNE = 'id, user_id, role, nome, can_view_financials, permissions, archived_at, brand_id, sede_id'
/** Il sottoinsieme che esiste anche sui database non ancora migrati. */
const COLONNE_SICURE = 'id, user_id, role, nome, can_view_financials, permissions'

interface Voce {
    utente: string
    attesa: Promise<{ riga: RigaAdmin | null; errore: string | null }>
}

let voce: Voce | null = null

/**
 * La riga admin dell'utente. Chiamate ravvicinate condividono la stessa
 * lettura; cambiando utente si riparte.
 */
export function leggiRigaAdmin(userId: string): Promise<{ riga: RigaAdmin | null; errore: string | null }> {
    if (voce && voce.utente === userId) return voce.attesa

    const attesa = (async () => {
        const { data, error } = await supabase
            .from('admins')
            .select(COLONNE)
            .eq('user_id', userId)
            .maybeSingle()

        if (!error) return { riga: (data as RigaAdmin) || null, errore: null }

        // Database indietro di una migration: si rilegge senza le colonne nuove.
        const ripiego = await supabase
            .from('admins')
            .select(COLONNE_SICURE)
            .eq('user_id', userId)
            .maybeSingle()
        if (!ripiego.error) return { riga: (ripiego.data as RigaAdmin) || null, errore: null }

        // Fallita anche quella: si restituisce l'errore, la cache non lo tiene.
        voce = null
        return { riga: null, errore: ripiego.error.message || error.message }
    })()

    voce = { utente: userId, attesa }
    return attesa
}

/**
 * Da chiamare quando i permessi cambiano (assegnazione ruoli, logout): la
 * prossima richiesta torna a leggere dal database.
 */
export function svuotaRigaAdmin() {
    voce = null
}
