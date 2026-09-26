import { describe, it, expect } from 'vitest'
import { chiaveRecensione, daRecensioneGbp, daRecensionePlaces, stelleDaGoogle } from './recensioniGoogle'

describe('recensioni Google', () => {
  it('traduce le stelle di Google Business', () => {
    expect(stelleDaGoogle('FIVE')).toBe(5)
    expect(stelleDaGoogle('one')).toBe(1)
    expect(stelleDaGoogle('STAR_RATING_UNSPECIFIED')).toBeNull()
    expect(stelleDaGoogle(4)).toBe(4)
    expect(stelleDaGoogle(9)).toBeNull()
  })

  it('legge una recensione Google Business, tenendo solo il testo originale', () => {
    const r = daRecensioneGbp({
      reviewId: 'abc',
      reviewer: { displayName: 'John Smith', profilePhotoUrl: 'https://foto' },
      starRating: 'FIVE',
      comment: 'Great service\n\n(Translated by Google)\nServizio ottimo',
      createTime: '2026-09-20T10:15:00Z',
      reviewReply: { comment: 'Grazie!', updateTime: '2026-09-21T08:00:00Z' },
    })
    expect(r).toMatchObject({
      id: 'john smith|2026-09-20|5', google_review_id: 'abc', source: 'gbp',
      rating: 5, text: 'Great service', reply: 'Grazie!',
    })
    const originale = daRecensioneGbp({ reviewer: { displayName: 'A' }, starRating: 'FOUR', comment: 'Ottimo (Translated by Google) Great (Original) Ottimo davvero', createTime: '2026-09-20T10:00:00Z' })
    expect(originale?.text).toBe('Ottimo davvero')
  })

  it('stessa recensione da Google Business e da Google Maps = stessa chiave', () => {
    const gbp = daRecensioneGbp({ reviewer: { displayName: 'José Pérez' }, starRating: 'FIVE', comment: 'Top', createTime: '2026-09-20T10:15:31Z' })
    const maps = daRecensionePlaces({ author_name: 'jose  perez', rating: 5, text: 'Top', time: Date.parse('2026-09-20T10:15:00Z') / 1000 })
    expect(gbp?.id).toBe(maps?.id)
    expect(chiaveRecensione('Mario', '2026-09-20T10:00:00Z', 5)).not.toBe(chiaveRecensione('Mario', '2026-09-20T10:00:00Z', 4))
  })

  it('Google Maps: forma nuova (time) e vecchia (date/body) della funzione del sito', () => {
    expect(daRecensionePlaces({ author: 'Anna', rating: 5, body: 'Bene', date: '2026-09-01' })).toMatchObject({
      id: 'anna|2026-09-01|5', source: 'places', text: 'Bene',
    })
    expect(daRecensionePlaces({ author_name: 'Anna', rating: 0, text: 'x' })).toBeNull()
  })
})
