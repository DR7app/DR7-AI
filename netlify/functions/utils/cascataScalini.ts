/**
 * 09/10/2026: cascata addebito a PIU' scalini, scelti per-transazione.
 *
 * Esempio (richiesta direzione): deve 100.000, scalini 10.000 / 5.000 / 2.000,
 * sulla carta ci sono 9.000.
 *   - scalino 10.000: 100k, 90k, ... 10k -> tutti rifiutati
 *   - scalino 5.000:  5k accettato, ritenta 5k -> rifiutato
 *   - scalino 2.000:  4k accettato, ritenta 4k e 2k -> rifiutati
 *   = 9.000 incassati in 15 tentativi, poi la carta successiva per il resto.
 *
 * Regole:
 *   - Dopo un SI' si ritenta lo stesso importo sulla stessa carta (puo'
 *     esserci ancora disponibilita'), mai oltre il rimanente.
 *   - Dopo un NO si scende dello scalino corrente; sotto il minimo si passa
 *     allo scalino successivo.
 *   - Ogni scalino nuovo riparte dal multiplo piu' alto SOTTO l'ultimo importo
 *     rifiutato: quello che la carta ha gia' detto di no non si riprova.
 *   - Se il rimanente e' piu' basso, si prova il rimanente esatto.
 *   - Finiti gli scalini si passa alla carta successiva per il rimanente.
 *
 * La vecchia cascata a scalino unico (cascade_step_cents) resta in
 * process-pending-addebiti.ts ed e' usata quando gli scalini non ci sono.
 */

export interface EsitoTentativo {
    ok: boolean
    error?: string
}

export interface RisultatoCascata {
    collectedCents: number
    remainingCents: number
    usedCards: string[]
    attempts: number
    lastError: string
    /**
     * 13/10/2026: true = la cascata e' arrivata in fondo (tutto incassato, o
     * ogni carta ha rifiutato anche lo scalino piu' piccolo, o tetto
     * tentativi). false = interrotta da `tempoScaduto`: `stato` dice da dove
     * riprendere al prossimo giro.
     */
    finita: boolean
    stato: StatoCascata | null
}

/**
 * 13/10/2026: punto in cui la cascata si e' fermata per tempo (Netlify uccide
 * la funzione a 30s). Concas 280.000 EUR: ogni giro veniva ucciso a meta',
 * la riga restava "da addebitare" e ogni minuto ripartiva da capo in
 * parallelo al precedente = 338 tentativi in 5 minuti.
 */
export interface StatoCascata {
    cardIndex: number
    livello: number
    /** Prossimo importo da provare a questo livello (null = calcolalo). */
    amount: number | null
    ultimoRifiutato: number | null
}

/** Scalini validi, interi, senza doppioni, dal piu' grande. */
export function normalizzaScalini(raw: unknown): number[] {
    if (!Array.isArray(raw)) return []
    const validi = raw
        .map(v => Math.round(Number(v)))
        .filter(v => Number.isFinite(v) && v > 0)
    return Array.from(new Set(validi)).sort((a, b) => b - a)
}

export async function cascataScalini(args: {
    cards: string[]
    amountCents: number
    stepsCents: number[]
    minAmountCents: number
    maxAttempts: number
    charge: (contractId: string, amountCents: number) => Promise<EsitoTentativo>
    pausa?: () => Promise<void>
    /** Da dove riprendere (giro precedente interrotto per tempo). */
    stato?: StatoCascata | null
    /** true = fermati ORA e restituisci lo stato per il prossimo giro. */
    tempoScaduto?: () => boolean
    /** Chiamata dopo ogni SI', per salvare subito l'incassato. */
    onIncasso?: (contractId: string, amountCents: number) => Promise<void>
}): Promise<RisultatoCascata> {
    const { cards, minAmountCents, maxAttempts, charge } = args
    const steps = normalizzaScalini(args.stepsCents)
    let remainingCents = args.amountCents
    let collectedCents = 0
    let attempts = 0
    let lastError = ''
    const usedCards: string[] = []
    if (steps.length === 0) return { collectedCents, remainingCents, usedCards, attempts, lastError, finita: true, stato: null }

    const fermo = () => remainingCents < minAmountCents || attempts >= maxAttempts
    const ripresa = args.stato || null

    for (let ci = ripresa ? ripresa.cardIndex : 0; ci < cards.length; ci++) {
        if (fermo()) break
        const cid = cards[ci]
        const stessaCarta = !!ripresa && ci === ripresa.cardIndex
        // Importo piu' basso che QUESTA carta ha rifiutato.
        let ultimoRifiutato = stessaCarta && ripresa!.ultimoRifiutato !== null ? ripresa!.ultimoRifiutato : Infinity
        for (let livello = stessaCarta ? ripresa!.livello : 0; livello < steps.length; livello++) {
            if (fermo()) break
            const step = steps[livello]
            let amount: number
            if (stessaCarta && livello === ripresa!.livello && ripresa!.amount !== null) {
                amount = Math.min(ripresa!.amount, remainingCents)
            } else if (livello === 0) {
                amount = remainingCents
            } else {
                const sottoRifiuto = Number.isFinite(ultimoRifiutato)
                    ? Math.floor((ultimoRifiutato - 1) / step) * step
                    : remainingCents
                amount = Math.min(remainingCents, sottoRifiuto)
            }
            while (amount >= minAmountCents && !fermo()) {
                if (args.tempoScaduto && args.tempoScaduto()) {
                    return {
                        collectedCents, remainingCents, usedCards, attempts, lastError, finita: false,
                        stato: { cardIndex: ci, livello, amount, ultimoRifiutato: Number.isFinite(ultimoRifiutato) ? ultimoRifiutato : null },
                    }
                }
                if (attempts > 0 && args.pausa) await args.pausa()
                attempts++
                let esito: EsitoTentativo
                try {
                    esito = await charge(cid, amount)
                } catch (err) {
                    esito = { ok: false, error: err instanceof Error ? err.message : String(err) }
                }
                if (esito.ok) {
                    collectedCents += amount
                    remainingCents -= amount
                    if (!usedCards.includes(cid)) usedCards.push(cid)
                    if (args.onIncasso) await args.onIncasso(cid, amount)
                    amount = Math.min(amount, remainingCents)
                } else {
                    lastError = esito.error || 'DECLINED'
                    ultimoRifiutato = Math.min(ultimoRifiutato, amount)
                    amount -= step
                }
            }
        }
    }
    return { collectedCents, remainingCents, usedCards, attempts, lastError, finita: true, stato: null }
}
