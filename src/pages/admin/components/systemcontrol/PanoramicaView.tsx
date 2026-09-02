// System Control — SYSTEM HEALTH: lo stato della piattaforma in una schermata.
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { systemControl } from '../../../../utils/systemControl'
import type { Servizio, StatoServizio, Severita, GruppoProblema } from '../../../../utils/systemControl'
import { BadgeStato, BadgeSeverita, Scheda, Vuoto, Bottone } from './ui'
import { quandoRelativo, dataOra } from './formato'

interface Panoramica {
  migrazioneEseguita: boolean
  messaggio?: string
  ambiente?: string
  versione?: string
  statoGenerale?: StatoServizio
  servizi?: Servizio[]
  problemi?: {
    aperti: number
    perSeverita: Record<string, number>
    ultimaOra: number
    daSviluppo: number
    piuGravi: GruppoProblema[]
  }
  operazioni?: { inCoda: number; abbandonate: number; totale: number }
  integrazioni?: { totale: number; conProblemi: number }
  prestazioni?: { chiamate24h: number; tassoErrore: number; mediaMs: number }
  interruttori?: { spente: { chiave: string; business: string }[]; manutenzione: { chiave: string; business: string }[] }
  backup?: { eseguito_at: string; esito: string; messaggio: string | null } | null
  release?: { versione: string; esito: string; rilasciato_at: string; note: string | null } | null
  ultimoControllo?: {
    eseguitoAt: string
    esito: string
    riepilogo: string | null
    statoGenerale: string | null
    voci: { area: string; esito: 'ok' | 'attenzione' | 'ko'; titolo: string; dettaglio: string }[]
    automatico: boolean
    inRitardo: boolean
  } | null
}

export default function PanoramicaView({ onApriProblema, onCambiaVista }: {
  onApriProblema: (id: string) => void
  onCambiaVista: (vista: string) => void
}) {
  const [dati, setDati] = useState<Panoramica | null>(null)
  const [caricamento, setCaricamento] = useState(true)
  const [inControllo, setInControllo] = useState(false)
  const [mostraTutte, setMostraTutte] = useState(false)

  // Il giro completo gira da solo ogni ora: questo pulsante lo rifa adesso,
  // per chi non vuole aspettare il prossimo scatto.
  async function controllaAdesso() {
    setInControllo(true)
    try {
      const r = await systemControl.azioneSistema('controllo_adesso')
      toast[r.ok ? 'success' : 'error'](r.messaggio)
      await carica(true)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setInControllo(false)
    }
  }

  async function carica(silenzioso = false) {
    if (!silenzioso) setCaricamento(true)
    try {
      setDati(await systemControl.panoramica() as unknown as Panoramica)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCaricamento(false)
    }
  }

  useEffect(() => {
    void carica()
    // Aggiornamento automatico ogni due minuti: il centro di controllo deve
    // dire la verita' adesso, non quando e' stata aperta la pagina.
    const t = setInterval(() => void carica(true), 120_000)
    return () => clearInterval(t)
  }, [])

  if (caricamento && !dati) return <p className="text-sm text-theme-text-muted">Controllo dello stato in corso...</p>

  if (dati && !dati.migrazioneEseguita) {
    return (
      <Scheda titolo="Migrazione da eseguire">
        <div className="px-4 py-5 space-y-3">
          <p className="text-sm text-theme-text-secondary leading-relaxed">
            {dati.messaggio || 'Le tabelle del System Control non esistono ancora.'}
          </p>
          <p className="text-sm text-theme-text-secondary leading-relaxed">
            Apri il SQL editor di Supabase ed esegui il file{' '}
            <code className="px-1.5 py-0.5 rounded bg-theme-bg-tertiary text-theme-text-primary text-xs">supabase/migrations/20260831_system_control.sql</code>.
            Fino ad allora il gestionale funziona normalmente: il System Control resta in attesa e non registra nulla.
          </p>
          {dati.servizi?.length ? (
            <div className="pt-2 border-t border-theme-border space-y-2">
              {dati.servizi.map(s => (
                <div key={s.chiave} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-theme-text-primary">{s.etichetta}</span>
                  <BadgeStato stato={s.stato} />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </Scheda>
    )
  }

  const p = dati?.problemi
  const severita: Severita[] = ['critico', 'alto', 'medio', 'basso', 'informativo']

  return (
    <div className="space-y-5">
      {/* Riga di intestazione: stato complessivo */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BadgeStato stato={dati?.statoGenerale || 'operativo'} />
          <span className="text-xs text-theme-text-muted">
            Ambiente {dati?.ambiente} · versione {dati?.versione}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Bottone onClick={() => void controllaAdesso()} disabilitato={inControllo} variante="primario">
            {inControllo ? 'Controllo in corso' : 'Controlla adesso'}
          </Bottone>
          <Bottone onClick={() => void carica()}>Aggiorna</Bottone>
        </div>
      </div>

      {/* Controllo orario: il verbale dell'ultimo giro completo */}
      <Scheda
        titolo="Controllo orario"
        azione={dati?.ultimoControllo
          ? <span className="text-[11px] text-theme-text-muted">
              {dataOra(dati.ultimoControllo.eseguitoAt)} · {dati.ultimoControllo.automatico ? 'automatico' : 'lanciato a mano'}
            </span>
          : undefined}
      >
        {dati?.ultimoControllo ? (
          <div className="px-4 py-3 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <BadgeStato stato={(dati.ultimoControllo.statoGenerale as StatoServizio) || 'operativo'} />
              <p className="text-sm text-theme-text-primary">{dati.ultimoControllo.riepilogo}</p>
            </div>
            {dati.ultimoControllo.inRitardo && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Il controllo non gira da piu di tre ore: e fermo anche lui. Lancialo a mano con "Controlla adesso".
              </p>
            )}
            {(() => {
              const voci = dati.ultimoControllo!.voci || []
              const daVedere = mostraTutte ? voci : voci.filter(v => v.esito !== 'ok')
              if (!daVedere.length) {
                return <p className="text-xs text-theme-text-muted">Tutti i {voci.length} controlli sono a posto.</p>
              }
              return (
                <div className="divide-y divide-theme-border border-t border-theme-border">
                  {daVedere.map((v, i) => (
                    <div key={`${v.area}-${i}`} className="py-2 flex items-start gap-3">
                      <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                        v.esito === 'ko' ? 'bg-red-500' : v.esito === 'attenzione' ? 'bg-amber-500' : 'bg-emerald-500'
                      }`} />
                      <div className="min-w-0">
                        <p className="text-sm text-theme-text-primary">{v.titolo}</p>
                        <p className="text-xs text-theme-text-secondary leading-relaxed">{v.dettaglio}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}
            <button
              onClick={() => setMostraTutte(m => !m)}
              className="text-xs text-[#007aff] hover:underline"
            >
              {mostraTutte ? 'Mostra solo cosa non va' : `Mostra tutti i controlli (${dati.ultimoControllo.voci?.length || 0})`}
            </button>
          </div>
        ) : (
          <Vuoto testo="Nessun controllo ancora registrato. Il giro completo parte ogni ora, oppure lancialo adesso." />
        )}
      </Scheda>

      {/* Servizi */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {(dati?.servizi || []).map(s => (
          <div key={s.chiave} className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
            <div className="flex items-start justify-between gap-3 mb-2">
              <h3 className="text-sm font-semibold text-theme-text-primary">{s.etichetta}</h3>
              <BadgeStato stato={s.stato} />
            </div>
            <p className="text-xs text-theme-text-secondary leading-relaxed">{s.dettaglio}</p>
          </div>
        ))}
      </div>

      {/* Numeri principali */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <button onClick={() => onCambiaVista('problemi')} className="text-left bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4 hover:border-[#007aff]/50 transition-colors">
          <p className="text-[11px] uppercase tracking-wide text-theme-text-muted mb-1">Problemi aperti</p>
          <p className="text-2xl font-light text-theme-text-primary">{p?.aperti ?? 0}</p>
          <p className="text-[11px] text-theme-text-muted mt-1">{p?.ultimaOra ?? 0} nell ultima ora</p>
        </button>
        <button onClick={() => onCambiaVista('operazioni')} className="text-left bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4 hover:border-[#007aff]/50 transition-colors">
          <p className="text-[11px] uppercase tracking-wide text-theme-text-muted mb-1">Operazioni ferme</p>
          <p className="text-2xl font-light text-theme-text-primary">{dati?.operazioni?.totale ?? 0}</p>
          <p className="text-[11px] text-theme-text-muted mt-1">{dati?.operazioni?.abbandonate ?? 0} aspettano te</p>
        </button>
        <button onClick={() => onCambiaVista('integrazioni')} className="text-left bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4 hover:border-[#007aff]/50 transition-colors">
          <p className="text-[11px] uppercase tracking-wide text-theme-text-muted mb-1">Collegamenti</p>
          <p className="text-2xl font-light text-theme-text-primary">{dati?.integrazioni?.conProblemi ?? 0}</p>
          <p className="text-[11px] text-theme-text-muted mt-1">con problemi su {dati?.integrazioni?.totale ?? 0}</p>
        </button>
        <button onClick={() => onCambiaVista('prestazioni')} className="text-left bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4 hover:border-[#007aff]/50 transition-colors">
          <p className="text-[11px] uppercase tracking-wide text-theme-text-muted mb-1">Errori 24h</p>
          <p className="text-2xl font-light text-theme-text-primary">{dati?.prestazioni?.tassoErrore ?? 0}%</p>
          <p className="text-[11px] text-theme-text-muted mt-1">{dati?.prestazioni?.mediaMs ?? 0} ms di media</p>
        </button>
      </div>

      {/* Ripartizione per gravita' */}
      <Scheda titolo="Problemi aperti per gravita">
        <div className="grid grid-cols-2 md:grid-cols-5 divide-y md:divide-y-0 md:divide-x divide-theme-border">
          {severita.map(s => (
            <div key={s} className="px-4 py-3">
              <div className="mb-1"><BadgeSeverita severita={s} /></div>
              <p className="text-xl font-light text-theme-text-primary">{p?.perSeverita?.[s] ?? 0}</p>
            </div>
          ))}
        </div>
      </Scheda>

      {/* I piu' gravi */}
      <Scheda titolo="Da guardare per primi" azione={<Bottone onClick={() => onCambiaVista('problemi')}>Vedi tutti</Bottone>}>
        {p?.piuGravi?.length ? (
          <div className="divide-y divide-theme-border">
            {p.piuGravi.map(g => (
              <button key={g.id} onClick={() => onApriProblema(g.id)} className="w-full text-left px-4 py-3 hover:bg-theme-bg-hover transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-theme-text-primary truncate">{g.titolo}</p>
                    <p className="text-[11px] text-theme-text-muted mt-0.5">
                      {g.occorrenze} volte · ultima {quandoRelativo(g.ultima_comparsa)}
                      {g.integrazione ? ` · ${g.integrazione}` : ''}
                    </p>
                  </div>
                  <BadgeSeverita severita={g.severita} />
                </div>
              </button>
            ))}
          </div>
        ) : <Vuoto testo="Nessun problema aperto. Tutto in ordine." />}
      </Scheda>

      {/* Interruttori attivi, backup, rilascio */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Scheda titolo="Funzioni spente o in manutenzione">
          {(dati?.interruttori?.spente?.length || dati?.interruttori?.manutenzione?.length) ? (
            <div className="px-4 py-3 space-y-2">
              {dati?.interruttori?.spente?.map(f => (
                <p key={`off-${f.chiave}-${f.business}`} className="text-xs text-theme-text-secondary">
                  <span className="text-red-600 dark:text-red-400 font-medium">SPENTA</span> · {f.chiave} ({f.business === '*' ? 'tutte le aziende' : f.business})
                </p>
              ))}
              {dati?.interruttori?.manutenzione?.map(f => (
                <p key={`man-${f.chiave}-${f.business}`} className="text-xs text-theme-text-secondary">
                  <span className="text-amber-600 dark:text-amber-400 font-medium">MANUTENZIONE</span> · {f.chiave} ({f.business === '*' ? 'tutte le aziende' : f.business})
                </p>
              ))}
            </div>
          ) : <Vuoto testo="Tutte le funzioni sono attive." />}
        </Scheda>

        <Scheda titolo="Backup">
          <div className="px-4 py-3">
            {dati?.backup ? (
              <>
                <p className="text-sm text-theme-text-primary">{dataOra(dati.backup.eseguito_at)}</p>
                <p className="text-xs text-theme-text-muted mt-1">{dati.backup.messaggio || dati.backup.esito}</p>
              </>
            ) : <p className="text-sm text-theme-text-muted">Nessuna verifica registrata. Il controllo gira una volta al giorno.</p>}
          </div>
        </Scheda>

        <Scheda titolo="Ultimo rilascio">
          <div className="px-4 py-3">
            {dati?.release ? (
              <>
                <p className="text-sm text-theme-text-primary">{dati.release.versione} · {dataOra(dati.release.rilasciato_at)}</p>
                <p className="text-xs text-theme-text-muted mt-1">{dati.release.note || dati.release.esito}</p>
              </>
            ) : <p className="text-sm text-theme-text-muted">Nessun rilascio registrato.</p>}
          </div>
        </Scheda>
      </div>
    </div>
  )
}
