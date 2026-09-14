// Pezzi di interfaccia condivisi dalle viste dei business non-Terra
// (NoleggioServiceTab per Mare/Aria/Soggiorni, PreventiviLavaggioView per
// Lavaggio & Meccanica). Stanno qui e non dentro un tab per evitare import
// circolari fra i due file: erano nati dentro NoleggioServiceTab e la seconda
// vista avrebbe dovuto o importarli da li' (ciclo) o ricopiarli (due badge di
// stato con colori diversi dopo la prima modifica).
import type { ReactNode } from 'react'
import { STATUS_BADGE } from './noleggioFormBits'

export function Header({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <h2 className="text-lg font-semibold text-theme-text-primary">{title}</h2>
      {action}
    </div>
  )
}

export function Badge({ value }: { value: string | null }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${STATUS_BADGE[(value || '').toLowerCase()] || 'bg-theme-bg-tertiary text-theme-text-muted border-theme-border'}`}>{value || '—'}</span>
}

export function ErrorBox({ msg }: { msg: string }) {
  return <div className="bg-red-500/15 border border-red-500/40 text-red-300 px-4 py-3 rounded-lg text-sm">{msg}</div>
}

export function EmptyBox({ msg }: { msg: string }) {
  return <div className="text-theme-text-muted text-sm py-10 text-center border border-theme-border rounded-lg">{msg}</div>
}
