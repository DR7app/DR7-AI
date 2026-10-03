// Scopo di un incasso Nexi: decide il ramo della callback (noleggio, saldo,
// estensione, penali/danni...).
//
// 03/10/2026: un link di penale partito con scopo 'booking_topup' e' stato
// trattato come saldo del noleggio e ha rimandato il contratto ai firmatari.
// La descrizione del link ("Penale — ...", "Danno — ...", "Penali — ...")
// prevale quindi su uno scopo di noleggio: una penale non e' mai un saldo.

export function scopoPagamento(transaction: { metadata?: { payment_purpose?: string } | null; description?: string | null }): string {
    const dichiarato = transaction.metadata?.payment_purpose || '';
    const descrizione = String(transaction.description || '').trim().toLowerCase();
    const daDescrizione = descrizione.startsWith('penal') ? 'penali'
        : (descrizione.startsWith('dann') || descrizione.startsWith('danno')) ? 'danni'
        : null;
    if (!dichiarato || dichiarato === 'booking' || dichiarato === 'booking_topup') {
        return daDescrizione || dichiarato || 'booking';
    }
    return dichiarato;
}
