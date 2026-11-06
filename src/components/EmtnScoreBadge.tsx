import { useEffect, useState } from 'react'
import { osservaPunteggioEmtn, type PunteggioEmtn } from '../utils/emtnPunteggiClient'

/**
 * Badge "EMTN 80%" accanto al cliente nella lista prenotazioni (07/11/2026,
 * direzione). Il numero e' l'EMTN Score di EMTN (stesso motore della tab EMTN
 * e della scheda cliente), mai un calcolo locale. Il cliente si riconosce
 * solo per id: account del sito (user_id) o scheda (customer_id).
 * Nessun punteggio (cliente senza codice fiscale, nessun id) = nessun badge.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function idClienteEmtn(booking: any): string | null {
  const bd = booking?.booking_details || {}
  const candidati = [bd.customer_id, bd.customer?.customerId, bd.customer?.id, booking?.user_id]
  return (candidati.find(v => typeof v === 'string' && UUID.test(v)) as string | undefined) || null
}

const COLORE: Record<PunteggioEmtn['band'], string> = {
  green: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300',
  yellow: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300',
  red: 'border-red-300 bg-red-50 text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300',
}

const LIVELLO: Record<string, string> = {
  'Very Low': 'rischio molto basso',
  Low: 'rischio basso',
  Moderate: 'rischio moderato',
  High: 'rischio alto',
  Critical: 'rischio critico',
}

function dataIt(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  return d.toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

export default function EmtnScoreBadge({ clienteId, className = '' }: { clienteId: string | null; className?: string }) {
  const [valore, setValore] = useState<PunteggioEmtn | null | undefined>(undefined)

  useEffect(() => {
    if (!clienteId) { setValore(null); return }
    const { attuale, stop } = osservaPunteggioEmtn(clienteId, setValore)
    setValore(attuale)
    return stop
  }, [clienteId])

  if (!clienteId || valore === null) return null
  const base = 'inline-flex items-center rounded font-bold border whitespace-nowrap px-1.5 py-0.5 text-[10px]'
  if (valore === undefined) {
    return <span className={`${base} border-theme-border text-theme-text-muted opacity-60 ${className}`} title="EMTN Score in caricamento">EMTN</span>
  }
  return (
    <span
      className={`${base} ${COLORE[valore.band] || COLORE.yellow} ${className}`}
      title={`EMTN Score ${valore.score}% · ${LIVELLO[valore.livello] || valore.livello} · aggiornato il ${dataIt(valore.calcolato_il)}`}
    >
      EMTN {valore.score}%
    </span>
  )
}
