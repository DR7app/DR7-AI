import { describe, it, expect } from 'vitest'
import { trovaDoppioni, isFatturaPrincipale } from './fattureDoppie'

const B1 = 'booking-1'
const B2 = 'booking-2'

describe('trovaDoppioni', () => {
  it('non conta la penale come seconda fattura della prenotazione', () => {
    const { ids } = trovaDoppioni([
      { id: 'a', booking_id: B1, sdi_status: 'sent', created_at: '2026-01-01' },
      { id: 'b', booking_id: B1, tipo_fattura: 'penale', sdi_status: 'sent', created_at: '2026-01-05' },
    ])
    expect(ids.size).toBe(0)
  })

  it('tiene la fattura gia\' trasmessa a SDI, anche se e\' la piu\' vecchia', () => {
    const { ids } = trovaDoppioni([
      { id: 'vecchia-sent', booking_id: B1, sdi_status: 'sent', created_at: '2026-01-01' },
      { id: 'bozza-recente', booking_id: B1, sdi_status: 'draft', created_at: '2026-01-07' },
    ])
    expect([...ids]).toEqual(['bozza-recente'])
  })

  it('lo stato SDI nullo non scavalca la fattura trasmessa', () => {
    // Il caso che rompeva la vista SQL: `sdi_status` nullo dava NULL, non false,
    // e in ordinamento decrescente i NULL vengono per primi.
    const { ids } = trovaDoppioni([
      { id: 'sent', booking_id: B1, sdi_status: 'sent', created_at: '2026-01-01' },
      { id: 'nullo', booking_id: B1, sdi_status: null, created_at: '2026-01-07' },
    ])
    expect([...ids]).toEqual(['nullo'])
  })

  it('segnala quali doppioni hanno valore fiscale', () => {
    const { ids, idsConValoreFiscale } = trovaDoppioni([
      { id: 'a', booking_id: B1, sdi_status: 'sent', created_at: '2026-01-01' },
      { id: 'b', booking_id: B1, sdi_status: 'accepted', created_at: '2026-01-02' },
      { id: 'c', booking_id: B1, sdi_status: 'draft', created_at: '2026-01-03' },
    ])
    expect(ids).toEqual(new Set(['b', 'c']))
    expect(idsConValoreFiscale).toEqual(new Set(['b']))
  })

  it('non tocca estensioni, note di credito e fatture annullate', () => {
    const righe = [
      { id: 'principale', booking_id: B2, sdi_status: 'sent', created_at: '2026-04-01' },
      { id: 'est-0', booking_id: B2, extension_index: 0, created_at: '2026-04-02' },
      { id: 'est-1', booking_id: B2, extension_index: 1, created_at: '2026-04-03' },
      { id: 'nota', booking_id: B2, tipo_fattura: 'nota_di_credito', created_at: '2026-04-04' },
      { id: 'annullata', booking_id: B2, stato: 'cancelled', created_at: '2026-04-05' },
    ]
    expect(trovaDoppioni(righe).ids.size).toBe(0)
    expect(isFatturaPrincipale(righe[1])).toBe(false)
  })

  it('una fattura senza prenotazione non e\' mai un doppione', () => {
    const { ids } = trovaDoppioni([
      { id: 'a', booking_id: null, created_at: '2026-01-01' },
      { id: 'b', booking_id: null, created_at: '2026-01-02' },
    ])
    expect(ids.size).toBe(0)
  })
})

describe('estensioni', () => {
  it('la fattura di estensione non e\' un doppione della principale', () => {
    const { ids } = trovaDoppioni([
      { id: 'principale', booking_id: 'b', sdi_status: 'sent', created_at: '2026-05-01' },
      { id: 'est-1', booking_id: 'b', tipo_fattura: 'estensione', sdi_status: 'sent', created_at: '2026-05-02' },
      { id: 'est-2', booking_id: 'b', tipo_fattura: 'estensione', sdi_status: 'draft', created_at: '2026-05-03' },
    ])
    expect(ids.size).toBe(0)
  })
})
