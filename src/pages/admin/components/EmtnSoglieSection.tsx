import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { ScheletroTesto } from '../../../components/Scheletro'
import {
  EMTN_SOGLIE_KEY, MESSAGGIO_BLOCCO_DEFAULT, SOGLIE_EMTN_SPENTE, normalizzaSoglieEmtn, sogliaEmtnValida,
  type SoglieEmtn,
} from '../../../utils/emtnSoglie'

/**
 * Centralina Pro > EMTN (07/11/2026).
 *
 * Due soglie sull'EMTN Score del cliente (lo stesso numero della tab EMTN e
 * del badge nella lista prenotazioni):
 *  - soglia allarme: un noleggio di un cliente sotto la soglia apre l'allarme
 *    "Cliente sotto la soglia EMTN" (Centralina Pro > Allarmi);
 *  - soglia blocco: sotto la soglia il cliente puo' registrarsi e caricare i
 *    documenti, ma non completare un noleggio dal sito. Lo ferma il database
 *    (trigger trg_01_emtn_blocco, migrazione 20261107_emtn_soglie.sql).
 * Vuote = spente (default): nulla cambia finche' non si impostano.
 *
 * Salva in `centralina_pro_config.config.emtn` (riga 'main', globale), con la
 * stessa scrittura della Fidelity Lavaggio: rilettura fresca, si scrive solo
 * la chiave `emtn`, e se la rilettura fallisce non si scrive nulla. La
 * sezione non e' in nessuna sync useEffect della Centralina: nessuno la
 * riscrive al montaggio.
 */

type Campi = { soglia_allarme: string; soglia_blocco: string; messaggio_blocco: string }

const campiDa = (s: SoglieEmtn): Campi => ({
  soglia_allarme: s.soglia_allarme != null ? String(s.soglia_allarme) : '',
  soglia_blocco: s.soglia_blocco != null ? String(s.soglia_blocco) : '',
  messaggio_blocco: s.messaggio_blocco || '',
})

const stesseSoglie = (a: SoglieEmtn, b: SoglieEmtn) =>
  a.soglia_allarme === b.soglia_allarme && a.soglia_blocco === b.soglia_blocco && (a.messaggio_blocco || '') === (b.messaggio_blocco || '')

/** Clienti (per codice fiscale) sotto ogni soglia, dai punteggi salvati. */
type Conteggio =
  | { stato: 'ok'; allarme: number | null; blocco: number | null; troncato: boolean }
  | { stato: 'manca_migrazione' }
  | { stato: 'sconosciuto' }

export default function EmtnSoglieSection({ readOnly = false }: { readOnly?: boolean }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [salvate, setSalvate] = useState<SoglieEmtn>(SOGLIE_EMTN_SPENTE)
  const [campi, setCampi] = useState<Campi>(campiDa(SOGLIE_EMTN_SPENTE))
  const [conteggio, setConteggio] = useState<Conteggio>({ stato: 'sconosciuto' })

  useEffect(() => { void load() }, [])

  async function contaSotto(s: SoglieEmtn) {
    const max = Math.max(s.soglia_allarme ?? 0, s.soglia_blocco ?? 0)
    const { data, error } = await supabase
      .from('emtn_score_clienti')
      .select('codice_fiscale, score')
      .lt('score', Math.max(max, 1))
      .range(0, 999)
    if (error) {
      setConteggio(/emtn_score_clienti|does not exist|schema cache/i.test(error.message || '') ? { stato: 'manca_migrazione' } : { stato: 'sconosciuto' })
      return
    }
    const righe = (data || []) as Array<{ codice_fiscale: string; score: number }>
    const conta = (soglia: number | null) => soglia == null ? null : new Set(righe.filter(r => r.score < soglia).map(r => r.codice_fiscale)).size
    setConteggio({ stato: 'ok', allarme: conta(s.soglia_allarme), blocco: conta(s.soglia_blocco), troncato: righe.length >= 1000 })
  }

  async function load() {
    setLoading(true)
    let lette = SOGLIE_EMTN_SPENTE
    try {
      const { data, error } = await supabase.from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle()
      if (error) throw error
      lette = normalizzaSoglieEmtn(((data?.config as Record<string, unknown>) || {})[EMTN_SOGLIE_KEY])
      setSalvate(lette)
      setCampi(campiDa(lette))
    } catch (e) {
      toast.error('Errore nel caricamento: ' + (e instanceof Error ? e.message : 'riprova'))
    } finally {
      setLoading(false)
    }
    await contaSotto(lette)
  }

  /** Valida i campi; null = errore gia' mostrato. Campo vuoto = soglia spenta. */
  function valida(): SoglieEmtn | null {
    const leggi = (t: string, nome: string): number | null | undefined => {
      const v = t.trim()
      if (!v) return null
      const n = sogliaEmtnValida(v)
      if (n == null) { toast.error(`${nome}: inserisci un numero intero da 1 a 100, oppure lascia vuoto per spegnerla`); return undefined }
      return n
    }
    const allarme = leggi(campi.soglia_allarme, 'Soglia allarme')
    if (allarme === undefined) return null
    const blocco = leggi(campi.soglia_blocco, 'Soglia blocco')
    if (blocco === undefined) return null
    const msg = campi.messaggio_blocco.trim()
    if (msg.length > 500) { toast.error('Messaggio al cliente: massimo 500 caratteri'); return null }
    return { soglia_allarme: allarme, soglia_blocco: blocco, messaggio_blocco: msg || null }
  }

  async function save() {
    const nuove = valida()
    if (!nuove) return
    if (stesseSoglie(nuove, salvate)) { toast('Nessuna modifica da salvare'); return }
    if (nuove.soglia_blocco != null && nuove.soglia_blocco !== salvate.soglia_blocco && !window.confirm(
      `Da adesso i clienti con EMTN Score sotto ${nuove.soglia_blocco}% non potranno prenotare un noleggio dal sito `
      + '(potranno comunque registrarsi e caricare i documenti). Le prenotazioni gia fatte non cambiano.\n\nConfermi?',
    )) return

    setSaving(true)
    try {
      // Rilettura FRESCA prima di scrivere: la config e' un JSONB condiviso.
      // Se la lettura fallisce NON si scrive nulla (08/10: site_copy cancellato).
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
        .update({ config: { ...base, [EMTN_SOGLIE_KEY]: nuove } })
        .eq('id', 'main')
        .select('id')
      if (error) throw error
      if (!data || data.length === 0) {
        toast.error('Salvataggio non riuscito: nessuna riga aggiornata (permessi?).')
        return
      }
      setSalvate(nuove)
      setCampi(campiDa(nuove))
      toast.success('Soglie EMTN salvate')
      await contaSotto(nuove)
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
  const allarmeN = sogliaEmtnValida(campi.soglia_allarme)
  const bloccoN = sogliaEmtnValida(campi.soglia_blocco)
  const clienti = (n: number | null) => n == null ? '' : n === 1 ? ' · 1 cliente oggi' : ` · ${n} clienti oggi`

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-theme-text-primary">EMTN</h3>
          <p className="text-xs text-theme-text-muted mt-0.5">
            Soglie sull'EMTN Score del cliente, lo stesso numero della tab EMTN e del badge nella lista prenotazioni.
            Lasciale vuote per spegnerle.
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

      {conteggio.stato === 'manca_migrazione' && (
        <div className={avviso}>
          Il database non conserva ancora i punteggi EMTN (migrazione 20261107_emtn_soglie.sql da eseguire).
          Fino ad allora le soglie si possono salvare ma non hanno effetto: nessun allarme e nessun blocco.
        </div>
      )}

      <div className="rounded-xl border border-theme-border bg-theme-bg-secondary p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Soglia allarme (%)</label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="Spenta"
              disabled={readOnly}
              value={campi.soglia_allarme}
              onChange={e => setCampi(c => ({ ...c, soglia_allarme: e.target.value }))}
              className={inputCls}
            />
            <p className="text-[11px] text-theme-text-muted mt-1">
              Sotto questo punteggio, un noleggio del cliente apre l'allarme "Cliente sotto la soglia EMTN".
            </p>
          </div>
          <div>
            <label className={labelCls}>Soglia blocco (%)</label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="Spenta"
              disabled={readOnly}
              value={campi.soglia_blocco}
              onChange={e => setCampi(c => ({ ...c, soglia_blocco: e.target.value }))}
              className={inputCls}
            />
            <p className="text-[11px] text-theme-text-muted mt-1">
              Sotto questo punteggio il cliente non puo prenotare un noleggio dal sito. Registrazione e documenti restano possibili.
            </p>
          </div>
        </div>

        {allarmeN != null && bloccoN != null && bloccoN > allarmeN && (
          <div className={avviso}>
            La soglia di blocco e piu alta di quella di allarme: chi e bloccato non arriva mai a far suonare l'allarme dal sito.
          </div>
        )}

        <div>
          <label className={labelCls}>Messaggio al cliente bloccato</label>
          <textarea
            rows={2}
            disabled={readOnly}
            placeholder={MESSAGGIO_BLOCCO_DEFAULT}
            value={campi.messaggio_blocco}
            onChange={e => setCampi(c => ({ ...c, messaggio_blocco: e.target.value }))}
            className={`${inputCls} h-auto py-2`}
          />
          <p className="text-[11px] text-theme-text-muted mt-1">Vuoto = testo predefinito. Non mostra mai il punteggio al cliente.</p>
        </div>
      </div>

      <div className="rounded-xl border border-theme-border bg-theme-bg-tertiary p-3 text-xs text-theme-text-secondary space-y-1">
        <p>
          <span className="font-semibold text-theme-text-primary">Allarme:</span>{' '}
          {salvate.soglia_allarme != null ? `sotto ${salvate.soglia_allarme}%` : 'spento'}
          {conteggio.stato === 'ok' ? clienti(conteggio.allarme) : ''}
        </p>
        <p>
          <span className="font-semibold text-theme-text-primary">Blocco prenotazioni dal sito:</span>{' '}
          {salvate.soglia_blocco != null ? `sotto ${salvate.soglia_blocco}%` : 'spento'}
          {conteggio.stato === 'ok' ? clienti(conteggio.blocco) : ''}
          {conteggio.stato === 'ok' && conteggio.troncato ? ' (conteggio parziale)' : ''}
        </p>
        <p>
          I punteggi si aggiornano da soli ogni 10 minuti per chi ha un noleggio in corso o futuro, e ogni settimana per
          tutti gli altri clienti con codice fiscale. Un cliente senza punteggio (nuovo, straniero senza codice fiscale)
          non viene mai bloccato.
        </p>
      </div>
    </div>
  )
}
