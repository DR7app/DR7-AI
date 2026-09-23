import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'

/**
 * 23/09/2026 (direzione): "Clienti WhatsApp" scritto a mano nella tab Clienti.
 *
 * Il sito (Home e Investitori, "Clienti serviti nell'ecosistema") mostra la
 * somma: Totale Clienti dell'anagrafica, che sale da solo, + questo numero.
 * Il calcolo del sito sta nel database (`sito_numeri_pubblici`), il numero in
 * `sito_contatori` alla chiave `clienti_whatsapp`.
 */
export default function ClientiWhatsappCard({ totaleAnagrafica }: { totaleAnagrafica: number }) {
  const [valore, setValore] = useState<number | null>(null)
  const [bozza, setBozza] = useState('')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    let annullato = false
    supabase
      .from('sito_contatori')
      .select('valore')
      .eq('chiave', 'clienti_whatsapp')
      .maybeSingle()
      .then(({ data, error }) => {
        if (annullato) return
        if (error) { console.error('[ClientiWhatsappCard] lettura fallita:', error); return }
        const v = Number(data?.valore) || 0
        setValore(v)
        setBozza(String(v))
      })
    return () => { annullato = true }
  }, [])

  const numeroBozza = Number(bozza.replace(/\D/g, ''))
  const cambiato = valore !== null && bozza !== '' && numeroBozza !== valore

  async function salva() {
    if (!cambiato || salvando) return
    setSalvando(true)
    try {
      const { data: sessione } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('sito_contatori')
        .upsert({ chiave: 'clienti_whatsapp', valore: numeroBozza, aggiornato_il: new Date().toISOString(), aggiornato_da: sessione.user?.id ?? null })
      if (error) throw error
      setValore(numeroBozza)
      setBozza(String(numeroBozza))
      toast.success('Clienti WhatsApp aggiornati: il sito mostra subito il nuovo totale')
    } catch (e) {
      console.error('[ClientiWhatsappCard] salvataggio fallito:', e)
      toast.error('Salvataggio non riuscito')
    } finally {
      setSalvando(false)
    }
  }

  const cifra = (n: number) => new Intl.NumberFormat('it-IT').format(n)

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div>
        <p className="text-sm text-theme-text-muted mb-1">Clienti WhatsApp</p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="numeric"
            value={bozza}
            disabled={valore === null}
            onChange={(e) => setBozza(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') salva() }}
            className="w-28 px-3 py-1.5 bg-theme-bg-tertiary border border-theme-border-light rounded-lg text-theme-text-primary text-xl lg:text-2xl font-bold tabular-nums"
            aria-label="Clienti WhatsApp"
          />
          {cambiato && (
            <button
              type="button"
              onClick={salva}
              disabled={salvando}
              className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-dr7-gold text-white disabled:opacity-50"
            >
              {salvando ? 'Salvo...' : 'Salva'}
            </button>
          )}
        </div>
      </div>
      <div>
        <p className="text-sm text-theme-text-muted mb-1">Totale sul sito</p>
        <p className="text-2xl lg:text-4xl font-bold text-dr7-gold tabular-nums">
          {valore === null ? '...' : cifra(totaleAnagrafica + valore)}
        </p>
      </div>
    </div>
  )
}
