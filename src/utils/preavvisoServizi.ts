/**
 * Preavviso minimo per servizi extra e consegna a domicilio (19/11/2026).
 *
 * Richiesta della direzione: un cliente prenotava ora un ritiro fra un'ora
 * con il bouquet di rose, e non c'era il tempo di organizzarsi. Per ogni
 * servizio extra (e per la consegna/ritiro a domicilio) la Centralina Pro
 * decide quante ore prima del ritiro va prenotato. Sul sito il servizio non
 * e' selezionabile se il ritiro e' troppo vicino.
 *
 * Valore salvato: `preavviso_ore` (numero di ore). 0 / assente = nessun limite.
 * File gemello: DR7-AI src/utils/preavvisoServizi.ts e Sito utils/preavvisoServizi.ts.
 */

export const OPZIONI_PREAVVISO_ORE: number[] = [
  0,
  ...Array.from({ length: 24 }, (_, i) => i + 1),
  48, 72, 96, 120, 144,
  168, 336, 720,
]

export function etichettaPreavviso(ore: number | null | undefined, lang: 'it' | 'en' = 'it'): string {
  const h = Number(ore) || 0
  if (h <= 0) return lang === 'en' ? 'No minimum notice' : 'Nessun preavviso'
  if (h === 720) return lang === 'en' ? '1 month' : '1 mese'
  if (h % 168 === 0) {
    const w = h / 168
    return lang === 'en' ? `${w} week${w > 1 ? 's' : ''}` : `${w} settiman${w > 1 ? 'e' : 'a'}`
  }
  if (h > 24 && h % 24 === 0) {
    const d = h / 24
    return lang === 'en' ? `${d} days` : `${d} giorni`
  }
  return lang === 'en' ? `${h} hour${h > 1 ? 's' : ''}` : `${h} or${h > 1 ? 'e' : 'a'}`
}

/** true = il ritiro e' troppo vicino per questo servizio. Data mancante = nessun blocco. */
export function preavvisoInsufficiente(
  ore: number | null | undefined,
  quando: Date | string | null | undefined,
  adesso: Date = new Date(),
): boolean {
  const h = Number(ore) || 0
  if (h <= 0 || !quando) return false
  const t = new Date(quando).getTime()
  if (!Number.isFinite(t)) return false
  return t - adesso.getTime() < h * 3_600_000
}
