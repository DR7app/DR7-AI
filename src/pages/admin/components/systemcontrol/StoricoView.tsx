// System Control — STORICO: audit degli interventi, configurazioni cambiate
// (con ripristino), avvisi, rilasci, backup e problemi chiusi.
import { useCallback, useEffect, useState } from 'react'
import { ScheletroTabella } from '../../../../components/Scheletro'
import toast from 'react-hot-toast'
import { systemControl } from '../../../../utils/systemControl'
import type { GruppoProblema } from '../../../../utils/systemControl'
import { Scheda, Vuoto, Bottone, Conferma } from './ui'
import { dataOra } from './formato'

interface Audit { id: string; azione: string; attore_email: string | null; automatico: boolean; bersaglio_tipo: string | null; bersaglio_id: string | null; esito: string; messaggio: string | null; created_at: string }
interface StoricoConfig { id: string; tabella: string; riga_id: string; etichetta: string | null; modificato_da: string | null; created_at: string; ripristinato_at: string | null; ripristinabile: boolean }
interface Avviso { id: string; titolo: string | null; severita: string | null; canale: string | null; destinatari: string | null; eventi_raggruppati: number; inviato_at: string }
interface Rilascio { id: string; versione: string; esito: string; rilasciato_at: string; errori_prima: number | null; errori_dopo: number | null; note: string | null }
interface Backup { id: string; eseguito_at: string; esito: string; messaggio: string | null }

type Sezione = 'audit' | 'configurazioni' | 'problemi' | 'avvisi' | 'rilasci' | 'backup'

const SEZIONI: { id: Sezione; label: string }[] = [
  { id: 'audit', label: 'Interventi' },
  { id: 'configurazioni', label: 'Configurazioni' },
  { id: 'problemi', label: 'Problemi chiusi' },
  { id: 'avvisi', label: 'Avvisi' },
  { id: 'rilasci', label: 'Rilasci' },
  { id: 'backup', label: 'Backup' },
]

export default function StoricoView() {
  const [sezione, setSezione] = useState<Sezione>('audit')
  const [dati, setDati] = useState<{
    audit: Audit[]; configStorico: StoricoConfig[]; avvisi: Avviso[]
    rilasci: Rilascio[]; backup: Backup[]; storicoProblemi: GruppoProblema[]
  } | null>(null)
  const [caricamento, setCaricamento] = useState(true)
  const [daRipristinare, setDaRipristinare] = useState<StoricoConfig | null>(null)

  const carica = useCallback(async () => {
    setCaricamento(true)
    try { setDati(await systemControl.metriche(30) as never) }
    catch (e) { toast.error((e as Error).message) }
    finally { setCaricamento(false) }
  }, [])

  useEffect(() => { void carica() }, [carica])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-theme-border overflow-hidden text-xs">
          {SEZIONI.map(s => (
            <button key={s.id} onClick={() => setSezione(s.id)}
              className={`px-3 py-1.5 font-medium transition-colors ${sezione === s.id ? 'bg-[#007aff] text-white' : 'bg-theme-bg-tertiary text-theme-text-secondary hover:text-theme-text-primary'}`}>
              {s.label}
            </button>
          ))}
        </div>
        <Bottone onClick={() => void carica()}>Aggiorna</Bottone>
      </div>

      {caricamento ? <ScheletroTabella righe={5} colonne={4} /> : (
        <>
          {sezione === 'audit' && (
            <Scheda titolo="Ogni intervento del System Control">
              {dati?.audit?.length ? (
                <div className="divide-y divide-theme-border">
                  {dati.audit.map(a => (
                    <div key={a.id} className="px-4 py-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-theme-text-primary">
                            {a.azione}
                            {a.bersaglio_tipo ? <span className="text-theme-text-muted"> · {a.bersaglio_tipo}</span> : null}
                          </p>
                          <p className="text-[11px] text-theme-text-muted mt-0.5">
                            {a.automatico ? 'automatico' : (a.attore_email || 'sconosciuto')} · {dataOra(a.created_at)}
                          </p>
                          {a.messaggio && <p className="text-[11px] text-theme-text-secondary mt-1">{a.messaggio}</p>}
                        </div>
                        <span className={`text-[11px] font-semibold shrink-0 ${a.esito === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : a.esito === 'rifiutata' ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
                          {a.esito}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <Vuoto testo="Nessun intervento registrato." />}
            </Scheda>
          )}

          {sezione === 'configurazioni' && (
            <Scheda titolo="Configurazioni modificate">
              {dati?.configStorico?.length ? (
                <div className="divide-y divide-theme-border">
                  {dati.configStorico.map(c => (
                    <div key={c.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-theme-text-primary">{c.etichetta || `${c.tabella} · ${c.riga_id}`}</p>
                        <p className="text-[11px] text-theme-text-muted mt-0.5">
                          {c.modificato_da || 'sconosciuto'} · {dataOra(c.created_at)}
                          {c.ripristinato_at ? ` · gia ripristinata il ${dataOra(c.ripristinato_at)}` : ''}
                        </p>
                      </div>
                      {c.ripristinabile && !c.ripristinato_at && (
                        <Bottone onClick={() => setDaRipristinare(c)}>Ripristina</Bottone>
                      )}
                    </div>
                  ))}
                </div>
              ) : <Vuoto testo="Nessuna modifica registrata." />}
              <p className="px-4 py-2 text-[11px] text-theme-text-muted border-t border-theme-border">
                Si ripristinano solo le configurazioni. Fatture, pagamenti, contratti e prenotazioni non si riportano
                mai indietro: la loro storia deve restare intatta.
              </p>
            </Scheda>
          )}

          {sezione === 'problemi' && (
            <Scheda titolo="Problemi chiusi">
              {dati?.storicoProblemi?.length ? (
                <div className="divide-y divide-theme-border">
                  {dati.storicoProblemi.map(g => (
                    <div key={g.id} className="px-4 py-2.5">
                      <p className="text-sm text-theme-text-primary">{g.titolo}</p>
                      <p className="text-[11px] text-theme-text-muted mt-0.5">
                        durato da {dataOra(g.prima_comparsa)} a {dataOra(g.ultima_comparsa)} · {g.occorrenze} occorrenze ·
                        {g.risolto_auto ? ' risolto automaticamente' : ` chiuso da ${g.risolto_da || 'sconosciuto'}`}
                        {g.risolto_at ? ` il ${dataOra(g.risolto_at)}` : ''}
                      </p>
                      {g.risolto_come && <p className="text-[11px] text-theme-text-secondary mt-1">{g.risolto_come}</p>}
                    </div>
                  ))}
                </div>
              ) : <Vuoto testo="Nessun problema chiuso finora." />}
            </Scheda>
          )}

          {sezione === 'avvisi' && (
            <Scheda titolo="Avvisi generati">
              {dati?.avvisi?.length ? (
                <div className="divide-y divide-theme-border">
                  {dati.avvisi.map(a => (
                    <div key={a.id} className="px-4 py-2.5">
                      <p className="text-sm text-theme-text-primary">{a.titolo}</p>
                      <p className="text-[11px] text-theme-text-muted mt-0.5">
                        {a.severita} · {a.eventi_raggruppati} eventi raggruppati · {a.canale}{a.destinatari ? ` (${a.destinatari})` : ''} · {dataOra(a.inviato_at)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : <Vuoto testo="Nessun avviso generato." />}
              <p className="px-4 py-2 text-[11px] text-theme-text-muted border-t border-theme-border">
                Gli errori uguali sono raggruppati: lo stesso problema genera al massimo un avviso all ora.
                Escono dal gestionale solo i problemi critici, e solo verso i numeri configurati apposta.
              </p>
            </Scheda>
          )}

          {sezione === 'rilasci' && (
            <Scheda titolo="Rilasci sorvegliati">
              {dati?.rilasci?.length ? (
                <div className="divide-y divide-theme-border">
                  {dati.rilasci.map(r => (
                    <div key={r.id} className="px-4 py-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm text-theme-text-primary">{r.versione}</p>
                        <span className={`text-[11px] font-semibold ${r.esito === 'peggiorato' ? 'text-red-600 dark:text-red-400' : r.esito === 'stabile' ? 'text-emerald-600 dark:text-emerald-400' : 'text-theme-text-muted'}`}>
                          {r.esito}
                        </span>
                      </div>
                      <p className="text-[11px] text-theme-text-muted mt-0.5">
                        {dataOra(r.rilasciato_at)} · errori prima {r.errori_prima ?? '—'} / dopo {r.errori_dopo ?? '—'}
                      </p>
                      {r.note && <p className="text-[11px] text-theme-text-secondary mt-1">{r.note}</p>}
                    </div>
                  ))}
                </div>
              ) : <Vuoto testo="Nessun rilascio registrato." />}
            </Scheda>
          )}

          {sezione === 'backup' && (
            <Scheda titolo="Verifiche dei backup">
              {dati?.backup?.length ? (
                <div className="divide-y divide-theme-border">
                  {dati.backup.map(b => (
                    <div key={b.id} className="px-4 py-2.5 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-theme-text-primary">{dataOra(b.eseguito_at)}</p>
                        <p className="text-[11px] text-theme-text-muted mt-0.5">{b.messaggio}</p>
                      </div>
                      <span className={`text-[11px] font-semibold shrink-0 ${b.esito === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : b.esito === 'errore' ? 'text-red-600 dark:text-red-400' : 'text-theme-text-muted'}`}>
                        {b.esito}
                      </span>
                    </div>
                  ))}
                </div>
              ) : <Vuoto testo="Nessuna verifica registrata. Il controllo gira una volta al giorno." />}
              <p className="px-4 py-2 text-[11px] text-theme-text-muted border-t border-theme-border">
                Il ripristino di un backup di produzione non e un pulsante di questo pannello: si fa dalla console
                Supabase, di proposito.
              </p>
            </Scheda>
          )}
        </>
      )}

      {daRipristinare && (
        <Conferma
          titolo="Ripristina configurazione"
          testo={`«${daRipristinare.etichetta || daRipristinare.tabella}» torna alla versione precedente. La versione attuale viene salvata nello storico, quindi anche questo ripristino e reversibile.`}
          etichettaConferma="Ripristina"
          pericolosa
          onAnnulla={() => setDaRipristinare(null)}
          onConferma={async motivo => {
            try {
              const r = await systemControl.azioneSistema('ripristina_configurazione', { id: daRipristinare.id, conferma: true, motivo })
              if (r.ok) toast.success(r.messaggio); else toast.error(r.messaggio)
              await carica()
            } catch (e) { toast.error((e as Error).message) }
            finally { setDaRipristinare(null) }
          }}
        />
      )}
    </div>
  )
}
