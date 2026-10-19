import { describe, it, expect } from 'vitest'
import { stessaPersona, rigaGiaRecensita } from './giaRecensito'

describe('stessaPersona', () => {
  it('stesso telefono con e senza prefisso', () => {
    expect(stessaPersona({ customer_phone: '+39 333 123 4567' }, { customer_phone: '3331234567' })).toBe(true)
    expect(stessaPersona({ customer_phone: '0039 3331234567' }, { customer_phone: '‭+393331234567' })).toBe(true)
  })
  it('stessa email con maiuscole diverse', () => {
    expect(stessaPersona({ customer_email: 'Mario@Gmail.com ' }, { customer_email: 'mario@gmail.com' })).toBe(true)
  })
  it('campi vuoti non fanno mai coincidere due persone', () => {
    expect(stessaPersona({ customer_phone: '', customer_email: '' }, { customer_phone: '', customer_email: '' })).toBe(false)
    expect(stessaPersona({ customer_phone: null, customer_email: null }, { customer_phone: null, customer_email: null })).toBe(false)
    expect(stessaPersona({ customer_phone: '123' }, { customer_phone: '123' })).toBe(false)
  })
  it('persone diverse', () => {
    expect(stessaPersona({ customer_phone: '3331234567', customer_email: 'a@x.it' }, { customer_phone: '3339999999', customer_email: 'b@x.it' })).toBe(false)
  })
})

describe('rigaGiaRecensita', () => {
  it('BLOCKED o SENT storico con ALREADY_REVIEWED', () => {
    expect(rigaGiaRecensita({ exclusion_reason_code: 'ALREADY_REVIEWED', send_status: 'BLOCKED' })).toBe(true)
    expect(rigaGiaRecensita({ exclusion_reason_code: 'ALREADY_REVIEWED', send_status: 'SENT' })).toBe(true)
    expect(rigaGiaRecensita({ exclusion_reason_code: null, send_status: 'SENT' })).toBe(false)
  })
})
