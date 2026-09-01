// System Control — FAILED OPERATIONS: cosa non e' andato a buon fine e ripresa
// protetta dai doppioni.
import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { systemControl } from '../../../../utils/systemControl'
import type { Operazione } from '../../../../utils/systemControl'
import { Scheda, Vuoto, Bottone, Conferma } from './ui'
import { dataOra, quandoRelativo } from './formato'

const COLORE_STATO: Record<string, string> = {
  in_coda:     'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30',
  in_corso:    'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
  riuscita:    'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  fallita:     'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30',
  abbandonata: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/40',
  annullata:   'bg-theme-bg-tertiary text-theme-text-muted border-theme-border',
}

const TESTO_STATO: Record<string, string> = {
  in_coda: 'In coda', in_corso: 'In corso', riuscita: 'Riuscita',
  fallita: 'Non riuscita', abbandonata: 'Aspetta te', annullata: 'Annullata',
}

export default function OperazioniView() {
  const [righe, setRighe] = useState<Operazione[]>([])
  const [caricamento, setCaricamento] = useState(true)
  const [filtro, setFiltro] = useState('aperte')
  const [inCorso, setInCorso] = useState<string | null>(null)
  const [confermaTutte, setConfermaTutte] = useState(false)
  const [daAnnullare, setDaAnnullare] = useState<Operazione | null>(null)

  const carica = useCallback(async () => {
    setCaricamento(true)
    try { setRighe((await systemControl.operazioni({ stato: filtro })).operazioni || []) }
    catch (e) { toast.error((e as Error).message) }
    finally { setCaricamento(false) }
  }, [filtro])

  useEffect(() => { void carica() }, [carica])

  async function riprova(o: Operazione) {
    setInCorso(o.id)
    try {
      const r = await systemControl.azioneOperazione('riprova', { id: o.id })
      if (r.ok && r.saltata) toast(r.messaggio, { duration: 8000 })
      else if (r.ok) toast.success(r.messaggio, { duration: 8000 })
      else toast.error(r.messaggio, { duration: 10000 })
      await carica()
    } catch (e) { toast.error((e as Error).message) }
    finally { setInCorso(null) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={filtro} onChange={e => setFiltro(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-xs text-theme-text-primary">
          <option value="aperte">Da recuperare</option>
          <option value="abbandonata">Aspettano te</option>
          <option value="riuscita">Recuperate</option>
          <option value="annullata">Annullate</option>
          <option value="tutte">Tutte</option>
        </select>
        <Bottone onClick={() => void carica()}>Aggiorna</Bottone>
        <Bottone variante="primario" onClick={() => setConfermaTutte(true)}>Rimetti tutte in coda</Bottone>
        <p className="text-[11px] text-theme-text-muted w-full">
          Ogni ripresa usa la stessa chiave anti-doppione dell operazione originale: non puo creare una seconda fattura,
          un secondo pagamento o una seconda prenotazione.
        </p>
      </div>

      <Scheda>
        {caricamento ? <Vuoto testo="Caricamento..." />
          : righe.length === 0 ? <Vuoto testo="Nessuna operazione in sospeso." />
          : (
            <div className="divide-y divide-theme-border">
              {righe.map(o => (
                <div key={o.id} className="px-4 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-theme-text-primary">{o.descrizione}</p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${COLORE_STATO[o.stato]}`}>{TESTO_STATO[o.stato] || o.stato}</span>
                    </div>
                    <p className="text-[11px] text-theme-text-muted mt-0.5">
                      {o.tipo}{o.integrazione ? ` · ${o.integrazione}` : ''}{o.entita_tipo ? ` · ${o.entita_tipo}` : ''}
                      {' · '}creata {quandoRelativo(o.created_at)} · {o.tentativi}/{o.max_tentativi} tentativi
                      {o.stato === 'in_coda' ? ` · prossimo tentativo ${dataOra(o.prossimo_tentativo_at)}` : ''}
                    </p>
                    {o.ultimo_errore && <p className="text-[11px] text-red-600 dark:text-red-400 mt-1 break-words">{o.ultimo_errore}</p>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {o.stato !== 'riuscita' && o.stato !== 'annullata' && (
                      <>
                        <Bottone variante="primario" disabilitato={inCorso === o.id} onClick={() => void riprova(o)}>
                          {inCorso === o.id ? 'Attendere...' : 'Riprova'}
                        </Bottone>
                        <Bottone onClick={() => setDaAnnullare(o)}>Annulla</Bottone>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
      </Scheda>

      {confermaTutte && (
        <Conferma
          titolo="Rimetti tutte in coda"
          testo="Tutte le operazioni non riuscite tornano in coda e verranno riprese dal ciclo automatico, una alla volta e con i ritardi previsti. Le operazioni gia completate non vengono toccate."
          etichettaConferma="Rimetti in coda"
          onAnnulla={() => setConfermaTutte(false)}
          onConferma={async () => {
            try {
              const r = await systemControl.azioneOperazione('riprova_tutte')
              toast.success(r.messaggio)
              await carica()
            } catch (e) { toast.error((e as Error).message) }
            finally { setConfermaTutte(false) }
          }}
        />
      )}

      {daAnnullare && (
        <Conferma
          titolo="Annulla operazione"
          testo={`«${daAnnullare.descrizione}» non verra piu ritentata. Resta nello storico e nessun dato viene cancellato.`}
          etichettaConferma="Annulla operazione"
          pericolosa
          onAnnulla={() => setDaAnnullare(null)}
          onConferma={async () => {
            try {
              const r = await systemControl.azioneOperazione('annulla_operazione', { id: daAnnullare.id })
              if (r.ok) toast.success(r.messaggio); else toast.error(r.messaggio)
              await carica()
            } catch (e) { toast.error((e as Error).message) }
            finally { setDaAnnullare(null) }
          }}
        />
      )}
    </div>
  )
}
