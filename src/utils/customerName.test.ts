import { describe, it, expect } from 'vitest'
import { customerDisplayName } from './customerName'

describe('customerDisplayName', () => {
  it('persona fisica: nome + cognome', () => {
    expect(customerDisplayName({ tipo_cliente: 'persona_fisica', nome: 'Mario', cognome: 'Rossi' })).toBe('Mario Rossi')
  })
  it('azienda: denominazione', () => {
    expect(customerDisplayName({ tipo_cliente: 'azienda', denominazione: 'DR7 SRL', nome: 'Mario' })).toBe('DR7 SRL')
  })
  it('PA: ente', () => {
    expect(customerDisplayName({ tipo_cliente: 'pubblica_amministrazione', ente_ufficio: 'Comune di Cagliari' })).toBe('Comune di Cagliari')
  })
  it('tipo_cliente nullo: usa comunque nome e cognome (prima era N/A)', () => {
    expect(customerDisplayName({ tipo_cliente: null, nome: 'Luca', cognome: 'Piras' })).toBe('Luca Piras')
  })
  it('azienda senza denominazione: ripiega su ragione sociale, poi sul referente', () => {
    expect(customerDisplayName({ tipo_cliente: 'azienda', ragione_sociale: 'Alfa SNC' })).toBe('Alfa SNC')
    expect(customerDisplayName({ tipo_cliente: 'azienda', nome: 'Anna', cognome: 'Bianchi' })).toBe('Anna Bianchi')
  })
  it('riga legacy con solo full_name', () => {
    expect(customerDisplayName({ full_name: 'Giuseppe Sanna' })).toBe('Giuseppe Sanna')
  })
  it('senza nessun nome: email, poi telefono, mai N/A', () => {
    expect(customerDisplayName({ email: 'a@b.it' })).toBe('a@b.it')
    expect(customerDisplayName({ telefono: '393401234567' })).toBe('393401234567')
    expect(customerDisplayName({})).toBe('Cliente senza nome')
  })
})
