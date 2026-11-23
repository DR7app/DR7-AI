import { describe, it, expect } from 'vitest'
import { autoProposte, categoriaPerEsperienza, disponibilitaCortesia, intervalliOccupati, oreDaEtichetta } from './autoCortesia'

const h = (hm: string) => new Date(`2026-11-24T${hm}:00Z`).getTime()

describe('disponibilitaCortesia', () => {
  it('auto libera: parte all ora del lavaggio, ore fino alla chiusura (max 7)', () => {
    expect(disponibilitaCortesia({ inizioLavaggio: h('09:30'), chiusura: h('17:00'), occupati: [], bufferMin: 90 }))
      .toEqual({ liberaDa: h('09:30'), oreMax: 7 })
    expect(disponibilitaCortesia({ inizioLavaggio: h('14:00'), chiusura: h('17:00'), occupati: [], bufferMin: 90 }))
      .toEqual({ liberaDa: h('14:00'), oreMax: 3 })
  })

  it('auto fuori: libera dalla fine + buffer, arrotondata al quarto d ora', () => {
    const occ = [{ inizio: h('08:00'), fine: h('08:20') }]
    // 08:20 + 90 min = 09:50 -> 10:00
    expect(disponibilitaCortesia({ inizioLavaggio: h('09:30'), chiusura: h('17:00'), occupati: occ, bufferMin: 90 }))
      .toEqual({ liberaDa: h('10:00'), oreMax: 7 })
  })

  it('prossima prenotazione taglia le ore (nessun buffer prima)', () => {
    const occ = [{ inizio: h('11:00'), fine: h('15:00') }]
    expect(disponibilitaCortesia({ inizioLavaggio: h('09:30'), chiusura: h('17:00'), occupati: occ, bufferMin: 90 }))
      .toEqual({ liberaDa: h('09:30'), oreMax: 1 })
  })

  it('prenotazioni accavallate: salta oltre entrambe', () => {
    const occ = [{ inizio: h('08:00'), fine: h('10:00') }, { inizio: h('10:30'), fine: h('12:00') }]
    expect(disponibilitaCortesia({ inizioLavaggio: h('09:00'), chiusura: h('17:00'), occupati: occ, bufferMin: 60 }))
      .toEqual({ liberaDa: h('13:00'), oreMax: 4 })
  })

  it('meno di un ora o oltre la chiusura = non disponibile', () => {
    expect(disponibilitaCortesia({ inizioLavaggio: h('16:30'), chiusura: h('17:00'), occupati: [], bufferMin: 90 }))
      .toEqual({ liberaDa: null, oreMax: 0 })
    expect(disponibilitaCortesia({ inizioLavaggio: h('09:00'), chiusura: h('17:00'), occupati: [{ inizio: h('08:00'), fine: h('16:00') }], bufferMin: 90 }))
      .toEqual({ liberaDa: null, oreMax: 0 })
  })
})

describe('orari di ritiro (Centralina)', () => {
  const fr = [{ inizio: h('10:00'), fine: h('18:30') }]
  it('lavaggio prima dell apertura: l auto parte alle 10:00', () => {
    expect(disponibilitaCortesia({ inizioLavaggio: h('09:00'), chiusura: h('17:30'), occupati: [], bufferMin: 90, finestreRitiro: fr }))
      .toEqual({ liberaDa: h('10:00'), oreMax: 7 })
  })
  it('auto libera dopo le 18:30: non disponibile', () => {
    expect(disponibilitaCortesia({ inizioLavaggio: h('09:00'), chiusura: h('20:00'), occupati: [{ inizio: h('08:00'), fine: h('17:30') }], bufferMin: 90, finestreRitiro: fr }))
      .toEqual({ liberaDa: null, oreMax: 0 })
  })
})

describe('intervalliOccupati', () => {
  const v = { id: 'v1', display_name: 'Yaris', plate: 'AB 123 CD', category: 'urban', status: 'available' }
  it('match per id o targa, ignora lavaggi e annullate', () => {
    const r = intervalliOccupati(v, [
      { id: 'a', vehicle_id: 'v1', service_type: 'rental', status: 'confirmed', pickup_date: '2026-11-24T08:00:00Z', dropoff_date: '2026-11-24T09:00:00Z' },
      { id: 'b', vehicle_plate: 'ab123cd', service_type: 'car_rental', status: 'active', pickup_date: '2026-11-24T12:00:00Z', dropoff_date: '2026-11-24T13:00:00Z' },
      { id: 'c', vehicle_plate: 'AB123CD', service_type: 'car_wash', status: 'confirmed', pickup_date: '2026-11-24T10:00:00Z', dropoff_date: '2026-11-24T11:00:00Z' },
      { id: 'd', vehicle_id: 'v1', service_type: 'rental', status: 'cancelled', pickup_date: '2026-11-24T14:00:00Z', dropoff_date: '2026-11-24T15:00:00Z' },
    ])
    expect(r).toEqual([{ inizio: h('08:00'), fine: h('09:00') }, { inizio: h('12:00'), fine: h('13:00') }])
  })
})

describe('categoriaPerEsperienza', () => {
  const cat = [
    { id: 'urban', label: 'Urban' },
    { id: 'aziendali', label: 'Supercar' },
    { id: 'supercars', label: 'Exotic Cars' },
    { id: 'hyper', label: 'Hypercar' },
    { id: 'supercar_elit', label: 'Ducato Maxi' },
  ]
  it('abbina per etichetta, non per id', () => {
    expect(categoriaPerEsperienza({ id: '1', name: 'DR7 UTILITARIA DI CORTESIA' }, cat)?.id).toBe('urban')
    expect(categoriaPerEsperienza({ id: '2', name: 'DR7 SUPERCAR' }, cat)?.id).toBe('aziendali')
    expect(categoriaPerEsperienza({ id: '3', name: 'DR7 EXOTIC CAR' }, cat)?.id).toBe('supercars')
    expect(categoriaPerEsperienza({ id: '4', name: 'DR7 HYPERCAR' }, cat)?.id).toBe('hyper')
  })
})

describe('autoProposte', () => {
  it('solo categorie con scheda; alias supercars/exotic; disponibili prima', () => {
    const r = autoProposte({
      schede: [{ id: 's-exo', name: 'DR7 EXOTIC CAR', price_options: [{ label: '1h', price: 50 }] }],
      categorie: [{ id: 'supercars', label: 'Exotic Cars' }, { id: 'urban', label: 'Urban' }],
      veicoli: [
        { id: 'f', display_name: 'Ferrari', plate: 'F1', category: 'exotic', status: 'available' },
        { id: 'l', display_name: 'Lambo', plate: 'L1', category: 'supercars', status: 'available' },
        { id: 'y', display_name: 'Yaris', plate: 'Y1', category: 'urban', status: 'available' },
        { id: 'r', display_name: 'Rotta', plate: 'R1', category: 'supercars', status: 'retired' },
      ],
      prenotazioni: [{ vehicle_id: 'l', service_type: 'rental', status: 'confirmed', pickup_date: '2026-11-24T07:00:00Z', dropoff_date: '2026-11-24T09:00:00Z' }],
      inizioLavaggio: h('09:30'), chiusura: h('17:00'), bufferMin: 90,
    })
    expect(r.map(x => x.veicolo.id)).toEqual(['f', 'l'])
    expect(r[1].disponibilita.liberaDa).toBe(h('10:30'))
  })
})

describe('oreDaEtichetta', () => {
  it('legge le ore', () => {
    expect(oreDaEtichetta('3h')).toBe(3)
    expect(oreDaEtichetta('7 ore')).toBe(7)
    expect(oreDaEtichetta('30 min')).toBeNull()
  })
})
