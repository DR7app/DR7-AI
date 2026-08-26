import { describe, it, expect, vi } from 'vitest'

// Il modulo importa supabaseClient, che senza VITE_SUPABASE_URL solleva
// all'import. Qui si testa solo la mappa business -> riga: nessuna query.
vi.mock('../supabaseClient', () => ({
  supabase: { from: () => ({ select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) }) },
}))

import { businessRowForServiceType } from './businessConfigClient'

// La mappa service_type -> riga di centralina_pro_config e' il cardine di
// "ogni business i suoi dati": sbagliarla significa leggere la configurazione
// di un altro business senza nessun errore visibile.
describe('businessRowForServiceType', () => {
  it('Terra e i suoi alias stanno su main', () => {
    expect(businessRowForServiceType('rental')).toBe('main')
    expect(businessRowForServiceType('car_rental')).toBe('main')
    expect(businessRowForServiceType(undefined)).toBe('main')
    expect(businessRowForServiceType(null)).toBe('main')
    expect(businessRowForServiceType('')).toBe('main')
  })
  it('ogni altro business ha la sua riga', () => {
    expect(businessRowForServiceType('boat_rental')).toBe('business_mare')
    expect(businessRowForServiceType('heli_rental')).toBe('business_aria')
    expect(businessRowForServiceType('stay_rental')).toBe('business_soggiorni')
  })
  it('lavaggio e meccanica condividono la stessa riga', () => {
    expect(businessRowForServiceType('car_wash')).toBe('business_lavaggio')
    expect(businessRowForServiceType('mechanical')).toBe('business_lavaggio')
    expect(businessRowForServiceType('mechanical_service')).toBe('business_lavaggio')
  })
  it('maiuscole e spazi non cambiano la riga', () => {
    expect(businessRowForServiceType('BOAT_RENTAL')).toBe('business_mare')
  })
  it('un service_type sconosciuto non inventa una riga: resta main', () => {
    expect(businessRowForServiceType('qualcosa_di_nuovo')).toBe('main')
  })
})
