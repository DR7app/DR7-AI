// System Control — CATEGORIA 3: i rapporti tecnici da consegnare allo
// sviluppatore, con tutto dentro e nessuna credenziale.
import { useCallback, useEffect, useState } from 'react'
import { ScheletroTabella } from '../../../../components/Scheletro'
import toast from 'react-hot-toast'
import { systemControl } from '../../../../utils/systemControl'
import { Scheda, Vuoto, Bottone } from './ui'
import { dataOra } from './formato'

interface Incidente {
  id: string; numero: string; titolo: string; gravita: string; stato: string
  modulo: string | null; integrazione: string | null; ambiente: string | null; versione: string | null
  frequenza: number; utenti_interessati: number; creato_da: string | null
  corpo_markdown: string | null; created_at: string; chiuso_at: string | null
}

export default function IncidentiView() {
  const [righe, setRighe] = useState<Incidente[]>([])
  const [caricamento, setCaricamento] = useState(true)
  const [aperto, setAperto] = useState<Incidente | null>(null)

  const carica = useCallback(async () => {
    setCaricamento(true)
    try { setRighe(((await systemControl.incidenti()).incidenti || []) as unknown as Incidente[]) }
    catch (e) { toast.error((e as Error).message) }
    finally { setCaricamento(false) }
  }, [])

  useEffect(() => { void carica() }, [carica])

  async function copia(testo: string) {
    try {
      await navigator.clipboard.writeText(testo)
      toast.success('Rapporto copiato: puoi incollarlo direttamente allo sviluppatore.')
    } catch {
      toast.error('Copia non riuscita: seleziona il testo e copialo a mano.')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-theme-text-muted">
          Quando un problema richiede una modifica al software, il rapporto contiene gia tutto: cosa succede, quando,
          quante volte, su quale modulo e con quale errore tecnico. Nessuna credenziale e inclusa.
        </p>
        <Bottone onClick={() => void carica()}>Aggiorna</Bottone>
      </div>

      <Scheda>
        {caricamento ? <ScheletroTabella righe={5} colonne={4} />
          : righe.length === 0 ? <Vuoto testo="Nessun rapporto tecnico creato. Si crea dalla scheda di un problema." />
          : (
            <div className="divide-y divide-theme-border">
              {righe.map(i => (
                <button key={i.id} onClick={() => setAperto(i)} className="w-full text-left px-4 py-3 hover:bg-theme-bg-hover transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-theme-text-primary">
                        <span className="text-theme-text-muted">{i.numero}</span> · {i.titolo}
                      </p>
                      <p className="text-[11px] text-theme-text-muted mt-0.5">
                        {dataOra(i.created_at)} · {i.frequenza} occorrenze · {i.utenti_interessati} utenti
                        {i.modulo ? ` · ${i.modulo}` : ''}{i.creato_da ? ` · creato da ${i.creato_da}` : ''}
                      </p>
                    </div>
                    <span className={`text-[11px] font-semibold shrink-0 ${i.stato === 'chiuso' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                      {i.stato}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
      </Scheda>

      {aperto && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={() => setAperto(null)}>
          <div className="w-full max-w-3xl h-full overflow-y-auto bg-theme-bg-primary border-l border-theme-border" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 z-10 bg-theme-bg-primary px-5 py-4 border-b border-theme-border flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-theme-text-primary">{aperto.numero}</h2>
                <p className="text-xs text-theme-text-muted mt-0.5">{aperto.titolo}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Bottone variante="primario" onClick={() => void copia(aperto.corpo_markdown || '')}>Copia rapporto</Bottone>
                {aperto.stato !== 'chiuso' && (
                  <Bottone onClick={async () => {
                    try {
                      const r = await systemControl.chiudiIncidente(aperto.id)
                      toast.success(r.messaggio)
                      setAperto(null)
                      await carica()
                    } catch (e) { toast.error((e as Error).message) }
                  }}>Chiudi</Bottone>
                )}
                <Bottone onClick={() => setAperto(null)}>Esci</Bottone>
              </div>
            </div>
            <pre className="p-5 text-xs text-theme-text-secondary whitespace-pre-wrap break-words font-mono leading-relaxed">
              {aperto.corpo_markdown || 'Rapporto vuoto.'}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
