import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 26/09/2026 (direzione): una prenotazione "Da Saldare" con "Conferma
 * Prenotazione" spuntata riceve il contratto SUBITO. Quando poi si segna
 * pagata, il contratto NON deve ripartire: il cliente ha gia' il suo link.
 *
 * true = c'e' gia' un link di firma valido (in attesa, OTP inviato/verificato)
 * oppure il contratto e' gia' firmato. In quel caso il pagamento non rigenera
 * il contratto e non manda un altro link. Un link scaduto, annullato o
 * sostituito non conta: li' il link riparte.
 *
 * Stessa regola lato server in netlify/functions/nexi-payment-callback.ts.
 */
export const STATI_LINK_VALIDO = ['pending', 'otp_sent', 'otp_verified', 'signed'] as const

export async function linkFirmaGiaInviato(supabase: SupabaseClient, bookingId: string): Promise<boolean> {
  const { data: contratto } = await supabase
    .from('contracts')
    .select('signed_pdf_url')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (contratto?.signed_pdf_url) return true

  const { data: richieste } = await supabase
    .from('signature_requests')
    .select('id')
    .eq('booking_id', bookingId)
    .in('status', STATI_LINK_VALIDO as unknown as string[])
    .limit(1)
  return (richieste || []).length > 0
}
