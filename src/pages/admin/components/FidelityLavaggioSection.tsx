import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { ScheletroTesto } from '../../../components/Scheletro'
import MoneyInput from '../../../components/MoneyInput'
import { parseMoney } from '../../../utils/money'
import {
  FIDELITY_LAVAGGIO_KEY, FIDELITY_LAVAGGIO_DEFAULT, normalizzaFidelityLavaggio, euroFidelity,
  type FidelityLavaggioConfig, type TipoPremioFidelity,
} from '../../../utils/fidelityLavaggio'

/**
 * Centralina Pro > Fidelity Lavaggio (06/11/2026).
 *
 * Regole della Fidelity Card lavaggio: quanti EUR fanno un punto, a quanti
 * punti scatta il premio, quanto vale, quanto dura e in che forma arriva.
 * Salva in `centralina_pro_config.config.fidelity_lavaggio` (riga 'main',
 * globale). Il calcolo lo fa SOLO il database: al salvataggio il trigger
 * trg_dr7_fidelity_lavaggio_config porta le regole nuove in
 * `fidelity_lavaggio_config` e ancora ogni cliente ai punti che vede
 * (migrazione 20261106_fidelity_lavaggio_da_centralina.sql). Nessun premio
 * arretrato: abbassare la soglia o cambiare il valore del punto non regala
 * premi a chi era a meta' carta.
 */

type Campi = {
  attivo: boolean
  euro_per_punto: string
  soglia_punti: string
  importo_premio: string
  validita_giorni: string
  tipo_premio: TipoPremioFidelity
}

function campiDa(c: FidelityLavaggioConfig): Campi {
  return {
    attivo: c.attivo,
    euro_per_punto: String(c.euro_per_punto),
    soglia_punti: String(c.soglia_punti),
    importo_premio: String(c.importo_premio),
    validita_giorni: String(c.validita_giorni),
    tipo_premio: c.tipo_premio,
  }
}

/** Stato della regola nel database: quella che sta davvero girando. */
type InVigore =
  | { stato: 'ok'; config: FidelityLavaggioConfig }
  | { stato: 'manca_migrazione' }
  | { stato: 'sconosciuto' }

const stessaRegola = (a: FidelityLavaggioConfig, b: FidelityLavaggioConfig) =>
  a.attivo === b.attivo && a.euro_per_punto === b.euro_per_punto && a.soglia_punti === b.soglia_punti
  && a.importo_premio === b.importo_premio && a.validita_giorni === b.validita_giorni && a.tipo_premio === b.tipo_premio

function testoRegola(c: FidelityLavaggioConfig): string {
  const premio = c.tipo_premio === 'credito_wallet' ? 'credito wallet lavaggio' : 'codice sconto'
  return `${euroFidelity(c.euro_per_punto)} € = 1 punto · ${c.soglia_punti} punti = €${euroFidelity(c.importo_premio)} (${premio}) · valido ${c.validita_giorni} giorni`
}

export default function FidelityLavaggioSection({ readOnly = false }: { readOnly?: boolean }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [salvata, setSalvata] = useState<FidelityLavaggioConfig>(FIDELITY_LAVAGGIO_DEFAULT)
  const [campi, setCampi] = useState<Campi>(campiDa(FIDELITY_LAVAGGIO_DEFAULT))
  const [inVigore, setInVigore] = useState<InVigore>({ stato: 'sconosciuto' })

  useEffect(() => { void load() }, [])

  async function leggiInVigore() {
    const { data, error } = await supabase.from('fidelity_lavaggio_config').select('config').eq('id', 'attiva').maybeSingle()
    if (error) {
      // Tabella assente = migrazione 20261106 non ancora eseguita.
      setInVigore(/fidelity_lavaggio_config|does not exist|schema cache/i.test(error.message || '') ? { stato: 'manca_migrazione' } : { stato: 'sconosciuto' })
      return
    }
    setInVigore({ stato: 'ok', config: normalizzaFidelityLavaggio(data?.config ?? {}) })
  }

  async function load() {
    setLoading(true)
    try {
      const { data, error } = await supabase.from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle()
      if (error) throw error
      const cfg = (data?.config as Record<string, unknown>) || {}
      const c = normalizzaFidelityLavaggio(cfg[FIDELITY_LAVAGGIO_KEY])
      setSalvata(c)
      setCampi(campiDa(c))
    } catch (e) {
      toast.error('Errore nel caricamento: ' + (e instanceof Error ? e.message : 'riprova'))
    } finally {
      setLoading(false)
    }
    await leggiInVigore()
  }

  /** Valida i campi; null = errore gia' mostrato. */
  function valida(): FidelityLavaggioConfig | null {
    const epp = parseMoney(campi.euro_per_punto)
    if (!Number.isFinite(epp) || epp <= 0) { toast.error('Euro per punto: inserisci un importo maggiore di 0'); return null }
    if (Math.round(epp * 100) / 100 <= 0) { toast.error('Euro per punto: almeno 0,01 €'); return null }
    const soglia = Number(campi.soglia_punti.trim())
    if (!Number.isInteger(soglia) || soglia < 1) { toast.error('Soglia punti: inserisci un numero intero maggiore di 0'); return null }
    const importo = parseMoney(campi.importo_premio)
    if (!Number.isFinite(importo) || importo <= 0) { toast.error('Importo premio: inserisci un importo maggiore di 0'); return null }
    const giorni = Number(campi.validita_giorni.trim())
    if (!Number.isInteger(giorni) || giorni < 1) { toast.error('Validita: inserisci un numero intero di giorni maggiore di 0'); return null }
    if (giorni > 3650) { toast.error('Validita: massimo 3650 giorni'); return null }
    if (soglia > 1000000) { toast.error('Soglia punti: massimo 1.000.000'); return null }
    if (epp > 100000 || importo > 100000) { toast.error('Importo troppo alto (massimo 100.000 €)'); return null }
    return normalizzaFidelityLavaggio({
      attivo: campi.attivo, euro_per_punto: epp, soglia_punti: soglia, importo_premio: importo,
      validita_giorni: giorni, tipo_premio: campi.tipo_premio,
    })
  }

  async function save() {
    const nuova = valida()
    if (!nuova) return
    if (stessaRegola(nuova, salvata)) { toast('Nessuna modifica da salvare'); return }
    const cambianoPunti = nuova.attivo !== salvata.attivo || nuova.euro_per_punto !== salvata.euro_per_punto
      || nuova.soglia_punti !== salvata.soglia_punti
    if (cambianoPunti && !window.confirm(
      'Le nuove regole valgono da adesso in avanti.\n\n'
      + 'Ogni cliente tiene i punti che vede oggi (al massimo la nuova soglia meno 1) e nessun premio arretrato viene emesso. '
      + (nuova.attivo ? '' : 'Con il programma disattivato le carte restano ferme e i lavaggi pagati non danno punti. ')
      + 'I premi gia emessi non cambiano.\n\nConfermi?',
    )) return

    setSaving(true)
    try {
      // Rilettura FRESCA prima di scrivere: la config e' un JSONB condiviso
      // (CMS del sito, interruttori, corsie...). Se la lettura fallisce NON si
      // scrive nulla: l'08/10 una lettura a vuoto ha cancellato site_copy.
      const { data: fresh, error: erroreLettura } = await supabase
        .from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle()
      if (erroreLettura) {
        toast.error('Salvataggio annullato: impossibile rileggere la configurazione. Riprova.')
        return
      }
      if (!fresh) {
        toast.error('Riga di configurazione non trovata (centralina_pro_config id=main).')
        return
      }
      const base = (fresh.config as Record<string, unknown>) || {}
      const { data, error } = await supabase
        .from('centralina_pro_config')
        .update({ config: { ...base, [FIDELITY_LAVAGGIO_KEY]: nuova } })
        .eq('id', 'main')
        .select('id')
      if (error) throw error
      if (!data || data.length === 0) {
        toast.error('Salvataggio non riuscito: nessuna riga aggiornata (permessi?).')
        return
      }
      setSalvata(nuova)
      setCampi(campiDa(nuova))
      toast.success('Regole Fidelity Lavaggio salvate')
      await leggiInVigore()
    } catch (e) {
      toast.error('Errore: ' + (e instanceof Error ? e.message : 'riprova'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <ScheletroTesto righe={4} className="py-4" />

  const inputCls = 'w-full px-2.5 h-9 rounded-lg border border-theme-border bg-theme-bg-primary text-sm text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-dr7-gold disabled:opacity-60'
  const labelCls = 'block text-[11px] font-semibold uppercase tracking-wider text-theme-text-muted mb-1'
  const avviso = 'rounded-lg border px-3 py-2 text-xs border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-theme-text-primary">Fidelity Card lavaggio</h3>
          <p className="text-xs text-theme-text-muted mt-0.5">
            I clienti accumulano punti con i lavaggi pagati (sito e negozio). Raggiunta la soglia ricevono un premio
            valido solo sul lavaggio. Il calcolo lo fa il database: qui si decidono le regole.
          </p>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="shrink-0 px-3 h-9 rounded-lg bg-dr7-gold text-white text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? 'Salvataggio...' : 'Salva'}
          </button>
        )}
      </div>

      {inVigore.stato === 'manca_migrazione' && (
        <div className={avviso}>
          Il database non legge ancora queste regole (migrazione 20261106_fidelity_lavaggio_da_centralina.sql da eseguire).
          Fino ad allora valgono quelle di sempre: {testoRegola(FIDELITY_LAVAGGIO_DEFAULT)}. Quando la migrazione verra
          eseguita, le regole salvate qui entreranno in vigore senza premi arretrati.
        </div>
      )}
      {inVigore.stato === 'ok' && !stessaRegola(inVigore.config, salvata) && (
        <div className={avviso}>
          Le regole salvate non sono ancora attive nel database, che applica: {testoRegola(inVigore.config)}.
          Riprova a salvare; se il messaggio resta, avvisa lo sviluppatore.
        </div>
      )}

      <div className="rounded-xl border border-theme-border bg-theme-bg-secondary p-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-theme-text-primary">Programma {campi.attivo ? 'attivo' : 'disattivato'}</p>
            <p className="text-xs text-theme-text-muted">
              {campi.attivo
                ? 'Le carte si aggiornano a ogni lavaggio pagato.'
                : 'Nessun premio nuovo, carte ferme e nascoste su sito e scheda cliente. I premi gia emessi restano validi.'}
            </p>
          </div>
          <button
            type="button"
            disabled={readOnly}
            onClick={() => setCampi(c => ({ ...c, attivo: !c.attivo }))}
            aria-label={campi.attivo ? 'Disattiva programma' : 'Attiva programma'}
            className={`shrink-0 w-11 h-6 rounded-full transition-colors relative disabled:opacity-60 ${campi.attivo ? 'bg-emerald-500' : 'bg-theme-bg-tertiary border border-theme-border'}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${campi.attivo ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Euro per 1 punto</label>
            <MoneyInput
              disabled={readOnly}
              value={campi.euro_per_punto}
              onChange={v => setCampi(c => ({ ...c, euro_per_punto: v }))}
              min={0.01}
              className={inputCls}
            />
            <p className="text-[11px] text-theme-text-muted mt-1">EUR di lavaggio pagato che fanno 1 punto (es. 1 o 2,50).</p>
          </div>
          <div>
            <label className={labelCls}>Soglia punti</label>
            <input
              type="number"
              step={1}
              min={1}
              disabled={readOnly}
              value={campi.soglia_punti}
              onChange={e => setCampi(c => ({ ...c, soglia_punti: e.target.value }))}
              className={inputCls}
            />
            <p className="text-[11px] text-theme-text-muted mt-1">Punti per ricevere un premio. Il surplus resta sulla carta.</p>
          </div>
          <div>
            <label className={labelCls}>Importo premio (€)</label>
            <MoneyInput
              disabled={readOnly}
              value={campi.importo_premio}
              onChange={v => setCampi(c => ({ ...c, importo_premio: v }))}
              min={0.01}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Validita premio (giorni)</label>
            <input
              type="number"
              step={1}
              min={1}
              disabled={readOnly}
              value={campi.validita_giorni}
              onChange={e => setCampi(c => ({ ...c, validita_giorni: e.target.value }))}
              className={inputCls}
            />
          </div>
        </div>

        <div>
          <label className={labelCls}>Tipo di premio</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {([
              ['credito_wallet', 'Credito wallet lavaggio', 'Chi ha un account sul sito lo riceve nel Credit Wallet, valido solo sul lavaggio. Chi non ha un account riceve comunque un codice sconto.'],
              ['codice_sconto', 'Codice sconto', 'Tutti ricevono un codice sconto monouso valido solo sul lavaggio.'],
            ] as [TipoPremioFidelity, string, string][]).map(([k, titolo, spiega]) => (
              <button
                key={k}
                type="button"
                disabled={readOnly}
                onClick={() => setCampi(c => ({ ...c, tipo_premio: k }))}
                className={`text-left rounded-lg border p-3 transition-colors disabled:opacity-60 ${campi.tipo_premio === k ? 'border-dr7-gold bg-theme-bg-tertiary' : 'border-theme-border hover:bg-theme-bg-hover'}`}
              >
                <p className="text-sm font-semibold text-theme-text-primary">{titolo}</p>
                <p className="text-[11px] text-theme-text-muted mt-0.5">{spiega}</p>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-theme-border bg-theme-bg-tertiary p-3 text-xs text-theme-text-secondary space-y-1">
        <p><span className="font-semibold text-theme-text-primary">Regola salvata:</span> {salvata.attivo ? testoRegola(salvata) : 'programma disattivato'}</p>
        <p>
          Cambiare euro per punto, soglia o attivazione vale da quel momento in avanti: ogni cliente tiene i punti che vede
          (al massimo la nuova soglia meno 1, cosi il premio arriva al primo lavaggio pagato) e nessun premio arretrato viene emesso.
          Importo, validita e tipo di premio valgono per i premi emessi dopo il salvataggio.
        </p>
      </div>
    </div>
  )
}
