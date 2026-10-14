import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { authFetch } from '../../../utils/authFetch'
import { logAdminAction } from '../../../utils/logAdminAction'
import { useLimitationOverride } from '../../../hooks/useLimitationOverride'
import LimitationOverrideModal from '../../../components/LimitationOverrideModal'
import MoneyInput from '../../../components/MoneyInput'
import { nettoVoce, giaFatturato, daFatturare } from '../../../utils/fatturazioneVoci'

/**
 * 14/10/2026 — "Genera fattura" / "Genera fattura parziale" dal cliente in
 * Amministrazione > In attesa di pagamento.
 *
 * Si fattura anche se il cliente NON ha pagato (es. fattura da mandare
 * all'avvocato per penali e danni) e anche solo una parte. La finestra sa gia'
 * cosa e' stato fatturato:
 *  - penali/danni: `importoFatturato` sulla voce (utils/fatturazioneVoci.ts);
 *  - noleggio/lavaggio: somma delle fatture della prenotazione (principale,
 *    estensioni, parziali), come generate-invoice-from-booking.
 * Propone solo il resto. Al pagamento i flussi di saldo fatturano solo quel
 * che manca, e il trigger trg_fatture_pagate_dal_booking segna "pagata" le
 * fatture emesse qui.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Prenotazione = any

interface VoceDaSaldare {
  bookingId: string
  booking: Prenotazione
  label: string
  source: 'booking_details' | 'fattura'
  type: 'penalties' | 'danni'
  originalIndex: number
}

export interface GruppoFatturabile {
  customerName: string
  noleggioBookings: Prenotazione[]
  primeWashBookings: Prenotazione[]
  penaliItems: VoceDaSaldare[]
  danniItems: VoceDaSaldare[]
}

interface Riga {
  chiave: string
  tipo: 'prenotazione' | 'penalties' | 'danni'
  etichetta: string
  bookingId: string
  booking: Prenotazione
  index: number
  totale: number
  fatturato: number
  residuo: number
  /** prenotazione: nessuna fattura ancora emessa -> fattura principale intera */
  maiFatturata: boolean
  pagata: boolean
}

const euro = (n: number) => `€ ${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const arrotonda = (n: number) => Math.round(n * 100) / 100
const PAGATO = ['paid', 'completed', 'succeeded']
const NON_SERVIZIO = ['penale', 'danno', 'penali', 'danni', 'nota_di_credito', 'nota_credito', 'td04']

export default function GeneraFatturaClienteModal({ group, parziale, onClose, onDone }: {
  group: GruppoFatturabile
  parziale: boolean
  onClose: () => void
  onDone: () => void
}) {
  const override = useLimitationOverride()
  const [righe, setRighe] = useState<Riga[] | null>(null)
  const [importi, setImporti] = useState<Record<string, string>>({})
  const [totaleParziale, setTotaleParziale] = useState('')
  const [nota, setNota] = useState('')
  const [invio, setInvio] = useState(false)

  // Righe fatturabili con quanto e' gia' in fattura.
  useEffect(() => {
    let vivo = true
    ;(async () => {
      const prenotazioni = [...group.noleggioBookings, ...group.primeWashBookings]
      const fatturatoPer: Record<string, { somma: number; quante: number }> = {}
      if (prenotazioni.length > 0) {
        const { data } = await supabase
          .from('fatture')
          .select('booking_id, importo_totale, tipo_fattura, stato')
          .in('booking_id', prenotazioni.map(b => b.id))
        for (const f of data || []) {
          if (NON_SERVIZIO.includes(String(f.tipo_fattura || '').toLowerCase())) continue
          if (String(f.stato || '').toLowerCase() === 'cancelled') continue
          const k = String(f.booking_id)
          fatturatoPer[k] = fatturatoPer[k] || { somma: 0, quante: 0 }
          fatturatoPer[k].somma += Number(f.importo_totale) || 0
          fatturatoPer[k].quante += 1
        }
      }
      const out: Riga[] = []
      for (const b of prenotazioni) {
        const totale = arrotonda((Number(b.price_total) || 0) / 100)
        const f = fatturatoPer[b.id] || { somma: 0, quante: 0 }
        const isLavaggio = b.service_type === 'car_wash' || b.service_type === 'mechanical'
        const nome = isLavaggio
          ? (b.service_name || 'Lavaggio')
          : `Noleggio ${b.vehicle_name || b.booking_details?.vehicle?.name || ''}`.trim()
        out.push({
          chiave: `b:${b.id}`, tipo: 'prenotazione', etichetta: nome, bookingId: b.id, booking: b, index: -1,
          totale, fatturato: arrotonda(f.somma), residuo: Math.max(0, arrotonda(totale - f.somma)),
          maiFatturata: f.quante === 0, pagata: PAGATO.includes(String(b.payment_status || '').toLowerCase()),
        })
      }
      for (const voce of [...group.penaliItems, ...group.danniItems]) {
        // Le voci "da fattura" (vecchio formato) sono gia' in una fattura.
        if (voce.source !== 'booking_details') continue
        const v = voce.booking?.booking_details?.[voce.type]?.[voce.originalIndex]
        if (!v) continue
        out.push({
          chiave: `${voce.type}:${voce.bookingId}:${voce.originalIndex}`, tipo: voce.type,
          etichetta: `${voce.type === 'danni' ? 'Danno' : 'Penale'} - ${v.label || voce.label}`,
          bookingId: voce.bookingId, booking: voce.booking, index: voce.originalIndex,
          totale: nettoVoce(v), fatturato: giaFatturato(v), residuo: daFatturare(v),
          maiFatturata: giaFatturato(v) === 0, pagata: v.paymentStatus === 'paid',
        })
      }
      if (!vivo) return
      setRighe(out)
      // "Genera fattura" = tutto il resto; "parziale" = si parte da zero.
      setImporti(Object.fromEntries(out.map(r => [r.chiave, parziale || r.residuo <= 0 ? '' : r.residuo.toFixed(2)])))
    })()
    return () => { vivo = false }
  }, [group, parziale])

  const importoDi = (r: Riga) => {
    const n = parseFloat(String(importi[r.chiave] || '').replace(',', '.'))
    return Number.isFinite(n) && n > 0 ? arrotonda(n) : 0
  }
  const totaleScelto = useMemo(() => arrotonda((righe || []).reduce((s, r) => s + importoDi(r), 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [righe, importi])
  const residuoTotale = useMemo(() => arrotonda((righe || []).reduce((s, r) => s + r.residuo, 0)), [righe])
  const oltre = (righe || []).filter(r => importoDi(r) > r.residuo + 0.01)

  // Fattura parziale: l'importo scritto in alto si distribuisce sulle voci
  // nell'ordine in cui compaiono, senza superare il resto di ciascuna.
  function distribuisci(valore: string) {
    setTotaleParziale(valore)
    let resto = parseFloat(String(valore).replace(',', '.'))
    if (!Number.isFinite(resto) || resto < 0) resto = 0
    const nuovi: Record<string, string> = {}
    for (const r of righe || []) {
      const quota = arrotonda(Math.min(resto, r.residuo))
      nuovi[r.chiave] = quota > 0 ? quota.toFixed(2) : ''
      resto = arrotonda(resto - quota)
    }
    setImporti(nuovi)
  }

  // Apre il PDF della fattura appena emessa (da mandare all'avvocato ecc.).
  async function apriPdf(invoiceId: string) {
    try {
      const res = await authFetch('/.netlify/functions/generate-invoice-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId }),
      })
      if (!res.ok) return
      const html = await res.text()
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
      const w = window.open(url, '_blank')
      if (w) setTimeout(() => URL.revokeObjectURL(url), 3000)
    } catch { /* il PDF resta comunque nel tab Fattura */ }
  }

  async function genera() {
    if (!righe || invio) return
    const scelte = righe.filter(r => importoDi(r) > 0)
    if (scelte.length === 0) { toast.error('Indica almeno un importo da fatturare'); return }
    if (oltre.length > 0) { toast.error(`${oltre[0].etichetta}: restano da fatturare solo ${euro(oltre[0].residuo)}`); return }

    // Noleggio/lavaggio non pagato: stessa autorizzazione di sempre
    // (fattura.booking_non_pagato). Avviso, mai blocco: OTP o bypass.
    const prenNonPagate = scelte.filter(r => r.tipo === 'prenotazione' && !r.pagata)
    if (prenNonPagate.length > 0 && !override.hasOverride('fattura.booking_non_pagato')) {
      const procedi = override.requestOverride(
        'fattura.booking_non_pagato',
        `Emettere fattura per ${group.customerName} su ${prenNonPagate.length === 1 ? 'una prenotazione' : `${prenNonPagate.length} prenotazioni`} NON pagat${prenNonPagate.length === 1 ? 'a' : 'e'} (${euro(prenNonPagate.reduce((s, r) => s + importoDi(r), 0))}).`
      )
      if (!procedi) return
    }
    const overrideId = override.activeOverrides.find(o => o.limitationCode === 'fattura.booking_non_pagato')?.overrideId

    setInvio(true)
    const emesse: string[] = []
    const errori: string[] = []
    try {
      // 1. Penali e danni: una fattura per tipo (aliquota e tipo_fattura
      //    diversi), con tutte le voci scelte del cliente.
      for (const tipo of ['penalties', 'danni'] as const) {
        const voci = scelte.filter(r => r.tipo === tipo)
        if (voci.length === 0) continue
        const items = voci.map(r => {
          const quota = importoDi(r)
          const base = r.etichetta.replace(/^(Penale|Danno) - /, '')
          const suffisso = quota < r.residuo - 0.01 ? ' (parziale)' : r.fatturato > 0 ? ' (saldo)' : ''
          return { label: `${base}${suffisso}`, amount: quota, quantity: 1 }
        })
        const tuttePagate = voci.every(r => r.pagata)
        const res = await authFetch('/.netlify/functions/generate-penalty-invoice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingId: voci[0].bookingId,
            customerId: voci[0].booking?.customer_id || voci[0].booking?.user_id,
            items,
            type: tipo === 'danni' ? 'danni' : 'penali',
            paymentStatus: tuttePagate ? 'paid' : 'pending',
            inviaSdi: true,
            note: nota.trim() || undefined,
            voci: voci.map(r => ({ bookingId: r.bookingId, key: tipo, index: r.index, importo: importoDi(r) })),
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) { errori.push(`${tipo === 'danni' ? 'Danni' : 'Penali'}: ${data.message || data.error || `HTTP ${res.status}`}`); continue }
        if (data.invoice?.numero_fattura) emesse.push(data.invoice.numero_fattura)
        if (data.invoiceId) await apriPdf(data.invoiceId)
      }

      // 2. Noleggio / lavaggio: intera e mai fatturata = la fattura
      //    principale di sempre; altrimenti una fattura parziale.
      for (const r of scelte.filter(x => x.tipo === 'prenotazione')) {
        const quota = importoDi(r)
        const intera = r.maiFatturata && Math.abs(quota - r.residuo) <= 0.01
        const res = await authFetch('/.netlify/functions/generate-invoice-from-booking', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingId: r.bookingId,
            includeIVA: true,
            customerId: r.booking?.booking_details?.customer?.customerId || undefined,
            ...(intera ? {} : { importoParziale: quota }),
            ...(!r.pagata && overrideId ? { overrideId } : {}),
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) { errori.push(`${r.etichetta}: ${data.message || data.error || `HTTP ${res.status}`}`); continue }
        if (data.skipped) { errori.push(`${r.etichetta}: ${data.message || 'nessuna fattura emessa'}`); continue }
        if (data.invoice?.numero_fattura) emesse.push(data.invoice.numero_fattura)
        if (data.invoice?.id) await apriPdf(data.invoice.id)
      }
    } finally {
      setInvio(false)
    }

    if (emesse.length > 0) {
      toast.success(`Fattur${emesse.length === 1 ? 'a' : 'e'} ${emesse.join(', ')} generat${emesse.length === 1 ? 'a' : 'e'} — ${euro(totaleScelto)}`, { duration: 8000 })
      logAdminAction(parziale ? 'genera_fattura_parziale_cliente' : 'genera_fattura_cliente', 'fattura', emesse.join(','), {
        customer_name: group.customerName,
        importo: totaleScelto,
        fatture: emesse,
        voci: scelte.map(r => ({ voce: r.etichetta, importo: importoDi(r), pagata: r.pagata })),
      })
    }
    for (const e of errori) toast.error(e, { duration: 10000 })
    if (emesse.length > 0) { onDone(); onClose() }
  }

  const coloreTipo = (t: Riga['tipo']) => t === 'prenotazione' ? 'text-blue-500' : t === 'penalties' ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-500'

  return createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4" style={{ zIndex: 10000 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-theme-bg-secondary border border-theme-border rounded-2xl shadow-2xl">
        <div className="px-5 py-4 border-b border-theme-border flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-theme-text-primary">{parziale ? 'Genera fattura parziale' : 'Genera fattura'}</h3>
            <p className="text-xs text-theme-text-muted mt-0.5">
              {group.customerName} — si puo' fatturare anche se non ha ancora pagato. Viene proposto solo quello che non e' gia' in fattura.
            </p>
          </div>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-primary text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4">
          {righe === null ? (
            <div className="text-sm text-theme-text-muted">Calcolo di quanto e' gia' fatturato...</div>
          ) : righe.length === 0 ? (
            <div className="text-sm text-theme-text-muted">Nessuna voce fatturabile per questo cliente.</div>
          ) : (
            <>
              {parziale && (
                <label className="block">
                  <span className="text-xs font-semibold text-theme-text-secondary">Importo della fattura parziale (IVA inclusa)</span>
                  <div className="flex items-center gap-2 mt-1">
                    <MoneyInput
                      value={totaleParziale}
                      onChange={distribuisci}
                      max={residuoTotale}
                      placeholder={`Max ${euro(residuoTotale)}`}
                      className="flex-1 px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-lg text-sm text-theme-text-primary"
                      autoFocus
                    />
                  </div>
                  <span className="text-[11px] text-theme-text-muted">Si distribuisce sulle voci qui sotto in ordine; puoi correggere ogni riga.</span>
                </label>
              )}

              <div className="rounded-xl border border-theme-border overflow-hidden">
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-3 py-2 bg-theme-bg-tertiary text-[10px] uppercase tracking-wider text-theme-text-muted font-semibold">
                  <div>Voce</div><div className="text-right">Totale</div><div className="text-right">Gia' fatturato</div><div className="text-right w-28">Da fatturare ora</div>
                </div>
                {righe.map(r => (
                  <div key={r.chiave} className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 items-center px-3 py-2 border-t border-theme-border/60 text-sm">
                    <div className="min-w-0">
                      <div className={`truncate font-medium ${coloreTipo(r.tipo)}`}>{r.etichetta}</div>
                      <div className="text-[11px] text-theme-text-muted">{r.pagata ? 'Pagata' : 'Non pagata'}</div>
                    </div>
                    <div className="text-right text-theme-text-secondary tabular-nums">{euro(r.totale)}</div>
                    <div className="text-right text-theme-text-muted tabular-nums">{r.fatturato > 0 ? euro(r.fatturato) : '—'}</div>
                    <div className="w-28">
                      {r.residuo <= 0 ? (
                        <div className="text-right text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">Gia' fatturata</div>
                      ) : (
                        <MoneyInput
                          value={importi[r.chiave] || ''}
                          onChange={(v: string) => setImporti(prev => ({ ...prev, [r.chiave]: v }))}
                          max={r.residuo}
                          placeholder={r.residuo.toFixed(2)}
                          className={`w-full px-2 py-1 bg-theme-bg-tertiary border rounded text-sm text-right text-theme-text-primary ${importoDi(r) > r.residuo + 0.01 ? 'border-red-500' : 'border-theme-border'}`}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <label className="block">
                <span className="text-xs font-semibold text-theme-text-secondary">Nota sulla fattura (facoltativa)</span>
                <input value={nota} onChange={e => setNota(e.target.value)}
                  placeholder="es. Penali contestate, pratica legale"
                  className="mt-1 w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-lg text-sm text-theme-text-primary" />
                <span className="text-[11px] text-theme-text-muted">Vale per penali e danni.</span>
              </label>

              <div className="text-[11px] text-theme-text-muted leading-relaxed">
                La fattura viene numerata, inviata allo SDI e mandata al cliente su WhatsApp come sempre, e si apre qui per scaricarla.
                Resta "non pagata" finche' il cliente non paga; al saldo si fattura solo quello che manca.
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-4 border-t border-theme-border flex items-center justify-between gap-3">
          <div className="text-sm text-theme-text-secondary">
            Totale fattura: <span className="font-bold text-theme-text-primary tabular-nums">{euro(totaleScelto)}</span>
            {residuoTotale > 0 && <span className="text-theme-text-muted"> / {euro(residuoTotale)} da fatturare</span>}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-theme-border text-sm text-theme-text-secondary hover:bg-theme-bg-tertiary">Annulla</button>
            <button onClick={genera} disabled={invio || !righe || totaleScelto <= 0 || oltre.length > 0}
              className="px-4 py-2 rounded-lg bg-dr7-gold hover:bg-[#0A8FA3] text-white text-sm font-semibold disabled:opacity-50">
              {invio ? 'Generazione...' : parziale ? 'Genera fattura parziale' : 'Genera fattura'}
            </button>
          </div>
        </div>
      </div>

      <LimitationOverrideModal
        isOpen={override.limitationState.isOpen}
        limitationCode={override.limitationState.limitationCode}
        limitationMessage={override.limitationState.limitationMessage}
        actionContext={override.limitationState.actionContext}
        draftSessionId={override.draftSessionId}
        flowType={override.flowType}
        onClose={override.closeLimitation}
        onCancel={override.cancelLimitation}
        onOverrideApproved={override.handleOverrideApproved}
      />
    </div>,
    document.body
  )
}
