// System Control — INTEGRATION HEALTH.
import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { systemControl } from '../../../../utils/systemControl'
import type { IntegrazioneRiga, Diagnosi, GruppoProblema, Operazione } from '../../../../utils/systemControl'
import { Scheda, Vuoto, Bottone, Conferma } from './ui'
import { dataOra, quandoRelativo } from './formato'

const ETICHETTA_STATO: Record<string, { testo: string; stile: string }> = {
  collegato:                { testo: 'Collegato',                stile: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' },
  non_collegato:            { testo: 'Non collegato',            stile: 'bg-theme-bg-tertiary text-theme-text-muted border-theme-border' },
  errore:                   { testo: 'Errore',                   stile: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/40' },
  credenziali_scadute:      { testo: 'Credenziali scadute',      stile: 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30' },
  servizio_non_disponibile: { testo: 'Servizio non disponibile', stile: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30' },
  sincronizzazione:         { testo: 'Sincronizzazione',         stile: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30' },
  disabilitata:             { testo: 'Disattivata',              stile: 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30' },
}

function Stato({ valore }: { valore?: string }) {
  const v = ETICHETTA_STATO[valore || 'non_collegato'] || ETICHETTA_STATO.non_collegato
  return <span className={`inline-flex px-2 py-0.5 rounded-md border text-[11px] font-semibold ${v.stile}`}>{v.testo}</span>
}

export default function IntegrazioniView() {
  const [righe, setRighe] = useState<IntegrazioneRiga[]>([])
  const [caricamento, setCaricamento] = useState(true)
  const [aperta, setAperta] = useState<string | null>(null)

  const carica = useCallback(async () => {
    setCaricamento(true)
    try { setRighe((await systemControl.integrazioni()).integrazioni || []) }
    catch (e) { toast.error((e as Error).message) }
    finally { setCaricamento(false) }
  }, [])

  useEffect(() => { void carica() }, [carica])

  const perCategoria = righe.reduce<Record<string, IntegrazioneRiga[]>>((acc, r) => {
    (acc[r.categoria] = acc[r.categoria] || []).push(r)
    return acc
  }, {})

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-theme-text-muted">
          Le credenziali non compaiono mai in questa pagina: si vede solo se sono presenti e se il servizio risponde.
        </p>
        <Bottone onClick={() => void carica()}>Aggiorna</Bottone>
      </div>

      {caricamento ? <p className="text-sm text-theme-text-muted">Caricamento...</p> : Object.entries(perCategoria).map(([categoria, lista]) => (
        <Scheda key={categoria} titolo={categoria.charAt(0).toUpperCase() + categoria.slice(1)}>
          <div className="divide-y divide-theme-border">
            {lista.map(r => (
              <button key={r.chiave} onClick={() => setAperta(r.chiave)}
                className="w-full text-left px-4 py-3 hover:bg-theme-bg-hover transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-theme-text-primary">{r.etichetta}</p>
                    <p className="text-[11px] text-theme-text-muted mt-0.5">
                      Ultimo test {quandoRelativo(r.ultimo_test_at)}
                      {r.ultima_sync_at ? ` · sincronizzato ${quandoRelativo(r.ultima_sync_at)}` : ''}
                      {r.operazioniInSospeso ? ` · ${r.operazioniInSospeso} operazioni in sospeso` : ''}
                      {r.credenzialiTotali ? ` · ${r.credenzialiTotali - r.credenzialiMancanti}/${r.credenzialiTotali} impostazioni` : ''}
                    </p>
                    {r.ultimo_errore && <p className="text-[11px] text-red-600 dark:text-red-400 mt-1 line-clamp-1">{r.ultimo_errore}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Stato valore={r.abilitata === false ? 'disabilitata' : r.stato} />
                    {r.circuito === 'aperto' && <span className="text-[10px] text-amber-600 dark:text-amber-400">chiamate in pausa</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Scheda>
      ))}

      {aperta && <DettaglioIntegrazione chiave={aperta} onChiudi={() => setAperta(null)} onAggiornato={() => void carica()} />}
    </div>
  )
}

const AZIONI: { chiave: string; etichetta: string; conferma: boolean; descrizione: string }[] = [
  { chiave: 'testa_connessione', etichetta: 'Testa connessione', conferma: false, descrizione: 'Contatta il servizio adesso e riporta se risponde.' },
  { chiave: 'riconnetti', etichetta: 'Riconnetti', conferma: false, descrizione: 'Azzera il blocco automatico, rilegge le credenziali e riprova.' },
  { chiave: 'risincronizza', etichetta: 'Risincronizza', conferma: true, descrizione: 'Rimette in coda le operazioni ferme di questo collegamento. Nessun dato viene creato da zero.' },
  { chiave: 'rigenera_connessione', etichetta: 'Rigenera connessione', conferma: true, descrizione: 'Ricostruisce lo stato del collegamento partendo dalle credenziali salvate.' },
  { chiave: 'aggiorna_credenziali', etichetta: 'Aggiorna credenziali', conferma: false, descrizione: 'Mostra quali impostazioni servono e dove si cambiano.' },
  { chiave: 'disabilita_integrazione', etichetta: 'Disattiva temporaneamente', conferma: true, descrizione: 'Ferma le chiamate. Le operazioni restano in coda e riprendono alla riattivazione.' },
  { chiave: 'riattiva_integrazione', etichetta: 'Riattiva', conferma: false, descrizione: 'Rimette in servizio il collegamento.' },
]

const COLORE_CONTROLLO: Record<string, string> = {
  ok: 'text-emerald-600 dark:text-emerald-400',
  attenzione: 'text-amber-600 dark:text-amber-400',
  ko: 'text-red-600 dark:text-red-400',
  sconosciuto: 'text-theme-text-muted',
}

function DettaglioIntegrazione({ chiave, onChiudi, onAggiornato }: { chiave: string; onChiudi: () => void; onAggiornato: () => void }) {
  const [dati, setDati] = useState<{
    integrazione: IntegrazioneRiga
    credenziali: { nome: string; presente: boolean }[]
    diagnosi: Diagnosi
    errori: GruppoProblema[]
    operazioni: Operazione[]
  } | null>(null)
  const [inCorso, setInCorso] = useState<string | null>(null)
  const [daConfermare, setDaConfermare] = useState<typeof AZIONI[number] | null>(null)

  const carica = useCallback(async () => {
    try { setDati(await systemControl.integrazione(chiave)) }
    catch (e) { toast.error((e as Error).message) }
  }, [chiave])

  useEffect(() => { void carica() }, [carica])

  async function esegui(azione: string, motivo?: string) {
    setInCorso(azione)
    try {
      const r = await systemControl.azioneIntegrazione(azione, chiave, motivo)
      if (r.ok) toast.success(r.messaggio, { duration: 8000 }); else toast.error(r.messaggio, { duration: 10000 })
      await carica()
      onAggiornato()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setInCorso(null)
      setDaConfermare(null)
    }
  }

  const i = dati?.integrazione

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onChiudi}>
      <div className="w-full max-w-2xl h-full overflow-y-auto bg-theme-bg-primary border-l border-theme-border" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 z-10 bg-theme-bg-primary px-5 py-4 border-b border-theme-border flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-theme-text-primary">{i?.etichetta || chiave}</h2>
            <div className="mt-1.5"><Stato valore={i?.abilitata === false ? 'disabilitata' : i?.stato} /></div>
          </div>
          <Bottone onClick={onChiudi}>Chiudi</Bottone>
        </div>

        {!dati ? <p className="px-5 py-8 text-sm text-theme-text-muted">Diagnostica in corso...</p> : (
          <div className="p-5 space-y-5">
            <Scheda titolo="Se questo collegamento cade">
              <p className="px-4 py-3 text-sm text-theme-text-secondary leading-relaxed">{i?.impatto}</p>
            </Scheda>

            <Scheda titolo="Controlli automatici">
              <div className="divide-y divide-theme-border">
                {dati.diagnosi.controlli.map((c, idx) => (
                  <div key={idx} className="px-4 py-2.5 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-theme-text-primary">{c.nome}</p>
                      <p className="text-xs text-theme-text-muted mt-0.5">{c.dettaglio}</p>
                    </div>
                    <span className={`text-[11px] font-semibold uppercase shrink-0 ${COLORE_CONTROLLO[c.esito]}`}>{c.esito}</span>
                  </div>
                ))}
              </div>
              <div className="px-4 py-3 border-t border-theme-border bg-theme-bg-tertiary/40">
                <p className="text-sm font-medium text-theme-text-primary">{dati.diagnosi.conclusione}</p>
                <p className="text-xs text-theme-text-secondary mt-1">{dati.diagnosi.azioneConsigliata}</p>
              </div>
            </Scheda>

            <Scheda titolo="Azioni">
              <div className="px-4 py-3 flex flex-wrap gap-2">
                {AZIONI.map(a => (
                  <Bottone key={a.chiave} titolo={a.descrizione} disabilitato={inCorso === a.chiave}
                    variante={a.chiave === 'disabilita_integrazione' ? 'attenzione' : a.chiave === 'testa_connessione' ? 'primario' : 'normale'}
                    onClick={() => a.conferma ? setDaConfermare(a) : void esegui(a.chiave)}>
                    {inCorso === a.chiave ? 'Attendere...' : a.etichetta}
                  </Bottone>
                ))}
              </div>
            </Scheda>

            <Scheda titolo="Impostazioni richieste">
              <div className="divide-y divide-theme-border">
                {dati.credenziali.length === 0 && <Vuoto testo="Questo collegamento non usa credenziali." />}
                {dati.credenziali.map(c => (
                  <div key={c.nome} className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <code className="text-xs text-theme-text-primary">{c.nome}</code>
                    <span className={`text-[11px] font-semibold ${c.presente ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                      {c.presente ? 'presente' : 'mancante'}
                    </span>
                  </div>
                ))}
              </div>
              <p className="px-4 py-2 text-[11px] text-theme-text-muted border-t border-theme-border">
                Si vede solo il nome e se e valorizzata. Il contenuto non lascia mai il server.
              </p>
            </Scheda>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border px-4 py-3">
                <p className="text-theme-text-muted">Ultimo test</p>
                <p className="text-theme-text-primary mt-1">{dataOra(i?.ultimo_test_at)}</p>
                <p className="text-theme-text-muted mt-1">{i?.ultimo_test_messaggio || '—'}</p>
              </div>
              <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border px-4 py-3">
                <p className="text-theme-text-muted">Ultimo errore</p>
                <p className="text-theme-text-primary mt-1">{dataOra(i?.ultimo_errore_at)}</p>
                <p className="text-theme-text-muted mt-1 break-words">{i?.ultimo_errore || '—'}</p>
              </div>
            </div>

            {!!dati.operazioni.length && (
              <Scheda titolo={`Operazioni in sospeso (${dati.operazioni.length})`}>
                <div className="divide-y divide-theme-border">
                  {dati.operazioni.slice(0, 20).map(o => (
                    <div key={o.id} className="px-4 py-2.5">
                      <p className="text-sm text-theme-text-primary">{o.descrizione}</p>
                      <p className="text-[11px] text-theme-text-muted">{o.stato} · {o.tentativi}/{o.max_tentativi} tentativi · prossimo {quandoRelativo(o.prossimo_tentativo_at)}</p>
                    </div>
                  ))}
                </div>
              </Scheda>
            )}

            {!!dati.errori.length && (
              <Scheda titolo="Errori registrati">
                <div className="divide-y divide-theme-border">
                  {dati.errori.map(e => (
                    <div key={e.id} className="px-4 py-2.5">
                      <p className="text-sm text-theme-text-primary">{e.titolo}</p>
                      <p className="text-[11px] text-theme-text-muted">{e.occorrenze} volte · ultima {quandoRelativo(e.ultima_comparsa)} · {e.stato}</p>
                    </div>
                  ))}
                </div>
              </Scheda>
            )}
          </div>
        )}
      </div>

      {daConfermare && (
        <Conferma
          titolo={daConfermare.etichetta}
          testo={daConfermare.descrizione}
          etichettaConferma={daConfermare.etichetta}
          pericolosa={daConfermare.chiave === 'disabilita_integrazione'}
          onAnnulla={() => setDaConfermare(null)}
          onConferma={motivo => void esegui(daConfermare.chiave, motivo)}
        />
      )}
    </div>
  )
}
