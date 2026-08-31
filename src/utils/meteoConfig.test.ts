import { describe, it, expect, vi } from 'vitest'

// Il modulo client importa supabaseClient, che senza VITE_SUPABASE_URL solleva
// all'import. Qui si testano solo le regole: nessuna query.
vi.mock('../supabaseClient', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }) },
}))

import * as client from './meteoConfig'
import * as server from '../../netlify/functions/weather-config'

// L'Allerta Meteo ha DUE copie della stessa regola: una nel bundle dell'app
// (anteprima "con queste impostazioni scatterebbe..."), una nelle Netlify
// Functions (invii veri). Se divergono, la Centralina mostra un livello e il
// cron ne manda un altro. Questi test confrontano le due copie voce per voce.
describe('meteoConfig: app e Netlify Functions dicono la stessa cosa', () => {
  it('stessi business e stesse righe di centralina_pro_config', () => {
    expect(client.METEO_BUSINESSES).toEqual(server.METEO_BUSINESSES)
    expect(client.METEO_BUSINESS_ROW).toEqual(server.METEO_BUSINESS_ROW)
    expect(client.METEO_BUSINESS_LABELS).toEqual(server.METEO_BUSINESS_LABELS)
  })

  it('stessi valori di partenza per ogni business', () => {
    expect(client.METEO_DEFAULTS).toEqual(server.METEO_DEFAULTS)
  })

  it('stessa normalizzazione di una config parziale', () => {
    const raw = { criterio: 'vento', soglie: { media: { vento_kmh: 44 } }, ore_avanti: 99 }
    for (const b of server.METEO_BUSINESSES) {
      expect(client.normalizeMeteoConfig(raw, b)).toEqual(server.normalizeMeteoConfig(raw, b))
    }
  })

  it('stessa valutazione su previsioni diverse', () => {
    const snapshots = [
      { rain: false, windGustKmh: 0, precipitationMm: 0, weatherCode: 0 },
      { rain: true, windGustKmh: 12, precipitationMm: 0, weatherCode: 51 },
      { rain: true, windGustKmh: 35, precipitationMm: 3.1, weatherCode: 63 },
      { rain: true, windGustKmh: 88, precipitationMm: 9, weatherCode: 95 },
      { rain: false, windGustKmh: 52, precipitationMm: 0, weatherCode: 0 },
    ]
    for (const b of server.METEO_BUSINESSES) {
      const cfgS = server.normalizeMeteoConfig(undefined, b)
      const cfgC = client.normalizeMeteoConfig(undefined, b)
      for (const w of snapshots) {
        expect(client.valutaMeteo(cfgC, w)).toEqual(server.valutaMeteo(cfgS, w))
      }
    }
  })
})

describe('valutaMeteo', () => {
  const cfg = server.normalizeMeteoConfig(undefined, 'mare')

  it('sereno non e\' allerta', () => {
    const v = server.valutaMeteo(cfg, { rain: false, windGustKmh: 10, precipitationMm: 0, weatherCode: 0 })
    expect(v.livello).toBe('nessuna')
    expect(v.supera).toBe(false)
  })

  it('il livello e\' il piu\' alto raggiunto, non il primo', () => {
    const v = server.valutaMeteo(cfg, { rain: true, windGustKmh: 5, precipitationMm: 7, weatherCode: 63 })
    expect(v.pioggia).toBe('elevata')
    expect(v.livello).toBe('elevata')
  })

  it('con criterio "solo pioggia" il vento non conta', () => {
    const soloPioggia = { ...cfg, criterio: 'pioggia' as const }
    const v = server.valutaMeteo(soloPioggia, { rain: false, windGustKmh: 120, precipitationMm: 0, weatherCode: 0 })
    expect(v.livello).toBe('nessuna')
    expect(v.motivo).not.toContain('raffiche')
  })

  it('con criterio "solo vento" la pioggia non conta', () => {
    const soloVento = { ...cfg, criterio: 'vento' as const }
    const v = server.valutaMeteo(soloVento, { rain: true, windGustKmh: 3, precipitationMm: 20, weatherCode: 65 })
    expect(v.livello).toBe('nessuna')
  })

  it('con criterio "entrambi" basta UNA delle due condizioni', () => {
    const v = server.valutaMeteo(cfg, { rain: false, windGustKmh: 55, precipitationMm: 0, weatherCode: 0 })
    expect(v.vento).toBe('media')
    expect(v.livello).toBe('media')
    expect(v.supera).toBe(true)
  })

  it('pioviggine senza millimetri vale comunque la soglia bassa', () => {
    // Open-Meteo puo' dare 0 mm e codice 51 (pioviggine): senza questa regola
    // una pioggia leggera prevista non farebbe scattare niente.
    const v = server.valutaMeteo(cfg, { rain: true, windGustKmh: 0, precipitationMm: 0, weatherCode: 51 })
    expect(v.pioggia).toBe('bassa')
  })

  it('il livello minimo filtra gli avvisi troppo blandi', () => {
    const soloForte = { ...cfg, livello_minimo: 'elevata' as const }
    const v = server.valutaMeteo(soloForte, { rain: true, windGustKmh: 35, precipitationMm: 0.5, weatherCode: 61 })
    expect(v.livello).toBe('bassa')
    expect(v.supera).toBe(false)
  })

  it('Terra di fabbrica si comporta come la vecchia regola: qualunque pioggia', () => {
    const terra = server.normalizeMeteoConfig(undefined, 'terra')
    expect(server.valutaMeteo(terra, { rain: true, windGustKmh: 0, precipitationMm: 0.3, weatherCode: 61 }).supera).toBe(true)
    // ...e il vento da solo non basta, come prima.
    expect(server.valutaMeteo(terra, { rain: false, windGustKmh: 90, precipitationMm: 0, weatherCode: 0 }).supera).toBe(false)
  })

  it('Mare di fabbrica si comporta come la vecchia regola: pioggia O raffiche 30+', () => {
    const mare = server.normalizeMeteoConfig(undefined, 'mare')
    expect(server.valutaMeteo(mare, { rain: false, windGustKmh: 30, precipitationMm: 0, weatherCode: 0 }).supera).toBe(true)
    expect(server.valutaMeteo(mare, { rain: false, windGustKmh: 29, precipitationMm: 0, weatherCode: 0 }).supera).toBe(false)
  })
})

describe('normalizeMeteoConfig', () => {
  it('riempie i buchi con i default del business, non con quelli di Terra', () => {
    const mare = server.normalizeMeteoConfig({ ore_avanti: 5 }, 'mare')
    expect(mare.ore_avanti).toBe(5)
    expect(mare.criterio).toBe('entrambi')
    expect(mare.template_key).toBe('pro_allerta_meteo_mare')
  })

  it('valori impossibili vengono riportati nei limiti', () => {
    const c = server.normalizeMeteoConfig({ ore_avanti: 999, ora_inizio: -4, ora_fine: 48 }, 'terra')
    expect(c.ore_avanti).toBe(12)
    expect(c.ora_inizio).toBe(0)
    expect(c.ora_fine).toBe(23)
  })

  it('accetta le virgole decimali digitate nel gestionale', () => {
    const c = server.normalizeMeteoConfig({ soglie: { media: { pioggia_mm: '2,5' } } }, 'terra')
    expect(c.soglie.media.pioggia_mm).toBe(2.5)
  })

  it('un criterio sconosciuto non spegne l\'allerta: resta quello di fabbrica', () => {
    expect(server.normalizeMeteoConfig({ criterio: 'grandine' }, 'terra').criterio).toBe('pioggia')
  })

  it('attiva resta indefinita per Terra e Mare (valgono i vecchi toggle Cron ON)', () => {
    expect(server.normalizeMeteoConfig(undefined, 'terra').attiva).toBeUndefined()
    expect(server.normalizeMeteoConfig(undefined, 'mare').attiva).toBeUndefined()
    // Gli altri tre non inviavano niente prima: nascono spenti.
    expect(server.normalizeMeteoConfig(undefined, 'aria').attiva).toBe(false)
    expect(server.normalizeMeteoConfig(undefined, 'soggiorni').attiva).toBe(false)
    expect(server.normalizeMeteoConfig(undefined, 'lavaggio').attiva).toBe(false)
  })
})

describe('dentroFascia', () => {
  const cfg = server.normalizeMeteoConfig({ ora_inizio: 8, ora_fine: 21 }, 'terra')
  it('estremi inclusi', () => {
    expect(server.dentroFascia(cfg, 8)).toBe(true)
    expect(server.dentroFascia(cfg, 21)).toBe(true)
    expect(server.dentroFascia(cfg, 7)).toBe(false)
    expect(server.dentroFascia(cfg, 22)).toBe(false)
  })
  it('fascia a cavallo della mezzanotte', () => {
    const notte = server.normalizeMeteoConfig({ ora_inizio: 22, ora_fine: 6 }, 'terra')
    expect(server.dentroFascia(notte, 23)).toBe(true)
    expect(server.dentroFascia(notte, 3)).toBe(true)
    expect(server.dentroFascia(notte, 12)).toBe(false)
  })
})

describe('meteoBusinessOfServiceType', () => {
  it('mappa i service_type sui business, con Terra come storico', () => {
    expect(server.meteoBusinessOfServiceType('')).toBe('terra')
    expect(server.meteoBusinessOfServiceType(null)).toBe('terra')
    expect(server.meteoBusinessOfServiceType('car_rental')).toBe('terra')
    expect(server.meteoBusinessOfServiceType('boat_rental')).toBe('mare')
    expect(server.meteoBusinessOfServiceType('heli_rental')).toBe('aria')
    expect(server.meteoBusinessOfServiceType('stay_rental')).toBe('soggiorni')
    expect(server.meteoBusinessOfServiceType('mechanical')).toBe('lavaggio')
  })
  it('toMeteoBusiness accetta sia il business sia il vecchio channel', () => {
    expect(server.toMeteoBusiness('mare')).toBe('mare')
    expect(server.toMeteoBusiness('boat_rental')).toBe('mare')
    expect(server.toMeteoBusiness(undefined)).toBe('terra')
  })
})
