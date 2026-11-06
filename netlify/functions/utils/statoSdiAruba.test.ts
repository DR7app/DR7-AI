import { describe, it, expect } from 'vitest'
import {
  mappaStatoAruba, leggiStatoAruba, righeListaAruba, nomeFileAruba, decidiAggiornamento,
} from './statoSdiAruba'
import { MOTIVO_SCARTO_NON_DISPONIBILE } from './motivoScartoSdi'

// Forma reale della risposta getByFilename (ridotta, vedi motivoScartoSdi.test).
const aruba = (status: string, statusDescription = '', extra: Record<string, unknown> = {}) => ({
  id: 'x', filename: 'IT01879020517_abc12.xml.p7m',
  invoices: [{ number: 'DR7-2026-0100', status, statusDescription }],
  ...extra,
})

describe('mappaStatoAruba', () => {
  it.each([
    ['Scartata', 'rejected'],
    ['SCARTATA ', 'rejected'],
    ['Rifiutata', 'rejected'],
    ['Consegnata', 'accepted'],
    ['Non consegnata', 'accepted'],
    ['Non_Consegnata', 'accepted'],
    ['mancata consegna', 'accepted'],
    ['Recapito impossibile', 'accepted'],
    ['Decorrenza termini', 'accepted'],
    ['Accettata', 'accepted'],
    ['Errore Elaborazione', 'error'],
    ['Inviata', 'sent'],
    ['Presa in carico', 'sent'],
  ])('%s -> %s', (stato, atteso) => {
    expect(mappaStatoAruba(stato)).toBe(atteso)
  })

  it('stato sconosciuto o vuoto: null (non si tocca la fattura)', () => {
    expect(mappaStatoAruba('qualcosa di nuovo')).toBeNull()
    expect(mappaStatoAruba('')).toBeNull()
    expect(mappaStatoAruba(undefined)).toBeNull()
  })
})

describe('leggiStatoAruba', () => {
  it('lo stato sta in invoices[0].status, non in cima alla riga', () => {
    const r = leggiStatoAruba({ ...aruba('Scartata', '00404 Fattura duplicata'), status: 'Consegnata' })
    expect(r.stato).toBe('rejected')
    expect(r.statoAruba).toBe('Scartata')
    expect(r.descrizione).toBe('00404 Fattura duplicata')
  })

  it('ripiego sullo status in cima se invoices manca', () => {
    expect(leggiStatoAruba({ status: 'Scartata' }).stato).toBe('rejected')
  })

  it('una notifica di scarto (NS) vince su uno stato diverso', () => {
    const r = leggiStatoAruba(aruba('Inviata', '', { notifications: [{ docType: 'NS', result: '00311 CodiceDestinatario non valido' }] }))
    expect(r.stato).toBe('rejected')
    expect(r.notificaScarto).toBe(true)
    expect(r.descrizione).toBe('00311 CodiceDestinatario non valido')
  })

  it('RC (consegna) non e\' uno scarto', () => {
    expect(leggiStatoAruba(aruba('Consegnata', '', { notifications: [{ docType: 'RC' }] })).stato).toBe('accepted')
  })
})

describe('righeListaAruba / nomeFileAruba', () => {
  it('pagina Spring: righe in content', () => {
    expect(righeListaAruba({ content: [1, 2], totalPages: 1 })).toEqual([1, 2])
  })
  it('altre chiavi e array nudo', () => {
    expect(righeListaAruba({ invoices: [1] })).toEqual([1])
    expect(righeListaAruba([3])).toEqual([3])
    expect(righeListaAruba(null)).toEqual([])
  })
  it('nome file', () => {
    expect(nomeFileAruba({ filename: 'a.xml.p7m' })).toBe('a.xml.p7m')
    expect(nomeFileAruba({ uploadFileName: 'b.xml' })).toBe('b.xml')
  })
})

describe('decidiAggiornamento', () => {
  const adesso = new Date('2026-11-07T09:00:00.000Z')

  it('accettata nel gestionale, scartata su Aruba: diventa rejected con motivo e notifica', () => {
    const e = decidiAggiornamento({ id: '1', sdi_status: 'accepted' }, aruba('Scartata', '00404 Fattura duplicata'), adesso)
    expect(e.cambiaStato).toBe(true)
    expect(e.da).toBe('accepted')
    expect(e.a).toBe('rejected')
    expect(e.patch.sdi_status).toBe('rejected')
    expect(e.patch.sdi_notification_seen).toBe(false)
    const resp = e.patch.sdi_response as Record<string, unknown>
    expect(resp.stato_aruba).toBe('Scartata')
    expect(resp.motivo_scarto).toBe('00404 Fattura duplicata')
    expect(resp.verificato_il).toBe('2026-11-07T09:00:00.000Z')
  })

  it('scarto senza descrizione: segnaposto esplicito', () => {
    const e = decidiAggiornamento({ id: '1', sdi_status: 'sent' }, aruba('Scartata'), adesso)
    expect(String((e.patch.sdi_response as any).motivo_scarto).startsWith(MOTIVO_SCARTO_NON_DISPONIBILE)).toBe(true)
  })

  it('stesso stato: niente cambio, ma stato Aruba e ora della verifica si scrivono', () => {
    const e = decidiAggiornamento({ id: '1', sdi_status: 'accepted', sdi_response: { vecchio: 1 } }, aruba('Consegnata'), adesso)
    expect(e.cambiaStato).toBe(false)
    expect(e.patch.sdi_status).toBeUndefined()
    expect(e.patch.sdi_notification_seen).toBeUndefined()
    const resp = e.patch.sdi_response as Record<string, unknown>
    expect(resp.vecchio).toBe(1)
    expect(resp.stato_aruba).toBe('Consegnata')
    expect(resp.verificato_il).toBe('2026-11-07T09:00:00.000Z')
  })

  it('stato sconosciuto: sdi_status non si tocca (prima diventava "sent")', () => {
    const e = decidiAggiornamento({ id: '1', sdi_status: 'accepted' }, aruba('Stato mai visto'), adesso)
    expect(e.cambiaStato).toBe(false)
    expect(e.riconosciuto).toBe(false)
    expect(e.patch.sdi_status).toBeUndefined()
  })

  it('non si salvano file e PDF della risposta', () => {
    const e = decidiAggiornamento({ id: '1', sdi_status: 'sent' }, aruba('Consegnata', '', { file: 'BASE64', pdfFile: 'BASE64' }), adesso)
    const resp = e.patch.sdi_response as Record<string, unknown>
    expect(resp.file).toBeUndefined()
    expect(resp.pdfFile).toBeUndefined()
  })

  it('una scartata tornata consegnata perde il vecchio motivo', () => {
    const e = decidiAggiornamento({ id: '1', sdi_status: 'rejected', sdi_response: { motivo_scarto: 'x' } }, aruba('Consegnata'), adesso)
    expect(e.a).toBe('accepted')
    expect((e.patch.sdi_response as any).motivo_scarto).toBeUndefined()
  })
})
