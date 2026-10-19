// "Gia' recensito" vale per la PERSONA, non per la prenotazione (19/10/2026).
//
// Su Google una persona puo' lasciare UNA sola recensione. Il bottone "Blocca"
// della tab Recensioni scrive ALREADY_REVIEWED sulla riga di una prenotazione;
// prima, una nuova prenotazione dello stesso cliente creava una riga nuova in
// "Da inviare" e la richiesta ripartiva. Ora chi ha gia' recensito resta
// bloccato su ogni prenotazione successiva, finche' la direzione non lo sblocca.
//
// Confronto per telefono (solo cifre) o email (minuscolo), mai su valori vuoti:
// un campo vuoto non deve mai far coincidere due persone diverse.
import type { SupabaseClient } from '@supabase/supabase-js'

export const MOTIVO_GIA_RECENSITO = "Ha gia' lasciato una recensione (prenotazione precedente)"

const chiaveTelefono = (v: string | null | undefined): string => {
  const cifre = String(v || '').replace(/\D/g, '').replace(/^0+/, '')
  // Ultime 9 cifre: 39 3331234567 e 3331234567 sono lo stesso numero.
  return cifre.length >= 8 ? cifre.slice(-9) : ''
}
const chiaveEmail = (v: string | null | undefined): string => {
  const e = String(v || '').trim().toLowerCase()
  return e.includes('@') ? e : ''
}

export interface Persona {
  customer_phone?: string | null
  customer_email?: string | null
}

export function stessaPersona(a: Persona, b: Persona): boolean {
  const ta = chiaveTelefono(a.customer_phone)
  const ea = chiaveEmail(a.customer_email)
  return (!!ta && ta === chiaveTelefono(b.customer_phone))
    || (!!ea && ea === chiaveEmail(b.customer_email))
}

/** Stessa regola di isBloccatoManualmente() nella tab Recensioni. */
export function rigaGiaRecensita(r: { exclusion_reason_code?: string | null; send_status?: string | null }): boolean {
  return r.exclusion_reason_code === 'ALREADY_REVIEWED'
    && (r.send_status === 'BLOCKED' || r.send_status === 'SENT')
}

/**
 * Restituisce la riga che dimostra che questa persona ha gia' recensito
 * (su un'altra prenotazione), oppure null. `escludiId` = la riga corrente.
 */
export async function trovaGiaRecensito(
  supabase: SupabaseClient,
  persona: Persona,
  escludiId?: string,
): Promise<{ id: string; source_record_id: string | null } | null> {
  if (!chiaveTelefono(persona.customer_phone) && !chiaveEmail(persona.customer_email)) return null

  const PAGINA = 1000
  for (let da = 0; ; da += PAGINA) {
    const { data, error } = await supabase
      .from('review_candidates')
      .select('id, source_record_id, customer_phone, customer_email, send_status, exclusion_reason_code')
      .eq('exclusion_reason_code', 'ALREADY_REVIEWED')
      .in('send_status', ['BLOCKED', 'SENT'])
      .order('id')
      .range(da, da + PAGINA - 1)
    if (error) throw new Error(`Controllo gia' recensito fallito: ${error.message}`)
    const trovata = (data || []).find((r) => r.id !== escludiId && rigaGiaRecensita(r) && stessaPersona(persona, r))
    if (trovata) return { id: trovata.id, source_record_id: trovata.source_record_id }
    if (!data || data.length < PAGINA) return null
  }
}
