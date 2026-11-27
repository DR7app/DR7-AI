import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import ElencoTelefoniConPrefisso from '../../../components/ElencoTelefoniConPrefisso'

/**
 * Centralina Pro > Cauzioni — 25/11/2026 (video di Valerio).
 *
 * Numero WhatsApp che riceve le richieste "No Cauzione" dal sito (riepilogo +
 * codice NC-). Prima il numero si prendeva solo dal destinatario "Valerio" dei
 * ticket e le richieste continuavano ad arrivare al numero vecchio.
 *
 * Si salva al clic su "Salva numero", in centralina_pro_config (riga main)
 * dentro config.no_cauzione.whatsapp, rileggendo la riga prima di scrivere.
 * Il sito lo legge in netlify/functions/richiesta-no-cauzione.js; se vuoto
 * resta il comportamento di prima.
 *
 * 27/11/2026 (video di Valerio): prefisso scelto dalla bandiera e piu' numeri
 * ("+ Aggiungi numero"), come nell'Avviso di scadenza. Il valore resta un
 * testo, ora i numeri E.164 separati da virgola; il sito manda a tutti.
 */

const spezza = (v: string) => v.split(/[,;\n]/).map(s => s.trim()).filter(Boolean)
const normalizza = (v: string) => spezza(v).map(n => n.startsWith('+') ? '+' + n.replace(/\D/g, '') : n.replace(/\D/g, '')).join(', ')

export default function NumeroNoCauzioneSection({ readOnly = false }: { readOnly?: boolean }) {
  const [numero, setNumero] = useState('')
  const [salvato, setSalvato] = useState('')
  const [caricamento, setCaricamento] = useState(true)
  const [inSalvataggio, setInSalvataggio] = useState(false)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const { data, error } = await supabase
        .from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle()
      if (!vivo) return
      if (error) toast.error(`Configurazione non letta: ${error.message}`)
      const n = String((data?.config as { no_cauzione?: { whatsapp?: unknown } } | null)?.no_cauzione?.whatsapp || '')
      setNumero(n)
      setSalvato(n)
      setCaricamento(false)
    })()
    return () => { vivo = false }
  }, [])

  async function salva() {
    if (readOnly || inSalvataggio) return
    const pulito = normalizza(numero)
    if (spezza(pulito).some(n => n.replace(/\D/g, '').length < 8)) {
      toast.error('Un numero e\' troppo corto: controllalo o toglilo.')
      return
    }
    setInSalvataggio(true)
    try {
      const { data: riga, error: errLettura } = await supabase
        .from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle()
      if (errLettura) throw new Error('impossibile rileggere la configurazione')
      const cfg = (riga?.config || {}) as Record<string, unknown>
      const nc = (cfg.no_cauzione as Record<string, unknown>) || {}
      const { error } = await supabase
        .from('centralina_pro_config')
        .upsert({ id: 'main', config: { ...cfg, no_cauzione: { ...nc, whatsapp: pulito } } }, { onConflict: 'id' })
      if (error) throw new Error(error.message)
      setNumero(pulito)
      setSalvato(pulito)
      toast.success(pulito ? (spezza(pulito).length > 1 ? 'Numeri No Cauzione salvati' : 'Numero No Cauzione salvato') : 'Numero tolto: si usa il destinatario Valerio dei ticket')
    } catch (e) {
      toast.error(`Non salvato: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setInSalvataggio(false)
    }
  }

  const modificato = normalizza(numero) !== normalizza(salvato)

  return (
    <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-5 space-y-3 mb-4">
      <div>
        <h3 className="text-base font-semibold text-theme-text-primary">Numero richieste No Cauzione</h3>
        <p className="text-sm text-theme-text-muted mt-1">
          Le richieste "No Cauzione" dal sito (riepilogo e codice NC-) arrivano su WhatsApp a questi numeri.
          Scegli il paese dalla bandiera; con "+ Aggiungi numero" la richiesta arriva a piu' persone.
        </p>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-start gap-2">
        <div className="flex-1 min-w-0">
          {caricamento
            ? <p className="text-sm text-theme-text-muted py-2">Caricamento...</p>
            : <ElencoTelefoniConPrefisso value={numero} onChange={setNumero} disabled={readOnly} />}
        </div>
        <button
          type="button"
          onClick={salva}
          disabled={readOnly || caricamento || inSalvataggio || !modificato}
          className="shrink-0 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
        >
          {inSalvataggio ? 'Salvataggio...' : 'Salva numeri'}
        </button>
      </div>
      {!caricamento && !salvato && (
        <p className="text-xs text-amber-500">Nessun numero impostato: si usa il destinatario "Valerio" dei ticket.</p>
      )}
    </div>
  )
}
