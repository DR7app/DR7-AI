import { describe, it, expect } from 'vitest'
import { motivoScarto, conMotivoScarto, MOTIVO_SCARTO_NON_DISPONIBILE } from './motivoScartoSdi'

// Forma reale della risposta Aruba di DR7-2026-2102 (ridotta).
const scartataVuota = { id: 'x', invoices: [{ number: 'DR7-2026-2102', status: 'Scartata', statusDescription: '' }] }

describe('motivoScarto', () => {
  it('scarto senza descrizione: segnaposto + causa probabile dal CF', () => {
    const m = motivoScarto(scartataVuota, { customer_tax_code: 'LRASFN01E25Z138I', customer_vat: '' })!
    expect(m.startsWith(MOTIVO_SCARTO_NON_DISPONIBILE)).toBe(true)
    expect(m).toContain('Causa probabile')
    expect(m).toContain('sarebbe J')
  })

  it('scarto senza descrizione e CF valido: solo il segnaposto', () => {
    expect(motivoScarto(scartataVuota, { customer_tax_code: 'LRASFN01E25Z138J' })).toBe(MOTIVO_SCARTO_NON_DISPONIBILE)
  })

  it('usa la descrizione Aruba quando c\'e\'', () => {
    const r = { invoices: [{ status: 'Scartata', statusDescription: '00305 IdFiscaleIVA non valido' }] }
    expect(motivoScarto(r)).toBe('00305 IdFiscaleIVA non valido')
  })

  it('non tocca le risposte che non sono scarti', () => {
    const ok = { invoices: [{ status: 'Consegnata', statusDescription: '' }] }
    expect(motivoScarto(ok)).toBeNull()
    expect(conMotivoScarto(ok)).toBe(ok)
    expect(conMotivoScarto(scartataVuota).motivo_scarto).toBe(MOTIVO_SCARTO_NON_DISPONIBILE)
  })
})
