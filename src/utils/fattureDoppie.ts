/**
 * Le fatture in doppio sulla stessa prenotazione.
 *
 * Stessa regola della vista `public.v_fatture_doppie` (migrazione
 * 20260901_fatture_doppie): se cambia qui deve cambiare anche la'.
 *
 * La tabella `fatture` tiene insieme quattro documenti diversi agganciati allo
 * stesso `booking_id` — la fattura principale, le fatture di estensione, le
 * penali/danni e le note di credito — e solo la PRINCIPALE deve essere una
 * sola. Un doppione qui non e' "due righe uguali": e' una seconda fattura
 * principale sulla stessa prenotazione.
 */

const TIPI_NON_PRINCIPALI = [
  'nota_di_credito', 'nota_credito', 'td04',
  'penale', 'danno', 'penali', 'danni',
  'estensione',
]

export interface RigaFattura {
  id: string
  booking_id?: string | null
  extension_index?: number | null
  tipo_fattura?: string | null
  stato?: string | null
  sdi_status?: string | null
  aruba_invoice_id?: string | null
  created_at?: string | null
}

export function isFatturaPrincipale(f: RigaFattura): boolean {
  if (!f.booking_id) return false
  if (f.extension_index !== null && f.extension_index !== undefined) return false
  if (TIPI_NON_PRINCIPALI.includes(String(f.tipo_fattura || '').trim().toLowerCase())) return false
  if (String(f.stato || '').toLowerCase() === 'cancelled') return false
  return true
}

/**
 * Il documento e' gia' uscito verso lo SDI: ha valore fiscale, si annulla con
 * una nota di credito e non si elimina.
 */
export function isUscitaSdi(f: RigaFattura): boolean {
  if (f.aruba_invoice_id) return true
  return ['sending', 'sent', 'delivered', 'accepted'].includes(String(f.sdi_status || ''))
}

export interface Doppioni {
  /** Gli id delle righe in eccesso (la riga da tenere non c'e'). */
  ids: Set<string>
  /** Di quelle, le gia' trasmesse a SDI: serve una nota di credito. */
  idsConValoreFiscale: Set<string>
}

/**
 * Per ogni prenotazione con piu' di una fattura principale, tiene quella gia'
 * uscita verso SDI (ha valore fiscale) e, a parita', la piu' vecchia: le altre
 * sono i doppioni.
 */
export function trovaDoppioni(fatture: RigaFattura[]): Doppioni {
  const perPrenotazione = new Map<string, RigaFattura[]>()
  for (const f of fatture) {
    if (!isFatturaPrincipale(f)) continue
    const chiave = f.booking_id as string
    const gruppo = perPrenotazione.get(chiave)
    if (gruppo) gruppo.push(f)
    else perPrenotazione.set(chiave, [f])
  }

  const ids = new Set<string>()
  const idsConValoreFiscale = new Set<string>()

  for (const gruppo of perPrenotazione.values()) {
    if (gruppo.length < 2) continue
    const ordinate = [...gruppo].sort((a, b) => {
      const ua = isUscitaSdi(a) ? 0 : 1
      const ub = isUscitaSdi(b) ? 0 : 1
      if (ua !== ub) return ua - ub
      const ca = a.created_at || ''
      const cb = b.created_at || ''
      if (ca !== cb) return ca < cb ? -1 : 1
      return a.id < b.id ? -1 : 1
    })
    for (const f of ordinate.slice(1)) {
      ids.add(f.id)
      if (isUscitaSdi(f)) idsConValoreFiscale.add(f.id)
    }
  }

  return { ids, idsConValoreFiscale }
}
