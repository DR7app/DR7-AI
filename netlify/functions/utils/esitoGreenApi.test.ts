import { describe, it, expect } from 'vitest'
import {
  classificaRispostaGreenApi, classificaEccezioneGreenApi, leggiCorpo,
  reinvioAutomaticoSicuro, reinvioScaduto, rigaLogWhatsapp, REINVIO_SCADE_ORE,
} from './esitoGreenApi'
import { sanifica } from './systemControl'
import { interpretaRisposta } from './systemControlRetry'

describe('classificaRispostaGreenApi', () => {
  it('200 con idMessage = inviato', () => {
    expect(classificaRispostaGreenApi(200, { idMessage: 'BAE5ABC' })).toEqual({ tipo: 'inviato', idMessage: 'BAE5ABC' })
  })

  it('200 senza idMessage NON conta come inviato', () => {
    const e = classificaRispostaGreenApi(200, {})
    expect(e.tipo).toBe('errore')
  })

  it('200 con campo error NON conta come inviato', () => {
    expect(classificaRispostaGreenApi(200, { idMessage: 'X', error: 'boom' }).tipo).toBe('errore')
  })

  it.each([401, 403, 466])('HTTP %i = istanza non disponibile', (status) => {
    const e = classificaRispostaGreenApi(status, leggiCorpo('Unauthorized'))
    expect(e.tipo).toBe('istanza_non_disponibile')
    if (e.tipo !== 'inviato') expect(e.status).toBe(status)
  })

  it('testo notAuthorized con un altro status = istanza non disponibile', () => {
    const e = classificaRispostaGreenApi(400, { error: 'Instance is notAuthorized' })
    expect(e.tipo).toBe('istanza_non_disponibile')
  })

  it('stateInstance notAuthorized nel corpo', () => {
    expect(classificaRispostaGreenApi(200, { stateInstance: 'notAuthorized' }).tipo).toBe('istanza_non_disponibile')
  })

  it('yellowCard e quota esaurita', () => {
    expect(classificaRispostaGreenApi(400, { message: 'yellowCard' }).tipo).toBe('istanza_non_disponibile')
    expect(classificaRispostaGreenApi(429, { message: 'Correspondents quota exceeded' }).tipo).toBe('istanza_non_disponibile')
  })

  it('400 di validazione e 5xx restano errori generici (esito incerto, ripresa manuale)', () => {
    expect(classificaRispostaGreenApi(400, { message: 'Validation failed: chatId' }).tipo).toBe('errore')
    expect(classificaRispostaGreenApi(500, leggiCorpo('<html>Internal error</html>')).tipo).toBe('errore')
    expect(classificaRispostaGreenApi(502, '').tipo).toBe('errore')
  })

  it('il motivo riporta lo status e non espone token', () => {
    const e = classificaRispostaGreenApi(401, { error: 'bad token=abcdef123456' })
    if (e.tipo === 'inviato') throw new Error('atteso errore')
    expect(e.motivo).toContain('HTTP 401')
    expect(e.motivo).not.toContain('abcdef123456')
  })

  it('corpo non JSON: leggiCorpo restituisce il testo', () => {
    expect(leggiCorpo('not json')).toBe('not json')
    expect(leggiCorpo('{"idMessage":"A"}')).toEqual({ idMessage: 'A' })
  })
})

describe('classificaEccezioneGreenApi', () => {
  it('errore di rete = esito incerto, mai "istanza non disponibile"', () => {
    const e = classificaEccezioneGreenApi(new Error('fetch failed'))
    expect(e.tipo).toBe('errore')
  })
})

describe('reinvioAutomaticoSicuro', () => {
  const istanza = classificaRispostaGreenApi(466, {})
  const generico = classificaRispostaGreenApi(500, {})

  it('si rimanda da solo solo se l istanza ha rifiutato l invio', () => {
    const p = { customPhone: '393331234567', message: 'Ciao', type: 'manuale' }
    expect(reinvioAutomaticoSicuro(istanza, p, sanifica(p))).toBe(true)
    expect(reinvioAutomaticoSicuro(generico, p, sanifica(p))).toBe(false)
  })

  it('mai per gli OTP', () => {
    const p = { customPhone: '39333', messageKey: 'signature_otp_whatsapp', templateVars: { codice: '123456' } }
    expect(reinvioAutomaticoSicuro(istanza, p, sanifica(p))).toBe(false)
  })

  it('mai se la sanificazione ha mascherato un dato del messaggio', () => {
    const p = { customPhone: '39333', templateKey: 'deposit_return_iban', templateVars: { iban: 'IT60X0542811101000000123456' } }
    expect(reinvioAutomaticoSicuro(istanza, p, sanifica(p))).toBe(false)
  })

  it('booking con id: troncamento/mascheratura della prenotazione non conta (si rilegge dal DB)', () => {
    const booking: Record<string, unknown> = { id: 'b1', nexi_authorization_code: 'X1' }
    for (let i = 0; i < 100; i++) booking[`col_${i}`] = i
    const p = { booking, type: 'reminder' }
    expect(reinvioAutomaticoSicuro(istanza, p, sanifica(p))).toBe(true)
  })

  it('booking senza id: deve arrivare intatto', () => {
    const p = { booking: { nexi_authorization_code: 'X1', customer_name: 'Mario' }, type: 'reminder' }
    expect(reinvioAutomaticoSicuro(istanza, p, sanifica(p))).toBe(false)
  })
})

describe('reinvioScaduto', () => {
  it(`scade dopo ${REINVIO_SCADE_ORE} ore`, () => {
    const ora = Date.parse('2026-10-01T10:00:00Z')
    expect(reinvioScaduto('2026-09-30T18:00:00Z', ora)).toBe(false)
    expect(reinvioScaduto('2026-09-30T09:00:00Z', ora)).toBe(true)
    expect(reinvioScaduto(undefined, ora)).toBe(false)
    expect(reinvioScaduto('non una data', ora)).toBe(false)
  })
})

describe('rigaLogWhatsapp', () => {
  it('successo: status sent, testo invariato, solo colonne esistenti', () => {
    const r = rigaLogWhatsapp({ nome: 'Mario', telefono: '39333', testo: 'Ciao', etichetta: 'Notifica', esito: { tipo: 'inviato', idMessage: 'A' } })
    expect(r).toEqual({ customer_name: 'Mario', customer_phone: '39333', message_text: 'Ciao', template_label: 'Notifica', status: 'sent' })
  })

  it('fallimento: status failed con il motivo in testa al testo', () => {
    const r = rigaLogWhatsapp({ telefono: '39333', testo: 'Ciao', esito: classificaRispostaGreenApi(401, { error: 'notAuthorized' }), inCoda: true })
    expect(r.status).toBe('failed')
    expect(r.customer_name).toBe('N/A')
    expect(r.message_text).toMatch(/^\[NON INVIATO — Green API HTTP 401/)
    expect(r.message_text).toContain('in coda')
    expect(r.message_text.endsWith('Ciao')).toBe(true)
    expect(Object.keys(r).sort()).toEqual(['customer_name', 'customer_phone', 'message_text', 'status', 'template_label'])
  })
})

describe('contratto con il worker System Control', () => {
  it('la risposta "istanza giu" alla ripresa e sospesa (non consuma tentativi)', () => {
    const corpo = JSON.stringify({ success: false, skipped: true, reason: 'green_api_istanza_off', message: 'x' })
    expect(interpretaRisposta(200, corpo).tipo).toBe('sospesa')
  })
  it('reinvio scaduto = ignorata (operazione annullata)', () => {
    const corpo = JSON.stringify({ success: false, skipped: true, reason: 'reinvio_scaduto' })
    expect(interpretaRisposta(200, corpo).tipo).toBe('ignorata')
  })
})
