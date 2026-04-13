import { useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { logAdminAction } from '../../../utils/logAdminAction'

interface Cauzione {
  id: string
  cliente_nome?: string
  cliente_email?: string
  importo: number
  veicolo_modello?: string
  veicolo_targa?: string
  riferimento_contratto_id?: string | null
  metodo: string
  nexi_transaction_id?: string | null
  nexi_order_id?: string | null
  nexi_operation_id?: string
}

interface Props {
  cauzione: Cauzione
  onClose: () => void
  onSuccess: () => void
}

const CAUSALI = [
  'Danno',
  'Penale',
  'Carburante',
  'Franchigia',
  'Multa',
  'Ritardo',
  'Extra',
  'Altro'
]

export default function CassaCauzioneModal({ cauzione, onClose, onSuccess }: Props) {
  const maxAmount = Number(cauzione.importo)
  const [importoDaIncassare, setImportoDaIncassare] = useState(maxAmount.toFixed(2))
  const [causale, setCausale] = useState('')
  const [noteAggiuntive, setNoteAggiuntive] = useState('')
  const [processing, setProcessing] = useState(false)
  const [confirmStep, setConfirmStep] = useState(false)

  const parsedAmount = parseFloat(importoDaIncassare)
  const isValid = !isNaN(parsedAmount) && parsedAmount > 0 && parsedAmount <= maxAmount && causale !== ''
  const residuo = isValid ? maxAmount - parsedAmount : maxAmount
  const isPartial = isValid && parsedAmount < maxAmount
  const isTotal = isValid && parsedAmount === maxAmount

  const handleConfirm = async () => {
    if (!isValid || processing) return

    setProcessing(true)
    const toastId = toast.loading('Incasso in corso...')

    try {
      const amount = parsedAmount
      const hasNexi = !!cauzione.nexi_transaction_id
      const noteText = `${causale}${noteAggiuntive ? ' — ' + noteAggiuntive : ''}`

      if (hasNexi) {
        // --- Nexi preauth: capture the chosen amount ---
        const captureRes = await fetch('/.netlify/functions/nexi-capture-preauth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cauzioneId: cauzione.id,
            operationId: cauzione.nexi_operation_id || cauzione.nexi_transaction_id,
            amount,
            orderId: cauzione.nexi_order_id
          })
        })
        const captureResult = await captureRes.json()

        if (!captureRes.ok) {
          throw new Error(captureResult.error || 'Errore durante l\'incasso Nexi')
        }

        // If partial, void/release the remainder
        if (isPartial && cauzione.nexi_order_id) {
          // Nexi automatically releases remaining preauth after partial capture
          // but we log it explicitly
          console.log(`[CassaCauzioneModal] Partial capture: €${amount.toFixed(2)} captured, €${residuo.toFixed(2)} auto-released by Nexi`)
        }

        // Update cauzione in DB with full details
        const { error: updateError } = await supabase
          .from('cauzioni')
          .update({
            stato: 'Bloccata',
            data_incasso: new Date().toISOString(),
            importo_incassato: amount,
            importo_rilasciato: residuo,
            causale_incasso: noteText,
            note: `${isPartial ? 'Incasso parziale' : 'Incasso totale'}: €${amount.toFixed(2)} incassati${isPartial ? ` — €${residuo.toFixed(2)} rilasciati` : ''} — ${noteText} — Nexi Op: ${captureResult.operationId || 'N/A'}`,
            updated_at: new Date().toISOString()
          })
          .eq('id', cauzione.id)

        if (updateError) throw updateError
      } else {
        // --- Manual (no Nexi): just update DB ---
        const { error: updateError } = await supabase
          .from('cauzioni')
          .update({
            stato: 'Bloccata',
            data_incasso: new Date().toISOString(),
            importo_incassato: amount,
            importo_rilasciato: residuo,
            causale_incasso: noteText,
            note: `${isPartial ? 'Incasso parziale' : 'Incasso totale'}: €${amount.toFixed(2)} incassati${isPartial ? ` — €${residuo.toFixed(2)} rilasciati` : ''} — ${noteText}`,
            updated_at: new Date().toISOString()
          })
          .eq('id', cauzione.id)

        if (updateError) throw updateError
      }

      // Log admin action
      logAdminAction('cassa_cauzione', 'cauzione', cauzione.id, {
        importo_originale: maxAmount,
        importo_incassato: amount,
        importo_rilasciato: residuo,
        causale: noteText,
        tipo: isTotal ? 'totale' : 'parziale',
        metodo: hasNexi ? 'nexi' : 'manuale'
      })

      toast.success(
        isPartial
          ? `Incassati €${amount.toFixed(2)} — €${residuo.toFixed(2)} rilasciati al cliente`
          : `Incassati €${amount.toFixed(2)} — Cauzione incassata totalmente`,
        { id: toastId, duration: 5000 }
      )

      onSuccess()
    } catch (error: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const errMsg = error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error)
      console.error('Error in cassa cauzione:', error)
      toast.error(`Errore: ${errMsg}`, { id: toastId })
      setProcessing(false)
      setConfirmStep(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={processing ? undefined : onClose} />
      <div className="relative bg-theme-bg-primary border border-theme-border rounded-3xl w-full max-w-lg mx-4 overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="bg-red-600 px-6 py-4 flex justify-between items-center">
          <h3 className="text-xl font-bold text-white">Incasso Cauzione</h3>
          {!processing && (
            <button onClick={onClose} className="text-white/80 hover:text-white">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <div className="p-6 space-y-5">
          {/* Client info */}
          <div className="bg-theme-bg-tertiary border border-theme-border rounded-2xl p-4 space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-theme-text-secondary">Cliente</span>
              <span className="text-sm font-semibold text-theme-text-primary">{cauzione.cliente_nome || 'N/A'}</span>
            </div>
            {cauzione.riferimento_contratto_id && (
              <div className="flex justify-between">
                <span className="text-sm text-theme-text-secondary">Pratica</span>
                <span className="text-sm text-theme-text-primary font-mono">#{cauzione.riferimento_contratto_id.substring(0, 8).toUpperCase()}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-sm text-theme-text-secondary">Veicolo</span>
              <span className="text-sm text-theme-text-primary">{cauzione.veicolo_modello} — {cauzione.veicolo_targa}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-theme-text-secondary">Metodo</span>
              <span className="text-sm text-theme-text-primary capitalize">{cauzione.metodo}</span>
            </div>
            <div className="flex justify-between items-center pt-1 border-t border-theme-border">
              <span className="text-sm font-semibold text-theme-text-secondary">Cauzione disponibile</span>
              <span className="text-xl font-bold text-theme-text-primary">€{maxAmount.toFixed(2)}</span>
            </div>
          </div>

          {/* Amount input */}
          <div>
            <label className="block text-sm font-semibold text-theme-text-primary mb-2">
              Quanto vuoi incassare?
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-semibold text-theme-text-secondary">€</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max={maxAmount}
                value={importoDaIncassare}
                onChange={(e) => setImportoDaIncassare(e.target.value)}
                disabled={processing}
                className="w-full pl-10 pr-4 py-3 bg-theme-bg-primary border border-theme-border rounded-xl text-xl font-bold text-theme-text-primary focus:outline-none focus:border-red-500 transition-colors disabled:opacity-50"
                placeholder="0.00"
              />
            </div>
            {parsedAmount > maxAmount && (
              <p className="text-red-500 text-xs mt-1">L'importo non può superare la cauzione disponibile (€{maxAmount.toFixed(2)})</p>
            )}
            {!isNaN(parsedAmount) && parsedAmount <= 0 && (
              <p className="text-red-500 text-xs mt-1">L'importo deve essere maggiore di zero</p>
            )}
          </div>

          {/* Live calculation */}
          {isValid && (
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-center">
                <div className="text-xs text-red-400 mb-1">Da incassare</div>
                <div className="text-lg font-bold text-red-500">€{parsedAmount.toFixed(2)}</div>
              </div>
              <div className={`${residuo > 0 ? 'bg-green-500/10 border-green-500/30' : 'bg-theme-bg-tertiary border-theme-border'} border rounded-xl p-3 text-center`}>
                <div className={`text-xs ${residuo > 0 ? 'text-green-400' : 'text-theme-text-secondary'} mb-1`}>Da rilasciare</div>
                <div className={`text-lg font-bold ${residuo > 0 ? 'text-green-500' : 'text-theme-text-secondary'}`}>€{residuo.toFixed(2)}</div>
              </div>
            </div>
          )}

          {/* Causale */}
          <div>
            <label className="block text-sm font-semibold text-theme-text-primary mb-2">
              Causale incasso <span className="text-red-500">*</span>
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {CAUSALI.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCausale(c)}
                  disabled={processing}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    causale === c
                      ? 'bg-red-600 text-white'
                      : 'bg-theme-bg-tertiary text-theme-text-secondary border border-theme-border hover:border-red-500/50'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-semibold text-theme-text-primary mb-2">
              Note aggiuntive <span className="text-theme-text-secondary text-xs">(facoltativo)</span>
            </label>
            <textarea
              value={noteAggiuntive}
              onChange={(e) => setNoteAggiuntive(e.target.value)}
              disabled={processing}
              rows={2}
              className="w-full px-4 py-2 bg-theme-bg-primary border border-theme-border rounded-xl text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:border-red-500 transition-colors resize-none disabled:opacity-50"
              placeholder="Dettagli aggiuntivi..."
            />
          </div>

          {/* Confirmation step */}
          {!confirmStep ? (
            <button
              onClick={() => setConfirmStep(true)}
              disabled={!isValid || processing}
              className="w-full py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Procedi con l'incasso
            </button>
          ) : (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 space-y-3">
              <p className="text-sm font-semibold text-red-500 text-center">
                Confermi l'incasso di €{parsedAmount.toFixed(2)}{isPartial ? ` e il rilascio di €${residuo.toFixed(2)}` : ''}?
              </p>
              <p className="text-xs text-theme-text-secondary text-center">
                Causale: {causale}{noteAggiuntive ? ` — ${noteAggiuntive}` : ''}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmStep(false)}
                  disabled={processing}
                  className="flex-1 py-2.5 bg-theme-bg-tertiary text-theme-text-primary font-semibold rounded-xl hover:bg-theme-bg-hover transition-colors border border-theme-border disabled:opacity-50"
                >
                  Annulla
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={processing}
                  className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  {processing ? 'Elaborazione...' : 'Conferma incasso'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
