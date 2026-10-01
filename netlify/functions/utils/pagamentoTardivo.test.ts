import { describe, it, expect } from 'vitest'
import { decidiPagamentoTardivo, giaSaldataPerScopo, type InputPagamentoTardivo } from './pagamentoTardivo'
import { scopoLink } from './linkInAttesa'

const SCADENZA = '2026-08-13T11:43:22.217Z'
const dopo = (min: number) => new Date(new Date(SCADENZA).getTime() + min * 60_000)

function input(over: Partial<InputPagamentoTardivo> = {}): InputPagamentoTardivo {
  return {
    pagatoSuNexi: true,
    scadenzaLink: SCADENZA,
    adesso: dopo(240),
    scopo: 'booking',
    haPrenotazione: true,
    prenotazione: { status: 'pending', payment_status: 'pending', payment_method: 'Nexi - Pay by Link', price_total: 10465, booking_details: {} },
    ...over,
  }
}

describe('decidiPagamentoTardivo — dentro i tempi', () => {
  it('pagamento non confermato da Nexi: nessuna decisione', () => {
    expect(decidiPagamentoTardivo(input({ pagatoSuNexi: false })).tipo).toBe('nei_tempi')
  })
  it('senza scadenza registrata: nei tempi', () => {
    expect(decidiPagamentoTardivo(input({ scadenzaLink: null })).tipo).toBe('nei_tempi')
  })
  it('scadenza illeggibile: nei tempi (non si blocca denaro su un dato rotto)', () => {
    expect(decidiPagamentoTardivo(input({ scadenzaLink: 'boh' })).tipo).toBe('nei_tempi')
  })
  it('entro la tolleranza di 5 minuti: nei tempi', () => {
    expect(decidiPagamentoTardivo(input({ adesso: dopo(4) })).tipo).toBe('nei_tempi')
    expect(decidiPagamentoTardivo(input({ adesso: dopo(5) })).tipo).toBe('nei_tempi')
  })
})

describe('decidiPagamentoTardivo — tardivo accettato', () => {
  it('prenotazione in attesa: il pagamento si registra (caso sestu prima dell\'annullamento)', () => {
    const r = decidiPagamentoTardivo(input())
    expect(r.tipo).toBe('accetta_tardivo')
    if (r.tipo === 'accetta_tardivo') {
      expect(r.secondiRitardo).toBe(240 * 60)
      expect(r.nota).toContain('4h 0min')
    }
  })
  it('prenotazione scaduta (expired): il pagamento vince sulla scadenza', () => {
    expect(decidiPagamentoTardivo(input({ prenotazione: { status: 'expired', payment_status: 'unpaid' } })).tipo).toBe('accetta_tardivo')
  })
  it('link senza prenotazione (tab Clienti): accettato', () => {
    expect(decidiPagamentoTardivo(input({ haPrenotazione: false, prenotazione: null })).tipo).toBe('accetta_tardivo')
  })
  it('link cauzione: accettato', () => {
    expect(decidiPagamentoTardivo(input({ scopo: 'cauzione', haPrenotazione: false, prenotazione: null })).tipo).toBe('accetta_tardivo')
  })
  it('estensione ancora in attesa: accettata', () => {
    const r = decidiPagamentoTardivo(input({
      scopo: 'extension',
      prenotazione: { status: 'confirmed', payment_status: 'paid', booking_details: { extension_history: [{ payment_status: 'paid' }, { payment_status: 'nexi_pay_by_link' }] } },
    }))
    expect(r.tipo).toBe('accetta_tardivo')
  })
  it('saldo (topup) con importo ancora scoperto: accettato', () => {
    const r = decidiPagamentoTardivo(input({
      scopo: 'booking_topup',
      prenotazione: { status: 'confirmed', payment_status: 'partial', price_total: 5000, booking_details: { amountPaid: 2500 } },
    }))
    expect(r.tipo).toBe('accetta_tardivo')
  })
  it('scopo assente = booking', () => {
    expect(decidiPagamentoTardivo(input({ scopo: null })).tipo).toBe('accetta_tardivo')
  })
})

describe('decidiPagamentoTardivo — bloccato con allarme', () => {
  it('prenotazione annullata (cancelled): non si segna pagata', () => {
    const r = decidiPagamentoTardivo(input({ prenotazione: { status: 'cancelled', payment_status: 'unpaid' } }))
    expect(r.tipo).toBe('blocca')
    if (r.tipo === 'blocca') expect(r.motivo).toBe('prenotazione_annullata')
  })
  it('prenotazione annullata (annullata, maiuscole): bloccata', () => {
    const r = decidiPagamentoTardivo(input({ prenotazione: { status: 'Annullata' } }))
    expect(r.tipo === 'blocca' && r.motivo).toBe('prenotazione_annullata')
  })
  it('prenotazione sparita: bloccata', () => {
    const r = decidiPagamentoTardivo(input({ prenotazione: null }))
    expect(r.tipo === 'blocca' && r.motivo).toBe('prenotazione_non_trovata')
  })
  it.each(['paid', 'completed', 'succeeded', 'PAID'])('gia\' pagata (%s) con altro metodo: possibile doppio incasso', (ps) => {
    const r = decidiPagamentoTardivo(input({ prenotazione: { status: 'confirmed', payment_status: ps, payment_method: 'Contanti' } }))
    expect(r.tipo).toBe('blocca')
    if (r.tipo === 'blocca') {
      expect(r.motivo).toBe('gia_pagata_altro_metodo')
      expect(r.nota).toContain('Contanti')
    }
  })
  it('gia\' pagata via Nexi (nexi_paid_at) anche se payment_status non aggiornato', () => {
    const r = decidiPagamentoTardivo(input({ prenotazione: { status: 'confirmed', payment_status: 'pending', booking_details: { nexi_paid_at: '2026-08-13T12:00:00Z' } } }))
    expect(r.tipo === 'blocca' && r.motivo).toBe('gia_pagata_altro_metodo')
  })
  it('estensione gia\' segnata pagata in contanti/bonifico (casi Caredda, Concas)', () => {
    const r = decidiPagamentoTardivo(input({
      scopo: 'extension',
      prenotazione: { status: 'confirmed', payment_status: 'paid', payment_method: 'Contanti', booking_details: { extension_history: [{ payment_status: 'paid', payment_method: 'Bonifico bancario' }] } },
    }))
    expect(r.tipo === 'blocca' && r.motivo).toBe('gia_pagata_altro_metodo')
  })
  it('saldo (topup) gia\' coperto: bloccato', () => {
    const r = decidiPagamentoTardivo(input({
      scopo: 'booking_topup',
      prenotazione: { status: 'confirmed', payment_status: 'paid', price_total: 5000, booking_details: { amountPaid: 5000 } },
    }))
    expect(r.tipo === 'blocca' && r.motivo).toBe('gia_pagata_altro_metodo')
  })
  it('annullata ha la precedenza su gia\' pagata', () => {
    const r = decidiPagamentoTardivo(input({ prenotazione: { status: 'cancelled', payment_status: 'paid' } }))
    expect(r.tipo === 'blocca' && r.motivo).toBe('prenotazione_annullata')
  })
})

describe('decidiPagamentoTardivo — link sostituito (superseded)', () => {
  it('pagato entro l\'ora su un link sostituito, prenotazione gia\' pagata: bloccato', () => {
    const r = decidiPagamentoTardivo(input({ adesso: dopo(-30), linkSostituito: true, prenotazione: { status: 'confirmed', payment_status: 'paid' } }))
    expect(r.tipo).toBe('blocca')
    if (r.tipo === 'blocca') {
      expect(r.secondiRitardo).toBe(0)
      expect(r.nota).toContain('sostituito')
    }
  })
  it('pagato su un link sostituito, prenotazione ancora da pagare: accettato', () => {
    expect(decidiPagamentoTardivo(input({ adesso: dopo(-30), linkSostituito: true })).tipo).toBe('accetta_tardivo')
  })
  it('link sostituito senza scadenza registrata: controllato comunque', () => {
    const r = decidiPagamentoTardivo(input({ scadenzaLink: null, linkSostituito: true, prenotazione: { status: 'cancelled' } }))
    expect(r.tipo).toBe('blocca')
  })
})

describe('giaSaldataPerScopo', () => {
  it('danni: tutte le voci pagate = saldato', () => {
    expect(giaSaldataPerScopo('danni', { booking_details: { danni: [{ paymentStatus: 'paid' }] } })).toBe(true)
    expect(giaSaldataPerScopo('danni', { booking_details: { danni: [{ paymentStatus: 'paid' }, {}] } })).toBe(false)
  })
  it('penali usa la chiave inglese penalties', () => {
    expect(giaSaldataPerScopo('penali', { booking_details: { penalties: [{ paymentStatus: 'nexi_pay_by_link' }] } })).toBe(false)
    expect(giaSaldataPerScopo('penali', { booking_details: { danni: [{ paymentStatus: 'pending' }], penalties: [{ paymentStatus: 'paid' }] } })).toBe(true)
  })
  it('estensione senza storico: non saldata', () => {
    expect(giaSaldataPerScopo('extension', { booking_details: {} })).toBe(false)
  })
  it('estensione su prenotazione figlia (cambio auto): conta il payment_status della figlia', () => {
    expect(giaSaldataPerScopo('extension', { payment_status: 'paid', booking_details: { parent_booking_id: 'x' } })).toBe(true)
    expect(giaSaldataPerScopo('extension', { payment_status: 'pending', booking_details: { parent_booking_id: 'x' } })).toBe(false)
  })
})

describe('scopoLink', () => {
  it('legge metadata.payment_purpose, booking se assente', () => {
    expect(scopoLink({ payment_purpose: 'Extension' })).toBe('extension')
    expect(scopoLink({})).toBe('booking')
    expect(scopoLink(null)).toBe('booking')
  })
})
