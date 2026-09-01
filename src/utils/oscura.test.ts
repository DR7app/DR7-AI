import { describe, it, expect } from 'vitest'
import { mascheraDati, mascheraRisposta, elencoDaSfocare } from './oscura'

type Riga = Record<string, unknown>

/** I valori personali non si cambiano: si segnano per essere sfocati. */
const segnato = (v: string) => elencoDaSfocare().includes(v.trim().toLowerCase())

describe('Oscurare — i dati restano veri, si sfoca solo cio che si vede', () => {
  it('NON cambia nessun dato di una prenotazione', () => {
    const riga = {
      id: 'b1',
      customer_name: 'Massimo Runchina',
      customer_email: 'massimo.runchina@gmail.com',
      customer_phone: '+39 340 1234567',
      customer_address: 'Via Sant Avendrace 88',
      customer_tax_code: 'RNCMSM85A01B354K',
      total_price: 450,
      status: 'confirmed',
    }
    const [r] = mascheraDati([{ ...riga }]) as Riga[]
    expect(r).toEqual(riga)
  })

  it('segna nome, email, telefono, indirizzo e codice fiscale', () => {
    mascheraDati([{
      customer_name: 'Fabrizio Atzeni',
      customer_email: 'fabrizio@tiscali.it',
      customer_phone: '+39 340 9998877',
    }])
    expect(segnato('Fabrizio Atzeni')).toBe(true)
    expect(segnato('fabrizio@tiscali.it')).toBe(true)
    expect(segnato('+39 340 9998877')).toBe(true)
  })

  it('segna il nome nella riga report con chiave `cliente`', () => {
    const [r] = mascheraDati([{
      id: 'p1', cliente: 'Mario Furcas', veicolo: 'BMW M8', targa: 'GA123AB', importo: 390,
    }]) as Riga[]
    expect(r.cliente).toBe('Mario Furcas')
    expect(segnato('Mario Furcas')).toBe(true)
  })

  it('segna il nome anche in una riga aggregata senza email ne telefono', () => {
    mascheraDati([{ nome: 'Riccardo Pilia', totale: 1500 }])
    expect(segnato('Riccardo Pilia')).toBe(true)
  })

  it('NON segna il nome di un veicolo o di un servizio', () => {
    mascheraDati([{ id: 'v1', name: 'Lamborghini Urus', plate: 'GA1AB', category: 'supercars' }])
    expect(segnato('Lamborghini Urus')).toBe(false)
    mascheraDati([{ nome: 'Lavaggio Completo', price_per_day: 5000, is_active: true }])
    expect(segnato('Lavaggio Completo')).toBe(false)
  })

  it('scende dentro i JSONB annidati', () => {
    mascheraDati([{ id: 'b2', booking_details: { customer: { fullName: 'Ivan Piras', email: 'ivan@x.it' } } }])
    expect(segnato('Ivan Piras')).toBe(true)
  })

  it('legge anche una risposta SENZA content-type (come monthly-report)', async () => {
    const corpo = JSON.stringify([{ customer_name: 'Fedrico Frongia', totale: 390 }])
    const fuori = await mascheraRisposta(new Response(corpo, { status: 200 }))
    const [r] = await fuori.json() as Riga[]
    expect(r.customer_name).toBe('Fedrico Frongia')   // il dato resta vero
    expect(segnato('Fedrico Frongia')).toBe(true)     // ma verra' sfocato
  })

  it('non tocca una risposta binaria (PDF)', async () => {
    const res = new Response('%PDF-1.4 binario', { status: 200, headers: { 'content-type': 'application/pdf' } })
    expect(await (await mascheraRisposta(res)).text()).toBe('%PDF-1.4 binario')
  })

  it('non segna targa, stato e id', () => {
    mascheraDati([{ id: 'abc-123', targa: 'KRA124EF', status: 'confirmed' }])
    expect(segnato('KRA124EF')).toBe(false)
    expect(segnato('confirmed')).toBe(false)
  })
})
