// Campo data GG/MM/AAAA scritto a mano.
//
// 21/09/2026 (direzione): prima ogni tasto toglieva tutte le "/", rimetteva le
// cifre in fila e le ridivideva 2+2+4. Correggendo solo il giorno le cifre
// scivolavano di un posto (21/09/2026 -> 20/92/026) e il cursore saltava in
// fondo, sull'anno. Qui giorno, mese e anno restano al loro posto e il
// cursore resta dove si sta scrivendo.

const MAX = [2, 2, 4]

export function formattaDataEu(raw: string, caret: number | null): { testo: string; caret: number } {
  const pos = caret ?? raw.length
  const cifrePrima = raw.slice(0, pos).replace(/\D/g, '').length

  let segs: string[]
  if (!raw.includes('/')) {
    // Scrittura da zero: le "/" si mettono da sole.
    const d = raw.replace(/\D/g, '').slice(0, 8)
    segs = d.length <= 2 ? [d] : d.length <= 4 ? [d.slice(0, 2), d.slice(2)] : [d.slice(0, 2), d.slice(2, 4), d.slice(4)]
  } else {
    const parti = raw.split('/')
    segs = parti.slice(0, 2).concat(parti.length > 2 ? [parti.slice(2).join('')] : [])
      .map(s => s.replace(/\D/g, ''))
    // Posizione del cursore dentro ogni pezzo, per scrivere "sopra".
    let resto = cifrePrima
    for (let i = 0; i < segs.length; i++) {
      const cap = MAX[i]
      const inPezzo = Math.max(0, Math.min(resto, segs[i].length))
      resto -= segs[i].length
      if (segs[i].length <= cap) continue
      const esiste = i < 2 && segs[i + 1] !== undefined
      if (i < 2 && !esiste) {
        // Si scrive in fondo: l'eccesso passa al pezzo dopo.
        segs[i + 1] = segs[i].slice(cap)
        segs[i] = segs[i].slice(0, cap)
      } else {
        // Il pezzo dopo c'e' gia': la cifra nuova sostituisce quella dopo il cursore.
        let s = segs[i]
        while (s.length > cap && inPezzo < s.length) s = s.slice(0, inPezzo) + s.slice(inPezzo + 1)
        segs[i] = s.slice(0, cap)
      }
    }
  }

  const testo = segs.join('/')
  // Il cursore torna subito dopo la stessa cifra di prima.
  let c = 0
  let viste = 0
  while (c < testo.length && viste < cifrePrima) {
    if (/\d/.test(testo[c])) viste++
    c++
  }
  return { testo, caret: c }
}

/** Rimette il cursore dopo che React ha aggiornato il valore del campo. */
export function rimettiCursore(el: HTMLInputElement | null, caret: number) {
  if (!el) return
  requestAnimationFrame(() => {
    if (document.activeElement === el) {
      try { el.setSelectionRange(caret, caret) } catch { /* campo non testuale */ }
    }
  })
}
