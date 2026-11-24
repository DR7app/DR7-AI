import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'

/**
 * Centralina Pro > Cargos — 24/11/2026 (video di Valerio).
 *
 * Tutti i veicoli della flotta con un interruttore ciascuno. Spento = i
 * contratti di quel veicolo NON vengono comunicati a CARGOS (invio dopo la
 * firma e recupero ogni 30 minuti: netlify/functions/cargos-auto-send.ts,
 * veicoloEsclusoCargos). Acceso = come prima.
 *
 * Si salva subito, al clic, in centralina_pro_config (riga main) dentro
 * config.cargos.veicoli_esclusi (id dei veicoli), rileggendo la riga prima di
 * scrivere: config.cargos contiene anche gli avvisi impostati dalla tab Cargos
 * e non va toccato altro.
 */

interface Veicolo {
  id: string
  display_name: string | null
  plate: string | null
  category: string | null
  status: string | null
}

export default function CargosVeicoliSection({ readOnly = false }: { readOnly?: boolean }) {
  const [veicoli, setVeicoli] = useState<Veicolo[]>([])
  const [esclusi, setEsclusi] = useState<Set<string>>(new Set())
  const [caricamento, setCaricamento] = useState(true)
  const [inSalvataggio, setInSalvataggio] = useState<string | null>(null)
  const [ricerca, setRicerca] = useState('')

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const [{ data: v, error: ev }, { data: cfg, error: ec }] = await Promise.all([
        supabase.from('vehicles').select('id, display_name, plate, category, status').neq('status', 'retired').order('display_name'),
        supabase.from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle(),
      ])
      if (!vivo) return
      if (ev) toast.error(`Veicoli non letti: ${ev.message}`)
      if (ec) toast.error(`Configurazione non letta: ${ec.message}`)
      setVeicoli((v || []) as Veicolo[])
      const lista = (cfg?.config as { cargos?: { veicoli_esclusi?: unknown } } | null)?.cargos?.veicoli_esclusi
      setEsclusi(new Set(Array.isArray(lista) ? lista.map(String) : []))
      setCaricamento(false)
    })()
    return () => { vivo = false }
  }, [])

  async function cambia(id: string) {
    if (readOnly || inSalvataggio) return
    setInSalvataggio(id)
    try {
      const { data: riga, error: errLettura } = await supabase
        .from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle()
      if (errLettura) throw new Error('impossibile rileggere la configurazione')
      const cfg = (riga?.config || {}) as Record<string, unknown>
      const cargos = (cfg.cargos as Record<string, unknown>) || {}
      const attuali = new Set(Array.isArray(cargos.veicoli_esclusi) ? (cargos.veicoli_esclusi as unknown[]).map(String) : [])
      if (attuali.has(id)) attuali.delete(id)
      else attuali.add(id)
      const { error } = await supabase
        .from('centralina_pro_config')
        .upsert({ id: 'main', config: { ...cfg, cargos: { ...cargos, veicoli_esclusi: [...attuali] } } }, { onConflict: 'id' })
      if (error) throw new Error(error.message)
      setEsclusi(attuali)
      const v = veicoli.find(x => x.id === id)
      toast.success(`${v?.display_name || 'Veicolo'}: CARGOS ${attuali.has(id) ? 'disattivato' : 'attivo'}`)
    } catch (e) {
      toast.error(`Non salvato: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setInSalvataggio(null)
    }
  }

  const filtrati = useMemo(() => {
    const q = ricerca.trim().toLowerCase()
    if (!q) return veicoli
    return veicoli.filter(v => `${v.display_name || ''} ${v.plate || ''}`.toLowerCase().includes(q))
  }, [veicoli, ricerca])

  const quantiSpenti = veicoli.filter(v => esclusi.has(v.id)).length

  return (
    <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-5 space-y-4">
      <div>
        <h3 className="text-base font-semibold text-theme-text-primary">Cargos — veicoli comunicati</h3>
        <p className="text-sm text-theme-text-muted mt-1">
          Veicolo acceso: i suoi contratti firmati vanno a CARGOS come sempre. Veicolo spento: i suoi contratti NON vengono comunicati a CARGOS.
          Si salva subito.
        </p>
        {quantiSpenti > 0 && (
          <p className="text-sm text-amber-500 mt-2">{quantiSpenti} {quantiSpenti === 1 ? 'veicolo spento' : 'veicoli spenti'} per CARGOS.</p>
        )}
      </div>

      <input
        value={ricerca}
        onChange={e => setRicerca(e.target.value)}
        placeholder="Cerca per nome o targa"
        className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary"
      />

      {caricamento ? (
        <p className="text-sm text-theme-text-muted">Caricamento veicoli...</p>
      ) : filtrati.length === 0 ? (
        <p className="text-sm text-theme-text-muted">Nessun veicolo.</p>
      ) : (
        <div className="divide-y divide-theme-border border border-theme-border rounded-lg overflow-hidden">
          {filtrati.map(v => {
            const spento = esclusi.has(v.id)
            return (
              <div key={v.id} className="flex items-center justify-between gap-3 px-3 py-2 bg-theme-bg-primary">
                <div className="min-w-0">
                  <p className={`text-sm font-medium truncate ${spento ? 'text-theme-text-muted line-through' : 'text-theme-text-primary'}`}>{v.display_name || 'Senza nome'}</p>
                  <p className="text-xs font-mono text-theme-text-muted">{v.plate || 'senza targa'}{v.category ? ` · ${v.category}` : ''}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs ${spento ? 'text-theme-text-muted' : 'text-emerald-500'}`}>{spento ? 'Non inviato' : 'Inviato'}</span>
                  <button
                    type="button"
                    disabled={readOnly || inSalvataggio !== null}
                    onClick={() => cambia(v.id)}
                    aria-label={spento ? 'Attiva CARGOS per questo veicolo' : 'Disattiva CARGOS per questo veicolo'}
                    className={`w-10 h-6 rounded-full relative transition-colors disabled:opacity-50 ${spento ? 'bg-theme-bg-tertiary border border-theme-border' : 'bg-emerald-500'}`}
                  >
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${spento ? 'left-0.5' : 'left-[18px]'}`} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
