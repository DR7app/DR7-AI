/**
 * Regole della password del gestionale.
 *
 * 2026-08-25 (richiesta direzione): almeno una lettera maiuscola, un numero e
 * un simbolo. Prima bastavano 6 caratteri qualsiasi, quindi "123456" passava.
 *
 * Un solo file perche' i punti in cui si sceglie una password sono tre e
 * finora avevano regole diverse: reset password (pagina pubblica), cambio
 * password dal menu utente, e password temporanea alla creazione di un
 * operatore — che gia' chiedeva 8 caratteri. Il minimo e' 8 ovunque: non ha
 * senso che si possa REIMPOSTARE una password piu' debole di quella con cui
 * l'account e' stato creato.
 */

export const PASSWORD_MIN = 8

export interface RegolaPassword {
    id: 'lunghezza' | 'maiuscola' | 'numero' | 'simbolo'
    testo: string
    ok: boolean
}

/** Le regole con il loro stato, per mostrare una checklist mentre si scrive. */
export function regolePassword(password: string): RegolaPassword[] {
    const p = password || ''
    return [
        { id: 'lunghezza', testo: `Almeno ${PASSWORD_MIN} caratteri`, ok: p.length >= PASSWORD_MIN },
        { id: 'maiuscola', testo: 'Almeno 1 lettera maiuscola', ok: /[A-Z]/.test(p) },
        { id: 'numero', testo: 'Almeno 1 numero', ok: /[0-9]/.test(p) },
        // Simbolo = qualsiasi cosa che non sia lettera, numero o spazio.
        { id: 'simbolo', testo: 'Almeno 1 simbolo (! ? @ # ...)', ok: /[^A-Za-z0-9\s]/.test(p) },
    ]
}

export function passwordValida(password: string): boolean {
    return regolePassword(password).every(r => r.ok)
}

/**
 * Messaggio d'errore che dice cosa manca davvero, non "password non valida".
 * `null` quando la password va bene.
 */
export function errorePassword(password: string): string | null {
    const mancanti = regolePassword(password).filter(r => !r.ok)
    if (mancanti.length === 0) return null
    if (mancanti.length === 1) return `Manca: ${mancanti[0].testo.toLowerCase()}.`
    const elenco = mancanti.map(r => r.testo.toLowerCase()).join(', ')
    return `Mancano: ${elenco}.`
}

/**
 * Password temporanea che rispetta SEMPRE le regole: una maiuscola, una
 * minuscola, un numero e un simbolo garantiti, poi riempita a caso e
 * mescolata. Caratteri ambigui esclusi (0/O/l/I) perche' queste password si
 * dettano a voce o si copiano da un messaggio.
 */
export function generaPasswordTemporanea(lunghezza = 14): string {
    const MAIUSCOLE = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
    const minuscole = 'abcdefghijkmnopqrstuvwxyz'
    const numeri = '23456789'
    const simboli = '!@#$%&?*'
    const tutti = MAIUSCOLE + minuscole + numeri + simboli

    const casuali = new Uint32Array(Math.max(lunghezza, PASSWORD_MIN) + 4)
    crypto.getRandomValues(casuali)
    let i = 0
    const prendi = (set: string) => set[casuali[i++] % set.length]

    const caratteri = [prendi(MAIUSCOLE), prendi(minuscole), prendi(numeri), prendi(simboli)]
    while (caratteri.length < Math.max(lunghezza, PASSWORD_MIN)) caratteri.push(prendi(tutti))

    // Mescola, altrimenti l'ordine delle classi e' sempre lo stesso.
    const mix = new Uint32Array(caratteri.length)
    crypto.getRandomValues(mix)
    for (let j = caratteri.length - 1; j > 0; j--) {
        const k = mix[j] % (j + 1)
        ;[caratteri[j], caratteri[k]] = [caratteri[k], caratteri[j]]
    }
    return caratteri.join('')
}
