import { describe, it, expect } from 'vitest'
import { sanifica, mascheraTesto, normalizzaMessaggio, impronta, prossimoTentativo } from './systemControl'
import { traduciErrore } from './systemControlCatalog'

describe('sanifica', () => {
  it('nasconde i campi che contengono credenziali', () => {
    const out = sanifica({
      api_key: 'abc123456789',
      password: 'segretissima',
      NEXI_TOKEN: 'xyz',
      cliente: 'Mario Rossi',
    }) as Record<string, unknown>
    expect(out.api_key).toBe('[nascosto]')
    expect(out.password).toBe('[nascosto]')
    expect(out.NEXI_TOKEN).toBe('[nascosto]')
    expect(out.cliente).toBe('Mario Rossi')
  })

  it('nasconde un JWT anche se il campo ha un nome innocuo', () => {
    const out = sanifica({ nota: 'eyJhbGciOiJIUzI1NiJ9abcdefghij' }) as Record<string, unknown>
    expect(out.nota).toBe('[nascosto]')
  })

  it('non esplode su oggetti annidati e cicli di profondita', () => {
    const out = sanifica({ a: { b: { c: { d: { e: { f: { g: 'fondo' } } } } } } })
    expect(out).toBeTruthy()
  })
})

describe('mascheraTesto', () => {
  it('toglie il bearer dai messaggi di errore', () => {
    expect(mascheraTesto('richiesta con Authorization: Bearer abcdef123456 fallita'))
      .toContain('Bearer [nascosto]')
  })

  it('toglie le chiavi scritte inline', () => {
    expect(mascheraTesto('{"api_key":"sk_live_9876543210"}')).not.toContain('9876543210')
  })
})

describe('raggruppamento', () => {
  it('due errori uguali con id e numeri diversi hanno la stessa impronta', () => {
    const a = normalizzaMessaggio('Booking 3f2b1c4d-1111-2222-3333-444455556666 non trovato dopo 12 tentativi')
    const b = normalizzaMessaggio('Booking 9a8b7c6d-9999-8888-7777-666655554444 non trovato dopo 3 tentativi')
    expect(a).toBe(b)
    expect(impronta(['api', 'x', '', a])).toBe(impronta(['api', 'x', '', b]))
  })

  it('errori diversi hanno impronte diverse', () => {
    expect(impronta(['api', 'x', '', 'timeout'])).not.toBe(impronta(['api', 'x', '', 'credenziali']))
  })
})

describe('prossimoTentativo', () => {
  it('aumenta il ritardo a ogni tentativo e non supera le tre ore', () => {
    const t = (n: number) => new Date(prossimoTentativo(n)).getTime() - Date.now()
    expect(t(0)).toBeLessThan(t(1))
    expect(t(1)).toBeLessThan(t(2))
    expect(t(4)).toBeLessThanOrEqual(180 * 60_000 + 1000)
    expect(t(9)).toBeLessThanOrEqual(180 * 60_000 + 1000)
  })
})

describe('traduciErrore', () => {
  it('riconosce le credenziali non valide', () => {
    const t = traduciErrore('401 Unauthorized', 401)
    expect(t.titolo).toBe('Credenziali non valide')
    expect(t.classe).toBe(2)
  })

  it('classifica come temporaneo un servizio non disponibile', () => {
    const t = traduciErrore('fetch failed: ECONNREFUSED')
    expect(t.classe).toBe(1)
  })

  it('manda allo sviluppatore una colonna mancante', () => {
    const t = traduciErrore('column bookings.pippo does not exist')
    expect(t.classe).toBe(3)
    expect(t.severita).toBe('critico')
  })

  it('non inventa una causa quando non riconosce l errore', () => {
    const t = traduciErrore('qualcosa di completamente nuovo')
    expect(t.titolo).toBe('Errore non riconosciuto')
    expect(t.azioni).toContain('apri_incidente')
  })
})
