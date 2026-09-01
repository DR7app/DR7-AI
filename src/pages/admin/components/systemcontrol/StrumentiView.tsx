// System Control — SAFE RECOVERY: gli strumenti che il Super Admin puo' usare
// da solo. Nessuna operazione distruttiva compare in questa pagina.
import { useState } from 'react'
import toast from 'react-hot-toast'
import { systemControl } from '../../../../utils/systemControl'
import { Scheda, Bottone, Conferma } from './ui'

const JOB = [
  { chiave: 'cargos_retry',   etichetta: 'Recupero invii CARGOS',        descrizione: 'Ricontrolla i contratti firmati e trasmette quelli mai inviati.' },
  { chiave: 'fornitori_sync', etichetta: 'Sincronizza fatture fornitori', descrizione: 'Riscarica le fatture fornitori dallo SDI.' },
  { chiave: 'fatture_bozza',  etichetta: 'Controllo fatture in bozza',   descrizione: 'Ricontrolla le fatture mai trasmesse e avvisa.' },
  { chiave: 'campagne',       etichetta: 'Motore campagne',              descrizione: 'Fa girare subito un ciclo di invio delle campagne pianificate.' },
  { chiave: 'system_control', etichetta: 'Auto-riparazione',             descrizione: 'Fa girare subito il ciclo che riprende le operazioni ferme.' },
]

export default function StrumentiView() {
  const [inCorso, setInCorso] = useState<string | null>(null)
  const [emailUtente, setEmailUtente] = useState('')
  const [esito, setEsito] = useState<string | null>(null)
  const [confermaJob, setConfermaJob] = useState<typeof JOB[number] | null>(null)

  async function esegui(azione: string, corpo: Record<string, unknown> = {}, etichetta = azione) {
    setInCorso(etichetta)
    setEsito(null)
    try {
      const r = await systemControl.azioneSistema(azione, corpo)
      setEsito(r.messaggio)
      if (r.ok) toast.success(r.messaggio, { duration: 9000 }); else toast.error(r.messaggio, { duration: 10000 })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setInCorso(null)
      setConfermaJob(null)
    }
  }

  return (
    <div className="space-y-4">
      <Scheda titolo="Rilancia un automatismo">
        <div className="divide-y divide-theme-border">
          {JOB.map(j => (
            <div key={j.chiave} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-theme-text-primary">{j.etichetta}</p>
                <p className="text-[11px] text-theme-text-muted mt-0.5">{j.descrizione}</p>
              </div>
              <Bottone disabilitato={inCorso === j.etichetta} onClick={() => setConfermaJob(j)}>
                {inCorso === j.etichetta ? 'In corso...' : 'Riavvia'}
              </Bottone>
            </div>
          ))}
        </div>
        <p className="px-4 py-2 text-[11px] text-theme-text-muted border-t border-theme-border">
          Sono tutti automatismi che si possono rilanciare due volte senza creare doppioni.
        </p>
      </Scheda>

      <Scheda titolo="Svuota le cache">
        <div className="px-4 py-3 flex flex-wrap items-center gap-2">
          <Bottone disabilitato={inCorso === 'cache'} onClick={() => void esegui('svuota_cache', { bersaglio: 'report' }, 'cache')}>
            Report in cache
          </Bottone>
          <Bottone disabilitato={inCorso === 'cache-cdn'} onClick={() => void esegui('svuota_cache', { bersaglio: 'cdn' }, 'cache-cdn')}>
            Cache del sito (CDN)
          </Bottone>
        </div>
        <p className="px-4 pb-3 text-[11px] text-theme-text-muted">
          Le cache si ricostruiscono da sole alla prima richiesta. Nessun dato viene toccato.
          Le visure targa gia pagate non si cancellano mai.
        </p>
      </Scheda>

      <Scheda titolo="Account di un operatore">
        <div className="px-4 py-3 space-y-3">
          <input
            value={emailUtente} onChange={e => setEmailUtente(e.target.value)}
            placeholder="indirizzo e-mail dell operatore"
            className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-1 focus:ring-[#007aff]"
          />
          <div className="flex flex-wrap gap-2">
            <Bottone disabilitato={!emailUtente || inCorso === 'permessi'}
              onClick={() => void esegui('ricalcola_permessi', { emailUtente }, 'permessi')}>
              Ricalcola permessi
            </Bottone>
            <Bottone variante="primario" disabilitato={!emailUtente || inCorso === 'sblocca'}
              onClick={() => void esegui('sblocca_account', { emailUtente }, 'sblocca')}>
              Sblocca account
            </Bottone>
          </div>
          <p className="text-[11px] text-theme-text-muted">
            Lo sblocco libera le richieste OTP rimaste appese e toglie un eventuale blocco di accesso.
            Riattivare un operatore archiviato resta una decisione della direzione e si fa dalla tab Operatori.
          </p>
        </div>
      </Scheda>

      {esito && (
        <Scheda titolo="Risultato">
          <p className="px-4 py-3 text-sm text-theme-text-secondary leading-relaxed">{esito}</p>
        </Scheda>
      )}

      <Scheda titolo="Cosa NON si fa da qui">
        <ul className="px-4 py-3 space-y-1.5 text-xs text-theme-text-muted list-disc list-inside">
          <li>Azzerare il database o cancellare un azienda.</li>
          <li>Eliminare fatture, pagamenti, contratti o prenotazioni.</li>
          <li>Ripristinare un backup di produzione.</li>
          <li>Modificare il codice sorgente.</li>
        </ul>
        <p className="px-4 pb-3 text-[11px] text-theme-text-muted">
          Sono operazioni infrastrutturali ad alto rischio: restano fuori dal pannello di proposito, cosi un errore
          umano non puo distruggere la piattaforma.
        </p>
      </Scheda>

      {confermaJob && (
        <Conferma
          titolo={`Riavvia ${confermaJob.etichetta}`}
          testo={`${confermaJob.descrizione} L automatismo parte adesso invece di aspettare il suo orario.`}
          etichettaConferma="Riavvia"
          onAnnulla={() => setConfermaJob(null)}
          onConferma={motivo => void esegui('riavvia_job', { bersaglio: confermaJob.chiave, motivo }, confermaJob.etichetta)}
        />
      )}
    </div>
  )
}
