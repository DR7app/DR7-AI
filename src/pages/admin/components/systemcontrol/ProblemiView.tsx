// System Control — PROBLEMI: elenco raggruppato e scheda di dettaglio con la
// diagnostica automatica, le azioni sicure e l assistente.
import { useCallback, useEffect, useState } from 'react'
import { ScheletroTabella } from '../../../../components/Scheletro'
import toast from 'react-hot-toast'
import { systemControl } from '../../../../utils/systemControl'
import type { GruppoProblema, Diagnosi, Operazione, Severita } from '../../../../utils/systemControl'
import { BadgeSeverita, BadgeClasse, Scheda, Vuoto, Bottone, Conferma } from './ui'
import { dataOra, quandoRelativo } from './formato'

const SEVERITA: Severita[] = ['critico', 'alto', 'medio', 'basso', 'informativo']

export default function ProblemiView({ idIniziale, onApertoCambiato }: {
  idIniziale?: string | null
  onApertoCambiato?: (id: string | null) => void
}) {
  const [gruppi, setGruppi] = useState<GruppoProblema[]>([])
  const [caricamento, setCaricamento] = useState(true)
  const [filtroStato, setFiltroStato] = useState('aperti')
  const [filtroSeverita, setFiltroSeverita] = useState('tutte')
  const [filtroClasse, setFiltroClasse] = useState('')
  const [cerca, setCerca] = useState('')
  const [apertoId, setApertoId] = useState<string | null>(idIniziale || null)

  const carica = useCallback(async () => {
    setCaricamento(true)
    try {
      const q: Record<string, string> = { stato: filtroStato, severita: filtroSeverita }
      if (filtroClasse) q.classe = filtroClasse
      if (cerca.trim()) q.cerca = cerca.trim()
      const res = await systemControl.problemi(q)
      setGruppi(res.gruppi || [])
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCaricamento(false)
    }
  }, [filtroStato, filtroSeverita, filtroClasse, cerca])

  useEffect(() => { void carica() }, [carica])
  useEffect(() => { if (idIniziale) setApertoId(idIniziale) }, [idIniziale])
  useEffect(() => { onApertoCambiato?.(apertoId) }, [apertoId, onApertoCambiato])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={filtroStato} onChange={e => setFiltroStato(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-xs text-theme-text-primary">
          <option value="aperti">Aperti</option>
          <option value="risolto">Risolti</option>
          <option value="ignorato">Ignorati</option>
          <option value="tutti">Tutti</option>
        </select>
        <select value={filtroSeverita} onChange={e => setFiltroSeverita(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-xs text-theme-text-primary">
          <option value="tutte">Ogni gravita</option>
          {SEVERITA.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filtroClasse} onChange={e => setFiltroClasse(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-xs text-theme-text-primary">
          <option value="">Chiunque risolva</option>
          <option value="1">Si risolve da solo</option>
          <option value="2">Posso risolverlo io</option>
          <option value="3">Serve lo sviluppatore</option>
        </select>
        <input value={cerca} onChange={e => setCerca(e.target.value)} placeholder="Cerca nel testo dell errore"
          className="flex-1 min-w-[200px] px-3 py-1.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-xs text-theme-text-primary placeholder:text-theme-text-muted" />
        <Bottone onClick={() => void carica()}>Aggiorna</Bottone>
      </div>

      <Scheda>
        {caricamento ? <ScheletroTabella righe={5} colonne={4} />
          : gruppi.length === 0 ? <Vuoto testo="Nessun problema con questi filtri." />
          : (
            <div className="divide-y divide-theme-border">
              {gruppi.map(g => (
                <button key={g.id} onClick={() => setApertoId(g.id)}
                  className="w-full text-left px-4 py-3 hover:bg-theme-bg-hover transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-theme-text-primary">{g.titolo}</p>
                        {g.stato === 'risolto' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                            {g.risolto_auto ? 'risolto da solo' : 'risolto'}
                          </span>
                        )}
                        {g.stato === 'ignorato' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded border border-theme-border text-theme-text-muted">ignorato</span>
                        )}
                      </div>
                      <p className="text-xs text-theme-text-secondary mt-0.5 line-clamp-1">{g.causa_probabile}</p>
                      <p className="text-[11px] text-theme-text-muted mt-1">
                        {g.occorrenze} {g.occorrenze === 1 ? 'volta' : 'volte'} · prima {quandoRelativo(g.prima_comparsa)} · ultima {quandoRelativo(g.ultima_comparsa)}
                        {g.integrazione ? ` · ${g.integrazione}` : ''}{g.modulo ? ` · ${g.modulo}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <BadgeSeverita severita={g.severita} />
                      <BadgeClasse classe={g.classe_risoluzione} />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
      </Scheda>

      {apertoId && (
        <DettaglioProblema
          id={apertoId}
          onChiudi={() => setApertoId(null)}
          onAggiornato={() => void carica()}
        />
      )}
    </div>
  )
}

const COLORE_CONTROLLO: Record<string, string> = {
  ok: 'text-emerald-600 dark:text-emerald-400',
  attenzione: 'text-amber-600 dark:text-amber-400',
  ko: 'text-red-600 dark:text-red-400',
  sconosciuto: 'text-theme-text-muted',
}

function DettaglioProblema({ id, onChiudi, onAggiornato }: { id: string; onChiudi: () => void; onAggiornato: () => void }) {
  const [dati, setDati] = useState<{
    gruppo: GruppoProblema
    eventi: Record<string, unknown>[]
    operazioni: Operazione[]
    incidenti: Record<string, unknown>[]
    diagnosi: Diagnosi | null
    azioni: { chiave: string; etichetta: string; descrizione: string; conferma: boolean }[]
  } | null>(null)
  const [caricamento, setCaricamento] = useState(true)
  const [inCorso, setInCorso] = useState<string | null>(null)
  const [analisi, setAnalisi] = useState<string | null>(null)
  const [daConfermare, setDaConfermare] = useState<{ chiave: string; etichetta: string; descrizione: string } | null>(null)

  const carica = useCallback(async () => {
    setCaricamento(true)
    try { setDati(await systemControl.problema(id)) }
    catch (e) { toast.error((e as Error).message) }
    finally { setCaricamento(false) }
  }, [id])

  useEffect(() => { void carica() }, [carica])

  async function esegui(chiave: string, motivo?: string) {
    setInCorso(chiave)
    try {
      if (chiave === 'apri_incidente') {
        const r = await systemControl.creaIncidente(id)
        toast.success(r.messaggio)
      } else if (['segna_risolto', 'riapri', 'ignora'].includes(chiave)) {
        const r = await systemControl.azioneProblema(chiave, id, motivo)
        toast.success(r.messaggio)
      } else if (chiave === 'testa_connessione' || chiave === 'riconnetti' || chiave === 'risincronizza' || chiave === 'aggiorna_credenziali') {
        const integrazione = dati?.gruppo.integrazione
        if (!integrazione) { toast.error('Questo problema non e legato a un collegamento.'); return }
        const r = await systemControl.azioneIntegrazione(chiave, integrazione, motivo)
        if (r.ok) toast.success(r.messaggio); else toast.error(r.messaggio)
      } else if (chiave === 'riprova') {
        const daRiprendere = (dati?.operazioni || []).filter(o => o.stato !== 'riuscita')
        if (!daRiprendere.length) { toast('Nessuna operazione da riprendere per questo problema.'); return }
        for (const o of daRiprendere.slice(0, 5)) {
          const r = await systemControl.azioneOperazione('riprova', { id: o.id })
          if (r.ok) toast.success(r.messaggio); else toast.error(r.messaggio)
        }
      } else {
        toast('Questa azione si esegue dalla schermata dedicata.')
      }
      await carica()
      onAggiornato()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setInCorso(null)
      setDaConfermare(null)
    }
  }

  async function chiediAssistente() {
    setInCorso('assistente')
    try {
      const r = await systemControl.assistente(id)
      if (r.ok && r.analisi) setAnalisi(r.analisi)
      else toast.error(r.messaggio || 'Assistente non disponibile.')
    } catch (e) {
      toast.error((e as Error).message)
    } finally { setInCorso(null) }
  }

  const g = dati?.gruppo

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onChiudi}>
      <div className="w-full max-w-2xl h-full overflow-y-auto bg-theme-bg-primary border-l border-theme-border" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 z-10 bg-theme-bg-primary px-5 py-4 border-b border-theme-border flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-theme-text-primary">{g?.titolo || 'Problema'}</h2>
            {g && (
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <BadgeSeverita severita={g.severita} />
                <BadgeClasse classe={g.classe_risoluzione} />
                <span className="text-[11px] text-theme-text-muted">{g.occorrenze} occorrenze</span>
              </div>
            )}
          </div>
          <Bottone onClick={onChiudi}>Chiudi</Bottone>
        </div>

        {caricamento ? <p className="px-5 py-8 text-sm text-theme-text-muted">Diagnostica in corso...</p> : !g ? null : (
          <div className="p-5 space-y-5">
            {/* Cosa e' successo, in parole semplici */}
            <Scheda titolo="Cosa e successo">
              <div className="px-4 py-3 space-y-2 text-sm">
                <p className="text-theme-text-secondary leading-relaxed">{g.causa_probabile}</p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-2 text-xs">
                  <dt className="text-theme-text-muted">Prima comparsa</dt><dd className="text-theme-text-primary">{dataOra(g.prima_comparsa)}</dd>
                  <dt className="text-theme-text-muted">Ultima comparsa</dt><dd className="text-theme-text-primary">{dataOra(g.ultima_comparsa)}</dd>
                  <dt className="text-theme-text-muted">Ancora presente</dt>
                  <dd className="text-theme-text-primary">{Date.now() - new Date(g.ultima_comparsa).getTime() < 3600_000 ? 'Si, nell ultima ora' : 'Non nelle ultime ore'}</dd>
                  <dt className="text-theme-text-muted">Funzione</dt><dd className="text-theme-text-primary">{g.modulo || '—'}{g.funzione && g.funzione !== g.modulo ? ` · ${g.funzione}` : ''}</dd>
                  <dt className="text-theme-text-muted">Integrazione</dt><dd className="text-theme-text-primary">{g.integrazione || 'nessuna'}</dd>
                  <dt className="text-theme-text-muted">Azienda</dt><dd className="text-theme-text-primary">{g.business || (g.aziende_coinvolte || []).join(', ') || '—'}</dd>
                  <dt className="text-theme-text-muted">Utenti coinvolti</dt><dd className="text-theme-text-primary">{(g.utenti_coinvolti || []).length ? g.utenti_coinvolti.join(', ') : 'nessuno identificato'}</dd>
                  <dt className="text-theme-text-muted">Tentativi automatici</dt><dd className="text-theme-text-primary">{g.auto_tentativi || 0}{g.auto_ultimo_esito ? ` · ${g.auto_ultimo_esito}` : ''}</dd>
                </dl>
              </div>
            </Scheda>

            {/* Diagnostica automatica */}
            {dati?.diagnosi && (
              <Scheda titolo="Controlli automatici">
                <div className="divide-y divide-theme-border">
                  {dati.diagnosi.controlli.map((c, i) => (
                    <div key={i} className="px-4 py-2.5 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-theme-text-primary">{c.nome}</p>
                        <p className="text-xs text-theme-text-muted mt-0.5">{c.dettaglio}</p>
                      </div>
                      <span className={`text-[11px] font-semibold uppercase shrink-0 ${COLORE_CONTROLLO[c.esito]}`}>{c.esito}</span>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-3 border-t border-theme-border bg-theme-bg-tertiary/40">
                  <p className="text-sm text-theme-text-primary font-medium">{dati.diagnosi.conclusione}</p>
                  <p className="text-xs text-theme-text-secondary mt-1">{dati.diagnosi.azioneConsigliata}</p>
                </div>
              </Scheda>
            )}

            {/* Azioni */}
            <Scheda titolo="Cosa puoi fare da qui">
              <div className="px-4 py-3 flex flex-wrap gap-2">
                {(dati?.azioni || []).map(a => (
                  <Bottone key={a.chiave} titolo={a.descrizione} disabilitato={inCorso === a.chiave}
                    onClick={() => a.conferma ? setDaConfermare(a) : void esegui(a.chiave)}>
                    {inCorso === a.chiave ? 'Attendere...' : a.etichetta}
                  </Bottone>
                ))}
                {g.stato !== 'risolto' && (
                  <Bottone onClick={() => void esegui('segna_risolto')} disabilitato={inCorso === 'segna_risolto'}>Segna come risolto</Bottone>
                )}
                {g.stato === 'risolto' && (
                  <Bottone onClick={() => void esegui('riapri')} disabilitato={inCorso === 'riapri'}>Riapri</Bottone>
                )}
                <Bottone variante="primario" onClick={() => void chiediAssistente()} disabilitato={inCorso === 'assistente'}>
                  {inCorso === 'assistente' ? 'Sto analizzando...' : 'Chiedi all assistente'}
                </Bottone>
              </div>
            </Scheda>

            {analisi && (
              <Scheda titolo="Analisi dell assistente">
                <pre className="px-4 py-3 text-sm text-theme-text-secondary whitespace-pre-wrap font-sans leading-relaxed">{analisi}</pre>
                <p className="px-4 pb-3 text-[11px] text-theme-text-muted">
                  L assistente legge soltanto: non modifica dati, non esegue azioni e non vede credenziali.
                </p>
              </Scheda>
            )}

            {/* Operazioni collegate */}
            {!!dati?.operazioni?.length && (
              <Scheda titolo="Operazioni bloccate da questo problema">
                <div className="divide-y divide-theme-border">
                  {dati.operazioni.map(o => (
                    <div key={o.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-theme-text-primary truncate">{o.descrizione}</p>
                        <p className="text-[11px] text-theme-text-muted">{o.stato} · {o.tentativi} tentativi</p>
                      </div>
                      {o.stato !== 'riuscita' && (
                        <Bottone onClick={async () => {
                          const r = await systemControl.azioneOperazione('riprova', { id: o.id })
                          if (r.ok) toast.success(r.messaggio); else toast.error(r.messaggio)
                          await carica()
                        }}>Riprova</Bottone>
                      )}
                    </div>
                  ))}
                </div>
              </Scheda>
            )}

            {/* Rapporti tecnici gia' creati */}
            {!!dati?.incidenti?.length && (
              <Scheda titolo="Rapporti tecnici collegati">
                <div className="px-4 py-3 space-y-1">
                  {dati.incidenti.map(i => (
                    <p key={String(i.id)} className="text-sm text-theme-text-secondary">
                      {String(i.numero)} · {String(i.stato)} · {dataOra(String(i.created_at))}
                    </p>
                  ))}
                </div>
              </Scheda>
            )}

            {/* Dettaglio tecnico, in fondo */}
            <Scheda titolo="Dettaglio tecnico">
              <pre className="px-4 py-3 text-[11px] text-theme-text-muted whitespace-pre-wrap break-words">{g.messaggio_tecnico || '—'}</pre>
              {!!dati?.eventi?.length && (
                <div className="border-t border-theme-border divide-y divide-theme-border">
                  {dati.eventi.slice(0, 5).map((e, i) => (
                    <div key={i} className="px-4 py-2">
                      <p className="text-[11px] text-theme-text-muted">
                        {dataOra(String(e.occorso_at))} · {String(e.origine)}{e.utente_email ? ` · ${String(e.utente_email)}` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Scheda>
          </div>
        )}
      </div>

      {daConfermare && (
        <Conferma
          titolo={daConfermare.etichetta}
          testo={daConfermare.descrizione}
          etichettaConferma={daConfermare.etichetta}
          onAnnulla={() => setDaConfermare(null)}
          onConferma={motivo => void esegui(daConfermare.chiave, motivo)}
        />
      )}
    </div>
  )
}
