// Percorsi dello storage Supabase: mai un nome scritto da una persona tale e
// quale nella chiave del file.
//
// 26/09/2026 — Un documento chiamato "Contestazione Danni Lamborghini Huracán
// tecnica " non si riusciva a firmare: il nome finiva nel percorso del PDF
// firmato, lo storage rifiutava la chiave (accento, spazi) e la firma falliva
// dopo l'OTP, col cliente davanti. Ogni `.upload(` passa da qui; un test
// (percorsoStorage.test.ts) fallisce se un nuovo caricamento lo salta.
//
// Su un nome gia' sicuro (uuid, timestamp, DR7XXXX, costanti) le funzioni
// restituiscono lo stesso identico testo: le chiavi dei file gia' salvati non
// cambiano. Il nome da mostrare all'utente si salva a parte, come l'ha scritto.

const SEGNI_DIACRITICI = /[\u0300-\u036f]/g

function pulisci(testo: string): string {
  return testo
    .normalize('NFD').replace(SEGNI_DIACRITICI, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.]+|[_.]+$/g, '')
}

/** Nome di file accettato dallo storage: solo lettere, cifre, `.`, `_` e `-`. */
export function nomeFileSicuro(nome: string, max = 80): string {
  const originale = String(nome ?? '').trim()
  // L'estensione si separa prima, cosi' "😀.png" resta "file.png" e
  // "nome .pdf" diventa "nome.pdf".
  const m = originale.match(/\.([A-Za-z0-9]{1,10})$/)
  const estensione = m ? `.${m[1]}` : ''
  const base = pulisci(m ? originale.slice(0, -m[0].length) : originale) || 'file'
  const spazio = Math.max(1, max - estensione.length)
  const baseCorta = base.length > spazio ? (base.slice(0, spazio).replace(/[_.-]+$/g, '') || 'file') : base
  return `${baseCorta}${estensione}`
}

/** Percorso completo: ogni segmento reso sicuro, uniti da `/`, senza `//`. */
export function percorsoStorage(...parti: string[]): string {
  return parti
    .flatMap(p => String(p ?? '').split('/'))
    .filter(s => s.trim() !== '')
    .map(s => nomeFileSicuro(s, 120))
    .join('/')
}
