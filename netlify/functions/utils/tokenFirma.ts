import crypto from 'crypto'

// 09/10/2026: link di firma corto nel messaggio WhatsApp
// (dr7trust.com/f/<token>). 14 caratteri base62 = circa 83 bit casuali:
// non si indovina in 12 ore di validita'. I token lunghi gia' inviati
// restano validi (dr7trust.com apre sia /firma/ che /f/).
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

export function nuovoTokenFirma(lunghezza = 14): string {
    let token = ''
    while (token.length < lunghezza) {
        for (const byte of crypto.randomBytes(lunghezza * 2)) {
            // 248 = 4 * 62: scarta i byte oltre, nessuna lettera piu' probabile
            if (byte < 248 && token.length < lunghezza) token += ALFABETO[byte % 62]
        }
    }
    return token
}
