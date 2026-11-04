import { describe, it, expect, vi } from 'vitest'

vi.mock('../supabaseClient', () => ({ supabase: {} }))
import { applicaPrevenditaAlPrezzo, prevenditeSpendibili, kmConPrevendita, stessaAssicurazione, type PrevenditaCliente } from './prevenditaPrenotazione'

const base: PrevenditaCliente = {
  id: '22655a93-ff11-41ff-926e-2825087de1e8', user_id: null, customer_email: 'cliente@example.com',
  nome: 'Macan gts Runchina', utilizzi_iniziali: 2, utilizzi_usati: 0,
  veicoli: [{ id: 'veh-1', nome: 'Porsche Macan GTS' }], km_inclusi: 0, assicurazione_inclusa: null,
  max_utilizzi_mese: null, max_giorni_consecutivi: null, data_scadenza: null, stato: 'attiva', payment_status: 'succeeded',
}
const voci = { noleggio: 600, lavaggio: 30, assicurazione: 90, assicurazioneInclusaGiorno: 0, giorni: 3, kmIllimitati: 150, pacchettiKm: 40 }

describe('prevendite nel gestionale', () => {
  it('spendibile per id o per nome, mai se non pagata / esaurita / scaduta', () => {
    expect(prevenditeSpendibili([base], 'veh-1', null)).toHaveLength(1)
    expect(prevenditeSpendibili([base], 'altro', 'porsche  macan-gts')).toHaveLength(1)
    expect(prevenditeSpendibili([base], 'altro', 'Porsche Cayenne')).toHaveLength(0)
    expect(prevenditeSpendibili([{ ...base, payment_status: 'pending' }], 'veh-1', null)).toHaveLength(0)
    expect(prevenditeSpendibili([{ ...base, utilizzi_usati: 2 }], 'veh-1', null)).toHaveLength(0)
    expect(prevenditeSpendibili([{ ...base, data_scadenza: '2020-01-01T00:00:00Z' }], 'veh-1', null)).toHaveLength(0)
    expect(prevenditeSpendibili([{ ...base, stato: 'bloccata' }], 'veh-1', null)).toHaveLength(0)
  })
  it('senza prevendita il prezzo non cambia', () => {
    const r = applicaPrevenditaAlPrezzo(null, voci)
    expect(r).toMatchObject({ ...voci, copertura: 0, saltaClamp: false })
  })
  it('noleggio e lavaggio a zero, km e assicurazione si pagano, clamp spento', () => {
    const r = applicaPrevenditaAlPrezzo(base, voci)
    expect(r.noleggio).toBe(0)
    expect(r.lavaggio).toBe(0)
    expect(r.assicurazione).toBe(90)
    expect(r.kmIllimitati).toBe(150)
    expect(r.pacchettiKm).toBe(40)
    expect(r.copertura).toBe(630)
    expect(r.saltaClamp).toBe(true)
  })
  it('assicurazione compresa: coperta fino al suo prezzo x giorni', () => {
    const r = applicaPrevenditaAlPrezzo({ ...base, assicurazione_inclusa: 'Kasko' }, { ...voci, assicurazione: 150, assicurazioneInclusaGiorno: 30 })
    expect(r.assicurazione).toBe(60)
    expect(r.copertura).toBe(720)
  })
  it('pacchetto km illimitati: km illimitati e pacchetti km a zero', () => {
    const r = applicaPrevenditaAlPrezzo({ ...base, km_inclusi: 9999 }, voci)
    expect(r.kmIllimitati).toBe(0)
    expect(r.pacchettiKm).toBe(0)
    expect(kmConPrevendita({ ...base, km_inclusi: 9999 }, 0)).toBe('illimitati')
    expect(kmConPrevendita({ ...base, km_inclusi: 100 }, 50)).toBe(150)
    expect(kmConPrevendita(base, 50)).toBeNull()
  })
  it('stessa assicurazione per nome ripulito', () => {
    expect(stessaAssicurazione('RCA Compresa (no Kasko)', 'RCA')).toBe(true)
    expect(stessaAssicurazione('Kasko Full', 'Kasko Base')).toBe(false)
  })
})
