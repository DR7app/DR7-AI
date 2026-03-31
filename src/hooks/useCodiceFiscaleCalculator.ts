import { useCallback, useMemo } from 'react'
import toast from 'react-hot-toast'
import {
  calcolaCodiceFiscale,
  decodificaCodiceFiscale,
  validateCheckDigit,
  verificaConsistenza,
} from '../utils/codiceFiscale'

export interface CFFieldConfig {
  getCognome: () => string
  getNome: () => string
  getDataNascita: () => string        // YYYY-MM-DD
  getSesso: () => string              // 'M' | 'F' | ''
  getLuogoNascita: () => string
  getCodiceFiscale: () => string
  setCodiceFiscale: (v: string) => void
  setSesso: (v: string) => void
  setDataNascita: (v: string) => void
  setLuogoNascita: (v: string) => void
  setProvinciaNascita?: (v: string) => void
}

type CalcolaMode = 'forward' | 'reverse' | 'verify' | 'insufficient'

function detectMode(config: CFFieldConfig): CalcolaMode {
  const cf = config.getCodiceFiscale().trim()
  const cognome = config.getCognome().trim()
  const nome = config.getNome().trim()
  const dataNascita = config.getDataNascita().trim()
  const sesso = config.getSesso().trim()
  const luogo = config.getLuogoNascita().trim()

  const hasCF = cf.length === 16
  const hasAllData = !!(cognome && nome && dataNascita && sesso && luogo)
  const hasPartialData = !!(cognome || nome || dataNascita || sesso || luogo)

  if (hasCF && hasAllData) return 'verify'
  if (hasCF && !hasAllData) return 'reverse'
  if (!hasCF && hasAllData) return 'forward'
  if (hasCF && hasPartialData) return 'verify'
  return 'insufficient'
}

export function useCodiceFiscaleCalculator(config: CFFieldConfig) {
  const calcola = useCallback(() => {
    const mode = detectMode(config)

    switch (mode) {
      case 'insufficient': {
        const cf = config.getCodiceFiscale().trim()
        if (cf && cf.length !== 16) {
          toast.error('Il Codice Fiscale inserito non è valido (deve essere di 16 caratteri)')
          return
        }
        toast.error('Compila cognome, nome, data di nascita, sesso e luogo di nascita per calcolare il CF')
        return
      }

      case 'forward': {
        const sesso = config.getSesso().trim()
        if (sesso !== 'M' && sesso !== 'F') {
          toast.error('Seleziona il sesso (M o F) per calcolare il CF')
          return
        }
        const result = calcolaCodiceFiscale({
          cognome: config.getCognome().trim(),
          nome: config.getNome().trim(),
          data_nascita: config.getDataNascita().trim(),
          sesso: sesso as 'M' | 'F',
          luogo_nascita: config.getLuogoNascita().trim(),
        })
        if (result.codice_fiscale) {
          config.setCodiceFiscale(result.codice_fiscale)
          toast.success('Codice Fiscale calcolato')
        } else {
          toast.error(result.error || 'Errore nel calcolo del Codice Fiscale')
        }
        return
      }

      case 'reverse': {
        const cf = config.getCodiceFiscale().trim()
        if (!validateCheckDigit(cf)) {
          toast.error('Il Codice Fiscale inserito non è valido o il carattere di controllo è errato')
          return
        }
        const decoded = decodificaCodiceFiscale(cf)
        if (!decoded) {
          toast.error('Impossibile ricavare dati da questo Codice Fiscale')
          return
        }
        // Fill only empty fields
        if (!config.getSesso().trim()) {
          config.setSesso(decoded.sesso)
        }
        if (!config.getDataNascita().trim()) {
          config.setDataNascita(decoded.data_nascita)
        }
        if (!config.getLuogoNascita().trim() && decoded.luogo_nascita.length > 4) {
          config.setLuogoNascita(decoded.luogo_nascita)
        }
        if (config.setProvinciaNascita && decoded.provincia_nascita) {
          config.setProvinciaNascita(decoded.provincia_nascita)
        }
        toast.success('Dati estratti dal Codice Fiscale')
        return
      }

      case 'verify': {
        const cf = config.getCodiceFiscale().trim()
        if (!validateCheckDigit(cf)) {
          toast.error('Il Codice Fiscale inserito non è valido o il carattere di controllo è errato')
          return
        }

        const sesso = config.getSesso().trim()
        const input: any = {}
        if (config.getCognome().trim()) input.cognome = config.getCognome().trim()
        if (config.getNome().trim()) input.nome = config.getNome().trim()
        if (config.getDataNascita().trim()) input.data_nascita = config.getDataNascita().trim()
        if (sesso === 'M' || sesso === 'F') input.sesso = sesso
        if (config.getLuogoNascita().trim()) input.luogo_nascita = config.getLuogoNascita().trim()

        const result = verificaConsistenza(cf, input)

        if (result.isConsistent) {
          // Fill any still-empty fields from decoded data
          if (result.decoded) {
            if (!config.getSesso().trim()) {
              config.setSesso(result.decoded.sesso)
            }
            if (!config.getDataNascita().trim()) {
              config.setDataNascita(result.decoded.data_nascita)
            }
            if (!config.getLuogoNascita().trim() && result.decoded.luogo_nascita.length > 4) {
              config.setLuogoNascita(result.decoded.luogo_nascita)
            }
            if (config.setProvinciaNascita && result.decoded.provincia_nascita) {
              config.setProvinciaNascita(result.decoded.provincia_nascita)
            }
          }
          toast.success('Codice Fiscale verificato correttamente')
        } else {
          toast.error(`I dati non coincidono con il CF: ${result.mismatches.join('; ')}`, { duration: 5000 })
        }
        return
      }
    }
  }, [config])

  const mode = useMemo(() => detectMode(config), [
    config.getCodiceFiscale(),
    config.getCognome(),
    config.getNome(),
    config.getDataNascita(),
    config.getSesso(),
    config.getLuogoNascita(),
  ])

  return { calcola, mode }
}
