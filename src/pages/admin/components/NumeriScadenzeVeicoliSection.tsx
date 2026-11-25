import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'

/**
 * Centralina Pro > Automazioni — 25/11/2026.
 *
 * Numeri WhatsApp che ricevono gli avvisi di SCADENZA dei veicoli
 * (assicurazione, bollo, revisione, tagliando, gomme, pastiglie:
 * netlify/functions/vehicle-deadlines-cron.ts). Prima il cron leggeva la
 * vecchia lista notifications.cauzioni_staff_phones, tolta dalle Cauzioni il
 * 23/11: gli avvisi continuavano ad arrivare ai numeri vecchi.
 *
 * Vuoto = si usano gli stessi numeri dell'avviso Cauzioni (Centralina Pro >
 * Cauzioni > Avviso di scadenza). Si salva in centralina_pro_config (riga
 * main), config.scadenze_veicoli.whatsapp, rileggendo la riga prima di scrivere.
 */
export default function NumeriScadenzeVeicoliSection({ readOnly = false }: { readOnly?: boolean }) {
  const [testo, setTesto] = useState('')
  const [salvato, setSalvato] = useState('')
  const [numeriCauzioni, setNumeriCauzioni] = useState('')
  const [caricamento, setCaricamento] = useState(true)
  const [inSalvataggio, setInSalvataggio] = useState(false)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const [{ data, error }, { data: cz }] = await Promise.all([
        supabase.from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle(),
        supabase.from('cauzioni_config').select('avviso_whatsapp').eq('id', 'main').maybeSingle(),
      ])
      if (!vivo) return
      if (error) toast.error(`Configurazione non letta: ${error.message}`)
      const v = String((data?.config as { scadenze_veicoli?: { whatsapp?: unknown } } | null)?.scadenze_veicoli?.whatsapp || '')
      setTesto(v)
      setSalvato(v)
      setNumeriCauzioni(String((cz as { avviso_whatsapp?: string | null } | null)?.avviso_whatsapp || ''))
      setCaricamento(false)
    })()
    return () => { vivo = false }
  }, [])

  async function salva() {
    if (readOnly || inSalvataggio) return
    const numeri = testo.split(/[\n,;]+/).map(x => x.replace(/\D/g, '')).filter(Boolean)
    if (numeri.some(n => n.length < 8)) {
      toast.error('Un numero e\' troppo corto. Scrivili con il prefisso, uno per riga.')
      return
    }
    const pulito = [...new Set(numeri)].join('\n')
    setInSalvataggio(true)
    try {
      const { data: riga, error: errLettura } = await supabase
        .from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle()
      if (errLettura) throw new Error('impossibile rileggere la configurazione')
      const cfg = (riga?.config || {}) as Record<string, unknown>
      const sv = (cfg.scadenze_veicoli as Record<string, unknown>) || {}
      const { error } = await supabase
        .from('centralina_pro_config')
        .upsert({ id: 'main', config: { ...cfg, scadenze_veicoli: { ...sv, whatsapp: pulito } } }, { onConflict: 'id' })
      if (error) throw new Error(error.message)
      setTesto(pulito)
      setSalvato(pulito)
      toast.success(pulito ? 'Numeri scadenze veicoli salvati' : 'Numeri tolti: si usano quelli delle Cauzioni')
    } catch (e) {
      toast.error(`Non salvato: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setInSalvataggio(false)
    }
  }

  return (
    <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-5 space-y-3 mb-4">
      <div>
        <h3 className="text-base font-semibold text-theme-text-primary">Numeri avvisi scadenze veicoli</h3>
        <p className="text-sm text-theme-text-muted mt-1">
          Assicurazione, bollo, revisione, tagliando, gomme e pastiglie in scadenza arrivano su WhatsApp a questi numeri.
          Uno per riga, con il prefisso (es. 39 347 1234567).
        </p>
      </div>
      <textarea
        value={testo}
        onChange={e => setTesto(e.target.value)}
        disabled={readOnly || caricamento}
        rows={3}
        placeholder={caricamento ? 'Caricamento...' : 'es. 393471234567'}
        className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm font-mono text-theme-text-primary disabled:opacity-60"
      />
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {!caricamento && !salvato.trim() ? (
          <p className="text-xs text-amber-500">
            Vuoto: si usano i numeri dell'avviso Cauzioni{numeriCauzioni ? ` (${numeriCauzioni})` : ''}.
          </p>
        ) : <span />}
        <button
          type="button"
          onClick={salva}
          disabled={readOnly || caricamento || inSalvataggio || testo.trim() === salvato.trim()}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
        >
          {inSalvataggio ? 'Salvataggio...' : 'Salva numeri'}
        </button>
      </div>
    </div>
  )
}
