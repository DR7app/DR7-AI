// 05/10/2026 (direzione): uno slot gia' occupato deve SEMPRE avvisare,
// anche per chi ha role:bypass-otp o quando l'OTP slot_unavailable e'
// spento in Gestione OTP. Prima il conflitto finiva solo nell'audit log
// e la prenotazione veniva salvata in silenzio sopra un'altra.
// Non e' un blocco: l'operatore legge la prenotazione gia' presente e
// sceglie se procedere comunque.
export function confermaSlotOccupato(dettaglio: string): boolean {
  return window.confirm(
    'SLOT NON DISPONIBILE\n\n' +
    `${dettaglio}\n\n` +
    'Vuoi procedere comunque?',
  )
}
