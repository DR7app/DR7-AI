// System Control — mattoni comuni delle viste: badge, schede, formattazione
// delle date (sempre 24h e gg/mm/aaaa) e la finestra di conferma.
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Severita, StatoServizio } from '../../../../utils/systemControl'

const COLORI_SEVERITA: Record<Severita, string> = {
  informativo: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30',
  basso:       'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  medio:       'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
  alto:        'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30',
  critico:     'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/40',
}

export function BadgeSeverita({ severita }: { severita: Severita }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-semibold uppercase tracking-wide ${COLORI_SEVERITA[severita] || COLORI_SEVERITA.medio}`}>
      {severita}
    </span>
  )
}

const COLORI_STATO: Record<StatoServizio, string> = {
  operativo: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  degradato: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
  problema:  'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30',
  critico:   'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/40',
}

const ETICHETTE_STATO: Record<StatoServizio, string> = {
  operativo: 'Operativo', degradato: 'Degradato', problema: 'Problema', critico: 'Critico',
}

export function BadgeStato({ stato }: { stato: StatoServizio }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold ${COLORI_STATO[stato] || COLORI_STATO.problema}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${stato === 'operativo' ? 'bg-emerald-500' : stato === 'degradato' ? 'bg-amber-500' : stato === 'problema' ? 'bg-orange-500' : 'bg-red-500'}`} />
      {ETICHETTE_STATO[stato] || stato}
    </span>
  )
}

/** Etichetta della classe di risoluzione: chi risolve questo problema. */
export function BadgeClasse({ classe }: { classe: 1 | 2 | 3 }) {
  const mappa = {
    1: { testo: 'Si risolve da solo', stile: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' },
    2: { testo: 'Puoi risolverlo tu', stile: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30' },
    3: { testo: 'Serve lo sviluppatore', stile: 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30' },
  } as const
  const v = mappa[classe] || mappa[2]
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium ${v.stile}`}>{v.testo}</span>
}

export function Scheda({ titolo, azione, children, className = '' }: { titolo?: string; azione?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`bg-theme-bg-secondary/50 rounded-xl border border-theme-border overflow-hidden ${className}`}>
      {(titolo || azione) && (
        <div className="px-4 py-3 border-b border-theme-border flex items-center justify-between gap-3">
          {titolo && <h3 className="text-sm font-semibold text-theme-text-primary">{titolo}</h3>}
          {azione}
        </div>
      )}
      {children}
    </div>
  )
}

export function Vuoto({ testo }: { testo: string }) {
  return <p className="px-4 py-8 text-sm text-theme-text-muted text-center">{testo}</p>
}

export function Bottone({
  children, onClick, variante = 'normale', disabilitato, titolo,
}: {
  children: ReactNode
  onClick: () => void
  variante?: 'normale' | 'primario' | 'attenzione'
  disabilitato?: boolean
  titolo?: string
}) {
  const stili = {
    normale: 'bg-theme-bg-tertiary text-theme-text-secondary hover:text-theme-text-primary border-theme-border',
    primario: 'bg-[#007aff] text-white border-[#007aff] hover:bg-[#0069d9]',
    attenzione: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/40 hover:bg-red-500/20',
  }
  return (
    <button
      type="button" onClick={onClick} disabled={disabilitato} title={titolo}
      className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${stili[variante]}`}
    >
      {children}
    </button>
  )
}

/** Finestra di conferma per le azioni che lo richiedono. */
export function Conferma({
  titolo, testo, etichettaConferma = 'Conferma', onConferma, onAnnulla, pericolosa,
}: {
  titolo: string
  testo: string
  etichettaConferma?: string
  onConferma: (motivo: string) => void
  onAnnulla: () => void
  pericolosa?: boolean
}) {
  const [motivo, setMotivo] = useState('')
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onAnnulla}>
      <div className="w-full max-w-md bg-theme-bg-primary rounded-2xl border border-theme-border shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-theme-border">
          <h3 className="text-base font-semibold text-theme-text-primary">{titolo}</h3>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-theme-text-secondary leading-relaxed">{testo}</p>
          <div>
            <label className="block text-[11px] font-medium text-theme-text-muted mb-1">Motivo (facoltativo, resta nell audit)</label>
            <input
              value={motivo} onChange={e => setMotivo(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-1 focus:ring-[#007aff]"
              placeholder="Perche stai facendo questa operazione"
            />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-theme-border flex justify-end gap-2">
          <Bottone onClick={onAnnulla}>Annulla</Bottone>
          <Bottone variante={pericolosa ? 'attenzione' : 'primario'} onClick={() => onConferma(motivo)}>{etichettaConferma}</Bottone>
        </div>
      </div>
    </div>
  )
}
