import { describe, it, expect } from 'vitest'
import { mascheraDati, mascheraRisposta, elencoDaSfocare, daSfocare } from './oscura'

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

describe('Oscurare — una lista di clienti veri, non i primi quattrocento', () => {
  it('sfoca ANCHE il cliente numero 5000 (prima il dizionario era pieno a 2000 voci)', () => {
    const lista = []
    for (let i = 0; i < 5000; i++) {
      lista.push({
        customer_name: `Cliente Cognomesuo${i}`,
        customer_email: `cliente${i}@tiscali.it`,
        customer_phone: `+39 340 ${1000000 + i}`,
        customer_address: `Via delle Rimembranze ${i}`,
        customer_tax_code: `CLNCGN${i}A01B354K`,
      })
    }
    mascheraDati(lista)
    // Il primo e' sempre stato coperto. Il guasto era su quelli dopo.
    expect(daSfocare('Cliente Cognomesuo0')).toBe(true)
    expect(daSfocare('Cliente Cognomesuo2500')).toBe(true)
    expect(daSfocare('Cliente Cognomesuo4999')).toBe(true)
    expect(daSfocare('cliente4999@tiscali.it')).toBe(true)
    expect(daSfocare('Via delle Rimembranze 4999')).toBe(true)
  })

  it('sfoca il nome anche quando la tabella lo spezza su due colonne', () => {
    mascheraDati([{ nome: 'Fedrico', cognome: 'Frongiargiu', email: 'ff@x.it' }])
    // A schermo sono due celle distinte: due nodi di testo separati.
    expect(daSfocare('Fedrico')).toBe(true)
    expect(daSfocare('Frongiargiu')).toBe(true)
  })

  it('sfoca il nome dentro una frase', () => {
    mascheraDati([{ customer_name: 'Ivan Muschitiello' }])
    expect(daSfocare('Prenotazione di Ivan Muschitiello confermata')).toBe(true)
  })

  it('sfoca il telefono comunque sia scritto a schermo', () => {
    mascheraDati([{ customer_name: 'Tizio Caio', telefono: '+393401112233' }])
    expect(daSfocare('340 111 2233')).toBe(true)
    expect(daSfocare('+39 340 111 22 33')).toBe(true)
  })

  it('riconosce il nome anche scritto con gli accenti', () => {
    mascheraDati([{ customer_name: 'Ophelie Giraud' }])
    expect(daSfocare('Ophélie Giraud')).toBe(true)
  })

  // 01/09/2026 — segnalato dal campo: con Oscurare acceso sparivano anche le
  // auto. Oscurare nasconde i CLIENTI, i mezzi restano leggibili.
  it('NON sfoca la flotta quando un cliente si chiama come un marchio', () => {
    mascheraDati([{ customer_name: 'Luca Ferrari', email: 'luca.ferrari@libero.it' }])
    expect(daSfocare('Luca Ferrari')).toBe(true)
    expect(daSfocare('Ferrari 296 gtb')).toBe(false)
    expect(daSfocare('Mercedes Classe A45S AMG')).toBe(false)
  })

  it('impara i nomi della flotta e li lascia leggibili', () => {
    mascheraDati([{ id: 'v9', display_name: 'YARIS HYBRID PREMIUM', plate: 'HD694XW', category: 'scooter' }])
    expect(daSfocare('YARIS HYBRID PREMIUM')).toBe(false)
  })

  it('NON sfoca il mezzo nella riga di una prenotazione', () => {
    mascheraDati([{ customer_name: 'Ivan Saba', vehicle_name: 'Lamborghini Huracan Tecnica', vehicle_plate: 'GA111AA' }])
    expect(daSfocare('Ivan Saba')).toBe(true)
    expect(daSfocare('Lamborghini Huracan Tecnica')).toBe(false)
  })

  it('NON sfoca le etichette del gestionale ne i nomi dei mezzi', () => {
    mascheraDati([{ id: 'v1', name: 'Lamborghini Urus', plate: 'GA1AB', category: 'supercars' }])
    expect(daSfocare('Lamborghini Urus')).toBe(false)
    expect(daSfocare('Prenotazioni del mese')).toBe(false)
    expect(daSfocare('Totale incassato')).toBe(false)
    expect(daSfocare('Noleggio Auto')).toBe(false)
  })
})
