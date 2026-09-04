import { describe, it, expect } from 'vitest'
import { addebitiFattura, fattureDaIgnorare, penaliDanniPerPrenotazione, sommaAddebiti, type RigaFatturaAddebito } from './addebitiCliente'

// Caso reale Luca Pilloni (prenotazione b7c5ee9b, 04/09/2026): UNA pratica da
// 5.000 EUR — danno paraurti 2.414,05 + fermo tecnico 2.585,95 — che il Report
// Clienti mostrava come 15.171,90 (penali 5.171,90 + danni 10.000).
const PRENOTAZIONE = 'b7c5ee9b'
const VOCE_PENALE = { description: 'Penale - Fermo tecnico 7GG', total: 2585.95 }
const VOCE_DANNO = { description: 'Danno - danno paraurti anteriore', total: 2414.05 }

const fatture: RigaFatturaAddebito[] = [
  { id: 'f1', booking_id: PRENOTAZIONE, importo_totale: 2585.95, items: [VOCE_PENALE], tipo_fattura: 'penale', stato: 'paid' },
  { id: 'nc1', booking_id: PRENOTAZIONE, importo_totale: 2585.95, items: [VOCE_PENALE], tipo_fattura: 'nota_di_credito', stato: 'paid', related_invoice_id: 'f1' },
  { id: 'f2', booking_id: PRENOTAZIONE, importo_totale: 5000, items: [VOCE_PENALE, VOCE_DANNO], tipo_fattura: 'penale', stato: 'paid' },
  { id: 'nc2', booking_id: PRENOTAZIONE, importo_totale: 5000, items: [VOCE_PENALE, VOCE_DANNO], tipo_fattura: 'nota_di_credito', stato: 'paid', related_invoice_id: 'f2' },
]

const bookings = [{
  id: PRENOTAZIONE,
  booking_details: {
    penalties: [{ label: 'Fermo tecnico 7GG', total: 2585.95 }],
    danni: [{ label: 'danno paraurti anteriore', total: 2414.05 }],
  },
}]

describe('addebitiCliente', () => {
  it('scarta la nota di credito e la fattura che annulla', () => {
    const fuori = fattureDaIgnorare(fatture)
    expect([...fuori].sort()).toEqual(['f1', 'f2', 'nc1', 'nc2'])
  })

  it('somma per item, non l intero importo della fattura', () => {
    expect(addebitiFattura(fatture[2].items)).toMatchObject({ penali: 2585.95, danni: 2414.05 })
  })

  it('sottrae la riga Sconto partendo dai penali', () => {
    const items = [
      { description: 'Penale - Ritardo', total: 600 },
      { description: 'Sconto', total: -150 },
    ]
    expect(addebitiFattura(items)).toMatchObject({ penali: 450, danni: 0 })
  })

  it('la pratica Pilloni vale 5.000, non 15.171,90', () => {
    const perPrenotazione = penaliDanniPerPrenotazione(bookings, fatture)
    const tot = sommaAddebiti(perPrenotazione.values())
    expect(tot.penali).toBe(2585.95)
    expect(tot.danni).toBe(2414.05)
    expect(tot.penali + tot.danni).toBe(5000)
  })

  it('non conta due volte la stessa penale presente in booking_details e in fattura', () => {
    const soloFatturaValida: RigaFatturaAddebito[] = [
      { id: 'f9', booking_id: PRENOTAZIONE, importo_totale: 2585.95, items: [VOCE_PENALE], tipo_fattura: 'penale', stato: 'paid' },
    ]
    const tot = sommaAddebiti(penaliDanniPerPrenotazione(bookings, soloFatturaValida).values())
    expect(tot.penali).toBe(2585.95)
    expect(tot.danni).toBe(2414.05)
  })

  it('tiene i penali senza fattura', () => {
    const tot = sommaAddebiti(penaliDanniPerPrenotazione(bookings, []).values())
    expect(tot.penali).toBe(2585.95)
    expect(tot.danni).toBe(2414.05)
  })
})
