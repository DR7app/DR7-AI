import type { SelezioneMultipla } from '../utils/selezioneMultipla'

export type { SelezioneMultipla }

/**
 * La barra dei pulsanti: accendi/spegni, "Seleziona tutti" e l'azione di
 * massa. `idsPagina` sono le righe a schermo; `azione` e' l'etichetta del
 * pulsante rosso (di solito "Elimina").
 */
export function BarraSelezioneMultipla({
  selezione,
  idsPagina,
  onAzione,
  inCorso = false,
  azione = 'Elimina',
  nomeElemento = 'elementi',
}: {
  selezione: SelezioneMultipla
  idsPagina: string[]
  onAzione: () => void
  inCorso?: boolean
  azione?: string
  nomeElemento?: string
}) {
  const { attiva, selezionati, accendiSpegni, tutte } = selezione
  const tutteScelte = idsPagina.length > 0 && idsPagina.every(id => selezionati.includes(id))
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={accendiSpegni}
        className={`px-4 py-2 rounded-full font-medium transition-colors ${attiva
          ? 'bg-blue-600 text-white'
          : 'bg-theme-bg-tertiary text-theme-text-primary border border-theme-border hover:bg-theme-bg-hover'}`}
      >
        {attiva ? 'Annulla selezione' : 'Selezione multipla'}
      </button>

      {attiva && (
        <>
          <button
            type="button"
            onClick={() => tutte(idsPagina)}
            disabled={idsPagina.length === 0}
            className="px-4 py-2 rounded-full font-medium transition-colors bg-theme-bg-tertiary text-theme-text-primary border border-theme-border hover:bg-theme-bg-hover disabled:opacity-50"
          >
            {tutteScelte ? 'Deseleziona tutti' : `Seleziona tutti (${idsPagina.length})`}
          </button>
          <button
            type="button"
            onClick={onAzione}
            disabled={selezionati.length === 0 || inCorso}
            className="px-4 py-2 rounded-full font-medium transition-colors bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
          >
            {inCorso ? 'Eliminazione…' : `${azione} selezionati (${selezionati.length})`}
          </button>
          <span className="text-sm text-theme-text-muted">
            {selezionati.length}/{idsPagina.length} {nomeElemento} selezionati
          </span>
        </>
      )}
    </div>
  )
}

/** La casella su una riga. */
export function CasellaSelezione({
  scelto,
  onChange,
  etichetta,
}: {
  scelto: boolean
  onChange: () => void
  etichetta: string
}) {
  return (
    <input
      type="checkbox"
      checked={scelto}
      onChange={onChange}
      aria-label={etichetta}
      onClick={(e) => e.stopPropagation()}
      className="mt-1 mr-3 h-5 w-5 shrink-0 cursor-pointer accent-dr7-gold"
    />
  )
}
