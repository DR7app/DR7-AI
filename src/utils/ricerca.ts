// 02/10/2026: una sola regola di ricerca per tutte le barre del gestionale
// (vedi components/admin/BarraRicerca). Prima ogni tab confrontava a modo suo:
// chi solo il nome, chi era sensibile agli accenti, chi non trovava un
// telefono scritto con spazi o con +39, chi non trovava "AB123CD" se la targa
// era salvata "AB 123 CD".
//
// Regole:
//  - maiuscole/minuscole e accenti non contano ("nicolo" trova "Nicolò")
//  - piu' parole = tutte devono comparire, in qualunque campo e ordine
//    ("rossi mario" trova "Mario Rossi")
//  - targhe e codici: spazi, trattini e punti non contano ("ab123cd" trova "AB 123 CD")
//  - telefoni: contano solo le cifre, con o senza +39 / 0039
//    ("3471234567" trova "+39 347 123 4567" e viceversa)

export function normalizzaTesto(valore: unknown): string {
  if (valore === null || valore === undefined) return ''
  return String(valore)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Solo lettere e cifre: per targhe, codici, numeri di contratto/fattura. */
export function compattaTesto(valore: unknown): string {
  return normalizzaTesto(valore).replace(/[^a-z0-9]/g, '')
}

/** Solo cifre, senza prefisso internazionale italiano. */
export function cifreTelefono(valore: unknown): string {
  let cifre = String(valore ?? '').replace(/\D/g, '')
  if (cifre.startsWith('0039')) cifre = cifre.slice(4)
  else if (cifre.startsWith('39') && cifre.length > 10) cifre = cifre.slice(2)
  return cifre
}

function parolaTrovata(parola: string, campi: string[], compatti: string[], telefoni: string[]): boolean {
  if (campi.some(c => c.includes(parola))) return true
  const p = compattaTesto(parola)
  if (p && compatti.some(c => c.includes(p))) return true
  const cifre = cifreTelefono(parola)
  if (cifre.length >= 3 && telefoni.some(t => t.includes(cifre))) return true
  return false
}

/**
 * true se la ricerca trova la riga. `campi` = tutto cio' che si puo' cercare
 * della riga (nome, cognome, email, telefono, targa, veicolo, codice...).
 * Ricerca vuota = tutto trovato.
 */
export function corrispondeRicerca(ricerca: string, campi: unknown[]): boolean {
  const q = normalizzaTesto(ricerca)
  if (!q) return true
  const testi = campi.filter(c => c !== null && c !== undefined && c !== '').map(normalizzaTesto)
  const compatti = testi.map(compattaTesto)
  const telefoni = testi.map(cifreTelefono).filter(t => t.length >= 3)
  // Telefono scritto con spazi ("347 123 4567"): se la ricerca e' tutta cifre,
  // la si prova anche come numero unico prima di spezzarla in parole.
  if (/^[\d\s+().-]+$/.test(q)) {
    const cifre = cifreTelefono(q)
    if (cifre.length >= 3 && telefoni.some(t => t.includes(cifre))) return true
  }
  // Stessa cosa per targhe/codici scritti con spazi ("AB 123 CD").
  const qCompatta = compattaTesto(q)
  if (qCompatta.length >= 3 && compatti.some(c => c.includes(qCompatta))) return true
  return q.split(' ').every(parola => parolaTrovata(parola, testi, compatti, telefoni))
}
