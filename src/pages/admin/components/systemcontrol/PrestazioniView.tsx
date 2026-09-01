// System Control — PERFORMANCE: cosa e' lento e cosa sbaglia piu' spesso.
import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { systemControl } from '../../../../utils/systemControl'
import { Scheda, Vuoto, Bottone } from './ui'

interface Aggregato { tipo: string; nome: string; chiamate: number; errori: number; mediaMs: number; massimoMs: number; tassoErrore: number }

export default function PrestazioniView() {
  const [dati, setDati] = useState<{ piuLente: Aggregato[]; piuErrori: Aggregato[]; piuChiamate: Aggregato[]; andamento: { ora: string; chiamate: number; errori: number; mediaMs: number }[] } | null>(null)
  const [giorni, setGiorni] = useState(7)
  const [caricamento, setCaricamento] = useState(true)

  const carica = useCallback(async () => {
    setCaricamento(true)
    try { setDati(await systemControl.metriche(giorni) as never) }
    catch (e) { toast.error((e as Error).message) }
    finally { setCaricamento(false) }
  }, [giorni])

  useEffect(() => { void carica() }, [carica])

  function Tabella({ righe, colonna }: { righe: Aggregato[]; colonna: 'lento' | 'errori' | 'chiamate' }) {
    if (!righe?.length) return <Vuoto testo="Nessuna misura nel periodo." />
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-theme-text-muted border-b border-theme-border">
              <th className="text-left font-medium px-4 py-2">Nome</th>
              <th className="text-right font-medium px-4 py-2">Chiamate</th>
              <th className="text-right font-medium px-4 py-2">{colonna === 'lento' ? 'Media' : 'Errori'}</th>
              <th className="text-right font-medium px-4 py-2">{colonna === 'lento' ? 'Massimo' : '% errore'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-theme-border">
            {righe.slice(0, 15).map(r => (
              <tr key={`${r.tipo}-${r.nome}`}>
                <td className="px-4 py-2 text-theme-text-primary">
                  {r.nome}
                  <span className="text-theme-text-muted"> · {r.tipo}</span>
                </td>
                <td className="px-4 py-2 text-right text-theme-text-secondary">{r.chiamate}</td>
                <td className="px-4 py-2 text-right text-theme-text-secondary">{colonna === 'lento' ? `${r.mediaMs} ms` : r.errori}</td>
                <td className={`px-4 py-2 text-right ${colonna !== 'lento' && r.tassoErrore > 5 ? 'text-red-600 dark:text-red-400' : 'text-theme-text-secondary'}`}>
                  {colonna === 'lento' ? `${r.massimoMs} ms` : `${r.tassoErrore}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <select value={giorni} onChange={e => setGiorni(Number(e.target.value))}
          className="px-3 py-1.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-xs text-theme-text-primary">
          <option value={1}>Ultime 24 ore</option>
          <option value={7}>Ultimi 7 giorni</option>
          <option value={30}>Ultimi 30 giorni</option>
        </select>
        <Bottone onClick={() => void carica()}>Aggiorna</Bottone>
      </div>

      {caricamento ? <p className="text-sm text-theme-text-muted">Caricamento...</p> : (
        <>
          <Scheda titolo="Le funzioni piu lente"><Tabella righe={dati?.piuLente || []} colonna="lento" /></Scheda>
          <Scheda titolo="Dove si sbaglia di piu"><Tabella righe={dati?.piuErrori || []} colonna="errori" /></Scheda>
          <Scheda titolo="Le piu usate"><Tabella righe={dati?.piuChiamate || []} colonna="chiamate" /></Scheda>
          <p className="text-[11px] text-theme-text-muted">
            Le misure arrivano dalle funzioni del server e dalle schermate del pannello. Una funzione compare qui solo
            dopo essere stata usata almeno una volta nel periodo scelto.
          </p>
        </>
      )}
    </div>
  )
}
