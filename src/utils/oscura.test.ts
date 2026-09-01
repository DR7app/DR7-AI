import { describe, it, expect } from 'vitest'
import { mascheraDati, mascheraRisposta } from './oscura'

type Riga = Record<string, unknown>

describe('Oscurare — mascheratura dei dati clienti', () => {
  it('sostituisce i campi personali di una prenotazione', () => {
    const [r] = mascheraDati([{
      id: 'b1',
      customer_name: 'Massimo Runchina',
      customer_email: 'massimo.runchina@gmail.com',
      customer_phone: '+39 340 1234567',
      customer_address: 'Via Sant Avendrace 88',
      customer_tax_code: 'RNCMSM85A01B354K',
      total_price: 450,
      status: 'confirmed',
    }]) as Riga[]

    expect(r.customer_name).not.toBe('Massimo Runchina')
    expect(String(r.customer_name)).toMatch(/^[A-Z][a-z]+ /)
    expect(String(r.customer_email)).toContain('@example.it')
    expect(String(r.customer_phone)).toMatch(/^\+39 3/)
    expect(String(r.customer_address)).toMatch(/^(Via|Viale|Corso) /)
    expect(String(r.customer_tax_code)).toHaveLength(16)
    // Quello che non e' personale non si tocca.
    expect(r.total_price).toBe(450)
    expect(r.status).toBe('confirmed')
    expect(r.id).toBe('b1')
  })

  it('da sempre lo stesso nome finto allo stesso cliente', () => {
    const uno = mascheraDati({ customer_name: 'Massimo Runchina' }) as Riga
    const due = mascheraDati({ customer_name: 'Massimo Runchina' }) as Riga
    const altro = mascheraDati({ customer_name: 'Riccardo Pilia' }) as Riga
    expect(uno.customer_name).toBe(due.customer_name)
    expect(uno.customer_name).not.toBe(altro.customer_name)
  })

  it('maschera `nome` solo dentro una scheda di persona', () => {
    const cliente = mascheraDati({ nome: 'Massimo', cognome: 'Runchina' }) as Riga
    expect(cliente.nome).not.toBe('Massimo')
    expect(cliente.cognome).not.toBe('Runchina')

    const veicolo = mascheraDati({ nome: 'Lamborghini Urus', targa: 'GA123BC', prezzo: 900 }) as Riga
    expect(veicolo.nome).toBe('Lamborghini Urus')
    expect(veicolo.targa).toBe('GA123BC')
  })

  it('scende dentro i JSONB annidati', () => {
    const r = mascheraDati({
      id: 'x',
      booking_details: { customer_data: { email: 'vero@cliente.it', telefono: '3401234567' } },
    }) as Riga
    const dentro = (r.booking_details as Riga).customer_data as Riga
    expect(dentro.email).toContain('@example.it')
    expect(dentro.telefono).not.toBe('3401234567')
  })

  it('sostituisce i nomi gia visti anche dentro le note', () => {
    mascheraDati({ customer_name: 'Massimo Runchina' })
    const r = mascheraDati({ note: 'Chiamare Massimo Runchina prima del ritiro' }) as Riga
    expect(String(r.note)).not.toContain('Massimo Runchina')
    expect(String(r.note)).toContain('prima del ritiro')
  })

  it('non tocca IBAN e partita IVA con il formato sbagliato', () => {
    const r = mascheraDati({ iban: 'IT60X0542811101000000123456', partita_iva: '03956780927' }) as Riga
    expect(String(r.iban)).toMatch(/^IT\d{2}[A-Z]\d{22}$/)
    expect(String(r.partita_iva)).toMatch(/^\d{11}$/)
    expect(r.iban).not.toBe('IT60X0542811101000000123456')
  })

  // Regressione 01/09/2026: nei report restavano nomi di clienti in chiaro.
  it('maschera il nome nella riga report con chiave `cliente`', () => {
    const [r] = mascheraDati([{
      id: 'p1', cliente: 'Fabrizio Atzeni', veicolo: 'BMW M8', targa: 'GA123AB',
      importo: 390, metodo: 'Carta', stato: 'pagato',
    }]) as Riga[]
    expect(r.cliente).not.toBe('Fabrizio Atzeni')
    expect(String(r.cliente)).toMatch(/^[A-Z][a-z]+ /)
  })

  it('`cliente` che contiene un email resta un email', () => {
    const [r] = mascheraDati([{ cliente: 'mario.furcas@gmail.com', importo: 10 }]) as Riga[]
    expect(String(r.cliente)).toContain('@example.it')
  })

  it('maschera `nome` anche in una riga aggregata senza email ne telefono', () => {
    const [r] = mascheraDati([{ nome: 'Riccardo Pilia', totale: 1500, prenotazioni: 3 }]) as Riga[]
    expect(r.nome).not.toBe('Riccardo Pilia')
  })

  it('NON maschera il nome di un veicolo o di un servizio', () => {
    const [v] = mascheraDati([{ id: 'v1', display_name: 'Lamborghini Urus', name: 'Lamborghini Urus', plate: 'GA1AB', category: 'supercars' }]) as Riga[]
    expect(v.name).toBe('Lamborghini Urus')
    expect(v.display_name).toBe('Lamborghini Urus')
    const [s2] = mascheraDati([{ nome: 'Lavaggio Completo', price_per_day: 5000, is_active: true }]) as Riga[]
    expect(s2.nome).toBe('Lavaggio Completo')
  })

  // Regressione 01/09/2026: Report Noleggio mostrava tutti i nomi. monthly-report
  // non dichiara `content-type` e la mascheratura si fermava li'.
  it('maschera anche una risposta SENZA content-type (come monthly-report)', async () => {
    const corpo = JSON.stringify([{ customer_name: 'Fabrizio Atzeni', totale: 390 }])
    const res = new Response(corpo, { status: 200 })
    const fuori = await mascheraRisposta(res)
    const [r] = await fuori.json() as Riga[]
    expect(r.customer_name).not.toBe('Fabrizio Atzeni')
    expect(r.totale).toBe(390)
  })

  it('non tocca una risposta binaria (PDF)', async () => {
    const res = new Response('%PDF-1.4 binario', { status: 200, headers: { 'content-type': 'application/pdf' } })
    const fuori = await mascheraRisposta(res)
    expect(await fuori.text()).toBe('%PDF-1.4 binario')
  })
})
