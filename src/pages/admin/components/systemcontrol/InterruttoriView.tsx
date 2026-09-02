// System Control — FEATURE KILL SWITCH e MAINTENANCE MODE.
// Spegnere una funzione per una sola azienda, per tutte, oppure metterla in
// manutenzione con un messaggio per gli utenti. Sempre reversibile.
import { useCallback, useEffect, useState } from 'react'
import { ScheletroLista } from '../../../../components/Scheletro'
import toast from 'react-hot-toast'
import { systemControl } from '../../../../utils/systemControl'
import { BUSINESSES } from '../CentralinaProTab'
import { Scheda, Bottone, Conferma } from './ui'
import { dataOra } from './formato'

interface Funzione { chiave: string; etichetta: string; descrizione: string; critica: boolean }
interface Flag { id: string; chiave: string; business: string; attiva: boolean; manutenzione: boolean; messaggio: string | null; motivo: string | null; aggiornato_da: string | null; updated_at: string }

const AMBITI = [{ id: '*', label: 'Tutte le aziende' }, ...BUSINESSES.map(b => ({ id: b.id, label: b.label }))]

export default function InterruttoriView() {
  const [funzioni, setFunzioni] = useState<Funzione[]>([])
  const [flags, setFlags] = useState<Flag[]>([])
  const [ambito, setAmbito] = useState('*')
  const [caricamento, setCaricamento] = useState(true)
  const [inCorso, setInCorso] = useState<string | null>(null)
  const [conferma, setConferma] = useState<{ funzione: Funzione; azione: 'spegni' | 'manutenzione' } | null>(null)

  const carica = useCallback(async () => {
    setCaricamento(true)
    try {
      const r = await systemControl.interruttori()
      setFunzioni(r.funzioni || [])
      setFlags((r.flags || []) as unknown as Flag[])
    } catch (e) { toast.error((e as Error).message) }
    finally { setCaricamento(false) }
  }, [])

  useEffect(() => { void carica() }, [carica])

  function flagDi(chiave: string): Flag | undefined {
    return flags.find(f => f.chiave === chiave && f.business === ambito)
  }

  async function imposta(chiave: string, patch: Record<string, unknown>, motivo?: string) {
    setInCorso(chiave)
    try {
      const r = await systemControl.impostaInterruttore({ chiave, business: ambito, motivo, conferma: true, ...patch })
      if (r.ok) toast.success(r.messaggio, { duration: 8000 }); else toast.error(r.messaggio)
      await carica()
    } catch (e) { toast.error((e as Error).message) }
    finally { setInCorso(null); setConferma(null) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-theme-text-muted">Applica a</label>
        <select value={ambito} onChange={e => setAmbito(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-xs text-theme-text-primary">
          {AMBITI.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
        <Bottone onClick={() => void carica()}>Aggiorna</Bottone>
      </div>

      <p className="text-xs text-theme-text-muted leading-relaxed">
        Spegnere una funzione non cancella niente: il gestionale smette solo di eseguirla, e le operazioni gia in coda
        restano dove sono. La manutenzione mostra un messaggio agli utenti interessati invece di far fallire l operazione.
      </p>

      <Scheda titolo="Funzioni">
        {caricamento ? <ScheletroLista righe={5} className="px-4 py-4" /> : (
          <div className="divide-y divide-theme-border">
            {funzioni.map(f => {
              const flag = flagDi(f.chiave)
              const spenta = flag?.attiva === false
              const inManutenzione = flag?.manutenzione === true
              return (
                <div key={f.chiave} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className={`text-sm font-medium ${spenta ? 'text-theme-text-muted line-through' : 'text-theme-text-primary'}`}>{f.etichetta}</p>
                        {f.critica && <span className="text-[10px] px-1.5 py-0.5 rounded border border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300">critica</span>}
                        {spenta && <span className="text-[10px] px-1.5 py-0.5 rounded border border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300">SPENTA</span>}
                        {inManutenzione && <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">MANUTENZIONE</span>}
                      </div>
                      <p className="text-[11px] text-theme-text-muted mt-0.5">{f.descrizione}</p>
                      {flag && (spenta || inManutenzione) && (
                        <p className="text-[11px] text-theme-text-muted mt-1">
                          Impostata da {flag.aggiornato_da || 'sconosciuto'} il {dataOra(flag.updated_at)}
                          {flag.motivo ? ` · ${flag.motivo}` : ''}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {spenta || inManutenzione ? (
                        <Bottone variante="primario" disabilitato={inCorso === f.chiave}
                          onClick={() => void imposta(f.chiave, { attiva: true, manutenzione: false })}>Riattiva</Bottone>
                      ) : (
                        <>
                          <Bottone disabilitato={inCorso === f.chiave} onClick={() => setConferma({ funzione: f, azione: 'manutenzione' })}>Manutenzione</Bottone>
                          <Bottone variante="attenzione" disabilitato={inCorso === f.chiave} onClick={() => setConferma({ funzione: f, azione: 'spegni' })}>Spegni</Bottone>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Scheda>

      {!!flags.length && (
        <Scheda titolo="Interruttori impostati, su tutte le aziende">
          <div className="divide-y divide-theme-border">
            {flags.filter(f => !f.attiva || f.manutenzione).map(f => (
              <div key={f.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-theme-text-primary">{f.chiave}</p>
                  <p className="text-[11px] text-theme-text-muted">
                    {f.business === '*' ? 'tutte le aziende' : f.business} · {f.attiva ? 'in manutenzione' : 'spenta'} · {dataOra(f.updated_at)}
                  </p>
                </div>
                <Bottone onClick={async () => {
                  try {
                    const r = await systemControl.impostaInterruttore({ chiave: f.chiave, business: f.business, attiva: true, manutenzione: false, conferma: true })
                    toast.success(r.messaggio)
                    await carica()
                  } catch (e) { toast.error((e as Error).message) }
                }}>Riattiva</Bottone>
              </div>
            ))}
            {!flags.some(f => !f.attiva || f.manutenzione) && (
              <p className="px-4 py-6 text-sm text-theme-text-muted text-center">Tutte le funzioni sono attive ovunque.</p>
            )}
          </div>
        </Scheda>
      )}

      {conferma && (
        <Conferma
          titolo={conferma.azione === 'spegni' ? `Spegni «${conferma.funzione.etichetta}»` : `Metti «${conferma.funzione.etichetta}» in manutenzione`}
          testo={
            conferma.azione === 'spegni'
              ? `La funzione smette di essere eseguita ${ambito === '*' ? 'per TUTTE le aziende' : `per ${AMBITI.find(a => a.id === ambito)?.label}`}. Nessun dato viene cancellato e puoi riaccenderla quando vuoi.`
              : `Gli utenti vedranno un messaggio di manutenzione invece di un errore ${ambito === '*' ? 'su tutte le aziende' : `su ${AMBITI.find(a => a.id === ambito)?.label}`}.`
          }
          etichettaConferma={conferma.azione === 'spegni' ? 'Spegni' : 'Metti in manutenzione'}
          pericolosa={conferma.azione === 'spegni'}
          onAnnulla={() => setConferma(null)}
          onConferma={motivo => void imposta(
            conferma.funzione.chiave,
            conferma.azione === 'spegni'
              ? { attiva: false, manutenzione: false }
              : { attiva: true, manutenzione: true, messaggio: 'Stiamo effettuando un intervento di manutenzione programmata. Il servizio tornera disponibile a breve.' },
            motivo,
          )}
        />
      )}
    </div>
  )
}
