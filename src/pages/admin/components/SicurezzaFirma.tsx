import { useState } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { authFetch } from '../../../utils/authFetch'
import { apriAuditFirma } from '../../../utils/apriAuditFirma'

/**
 * Sicurezza Firma (25/09/2026): pulsante + finestra con lo stato di sicurezza
 * di ogni firmatario (stesso modello dell'audit trail, funzione
 * signature-sicurezza) e le azioni dello staff:
 * - Revoca link: il link non si apre piu' e la sessione del dispositivo
 *   legata al link decade con lui.
 * - Genera nuovo link: il rinvio che la tab usa gia' (annulla i link vecchi).
 * - Autorizza cambio dispositivo: per 30 minuti un nuovo dispositivo puo'
 *   associarsi, solo dopo il codice inviato al recapito registrato.
 */

type Scheda = {
  id: string
  statoFirma: string
  linkAttivo: boolean
  scadenzaLink: string | null
  firmatario: { nome: string; dataFirma: string | null; metodo: string | null }
  riepilogo: { stato: 'REGOLARE' | 'ATTENZIONE'; cause: string[] }
  sessione: { deviceId: string; primaApertura: string; ultimaAttivita: string; sessioniRilevate: string; cambioDispositivo: string; cambioInAttesa: string | null }
  posizione: { stato: string; indirizzoStimato: string | null; accuratezza: string | null }
  rete: { clientIp: string }
  otp: { stato: string; tentativiErrati: number }
  eventi: { codice: string }[]
  revoca: { quando: string | null; da: string | null; motivo: string | null } | null
}
type Dati = { statoContratto: string; attive: Scheda[]; storiche: Scheda[] }

type Props = {
  contractId?: string | null
  requestId?: string | null
  titolo: string
  /** Rinvio del link gia' presente nella tab (signature-init / document-sign-init). */
  onGeneraNuovoLink?: () => Promise<void> | void
}

export default function PulsanteSicurezzaFirma({ contractId, requestId, titolo, onGeneraNuovoLink }: Props) {
  const [aperta, setAperta] = useState(false)
  const [dati, setDati] = useState<Dati | null>(null)
  const [caricamento, setCaricamento] = useState(false)
  const [inCorso, setInCorso] = useState<string | null>(null)

  async function carica() {
    setCaricamento(true)
    try {
      const qs = contractId ? `contractId=${encodeURIComponent(contractId)}` : `requestId=${encodeURIComponent(requestId || '')}`
      const res = await authFetch(`/.netlify/functions/signature-sicurezza?${qs}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Sicurezza firma non disponibile')
      setDati(json as Dati)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err))
      setAperta(false)
    } finally {
      setCaricamento(false)
    }
  }

  function apri() {
    setAperta(true)
    setDati(null)
    carica()
  }

  async function revoca(s: Scheda) {
    const motivo = window.prompt(`Revocare il link di firma di ${s.firmatario.nome}?\nIl link non si aprira' piu'. Motivo (facoltativo):`, '')
    if (motivo === null) return
    setInCorso(s.id)
    try {
      const res = await authFetch('/.netlify/functions/signature-sicurezza', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ azione: 'revoca_link', requestId: s.id, motivo }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Revoca non riuscita')
      toast.success('Link revocato')
      await carica()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setInCorso(null)
    }
  }

  async function autorizzaCambio(s: Scheda) {
    const motivo = window.prompt(
      `Autorizzare un nuovo dispositivo per ${s.firmatario.nome}?\n` +
      `Per 30 minuti il link potra' essere aperto da un altro telefono, ma solo dopo il codice inviato al numero registrato del cliente. ` +
      `Il dispositivo attuale decade appena il nuovo si verifica.\nMotivo (facoltativo):`, '')
    if (motivo === null) return
    setInCorso(`cambio-${s.id}`)
    try {
      const res = await authFetch('/.netlify/functions/signature-sicurezza', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ azione: 'autorizza_cambio', requestId: s.id, motivo }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Autorizzazione non riuscita')
      toast.success('Cambio dispositivo autorizzato per 30 minuti')
      await carica()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setInCorso(null)
    }
  }

  async function nuovoLink() {
    if (!onGeneraNuovoLink) return
    if (!window.confirm('Generare e inviare un nuovo link di firma? I link non ancora firmati verranno annullati.')) return
    setInCorso('nuovo')
    try {
      await onGeneraNuovoLink()
      await carica()
    } finally {
      setInCorso(null)
    }
  }

  const voce = (k: string, v: string | null | undefined) => (
    <div className="flex justify-between gap-3 py-1 border-b border-theme-border last:border-b-0">
      <span className="text-theme-text-muted text-xs">{k}</span>
      <span className="text-theme-text-primary text-xs font-semibold text-right break-all">{v || '—'}</span>
    </div>
  )

  const finestra = aperta ? createPortal(
    <div className="fixed inset-0 bg-black/50 z-[70] flex items-start sm:items-center justify-center p-3 overflow-y-auto" onClick={() => setAperta(false)}>
      <div
        className="bg-theme-bg-primary border border-theme-border rounded-xl w-full max-w-2xl my-4 p-4 sm:p-5 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="text-[11px] tracking-widest text-theme-text-muted font-semibold">SICUREZZA FIRMA</div>
            <div className="text-lg font-bold text-theme-text-primary">{titolo}</div>
            {dati && <div className="text-xs text-theme-text-secondary">Stato firma: {dati.statoContratto}</div>}
          </div>
          <button onClick={() => setAperta(false)} className="text-theme-text-muted hover:text-theme-text-primary text-sm px-2">Chiudi</button>
        </div>

        {caricamento && !dati && <div className="text-sm text-theme-text-secondary py-8 text-center">Caricamento...</div>}

        {dati && (
          <div className="space-y-3">
            {dati.attive.length === 0 && <div className="text-sm text-theme-text-secondary">Nessuna richiesta di firma attiva.</div>}
            {dati.attive.map(s => {
              const attenzione = s.riepilogo.stato === 'ATTENZIONE'
              const nuoviDispositivi = s.eventi.filter(e => e.codice === 'NEW_DEVICE_DETECTED').length
              return (
                <div key={s.id} className="rounded-lg border border-theme-border bg-theme-bg-secondary p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div className="font-semibold text-theme-text-primary">{s.firmatario.nome}</div>
                    <span className="text-[11px] font-bold tracking-wide px-2 py-0.5 rounded-full border border-theme-border text-theme-text-secondary">{s.statoFirma}</span>
                  </div>

                  <div className={`rounded-md border px-3 py-2 mb-2 ${attenzione
                    ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30'
                    : 'border-green-600 bg-green-50 dark:bg-green-950/30'}`}>
                    <div className={`text-xs font-bold tracking-wide ${attenzione ? 'text-amber-700 dark:text-amber-400' : 'text-green-700 dark:text-green-400'}`}>
                      {attenzione ? 'ATTENZIONE' : 'REGOLARE'}
                    </div>
                    {s.riepilogo.cause.length > 0
                      ? <ul className="list-disc ml-4 mt-1 text-xs text-theme-text-primary space-y-0.5">{s.riepilogo.cause.map((c, i) => <li key={i}>{c}</li>)}</ul>
                      : <div className="text-xs text-theme-text-secondary mt-0.5">Nessun evento di sicurezza rilevato.</div>}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                    <div>
                      {voce('DR7 Device ID', s.sessione.deviceId)}
                      {voce('Prima apertura', s.sessione.primaApertura)}
                      {voce('Ultima attivita\'', s.sessione.ultimaAttivita)}
                      {voce('Nuovi dispositivi', nuoviDispositivi ? `${nuoviDispositivi} accessi respinti` : 'Nessuno')}
                      {voce('Re-binding', s.sessione.cambioDispositivo)}
                      {s.sessione.cambioInAttesa && voce('Cambio in attesa', s.sessione.cambioInAttesa)}
                    </div>
                    <div>
                      {voce('OTP', `${s.otp.stato}${s.otp.tentativiErrati ? ` (${s.otp.tentativiErrati} errati)` : ''}`)}
                      {voce('GPS', `${s.posizione.stato}${s.posizione.accuratezza ? ` — ${s.posizione.accuratezza.replace('Accuratezza dichiarata dal dispositivo: ', '')}` : ''}`)}
                      {s.posizione.indirizzoStimato && voce('Indirizzo stimato', s.posizione.indirizzoStimato)}
                      {voce('IP', s.rete.clientIp)}
                      {voce('Firma completata', s.firmatario.dataFirma ? `${s.firmatario.dataFirma}${s.firmatario.metodo ? ` — ${s.firmatario.metodo}` : ''}` : 'No')}
                      {s.linkAttivo && voce('Link valido fino al', s.scadenzaLink)}
                      {s.revoca && voce('Revocato', `${s.revoca.quando}${s.revoca.da ? ` da ${s.revoca.da}` : ''}`)}
                    </div>
                  </div>

                  {s.linkAttivo && (
                    <div className="flex flex-wrap gap-2 mt-3">
                      <button
                        onClick={() => revoca(s)}
                        disabled={inCorso !== null}
                        className="px-3 py-1.5 rounded-full text-xs font-bold bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
                      >
                        {inCorso === s.id ? 'Revoca...' : 'Revoca link e sessione'}
                      </button>
                      {s.sessione.deviceId.startsWith('DR7-DVC-') && s.statoFirma !== 'COMPLETATA' && (
                        <button
                          onClick={() => autorizzaCambio(s)}
                          disabled={inCorso !== null}
                          className="px-3 py-1.5 rounded-full text-xs font-bold bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary disabled:opacity-50"
                        >
                          {inCorso === `cambio-${s.id}` ? 'Autorizzazione...' : 'Autorizza cambio dispositivo'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {dati.storiche.length > 0 && (
              <div className="text-xs text-theme-text-muted">
                Richieste precedenti (sostituite o annullate): {dati.storiche.length}. Dettaglio nell'audit trail.
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              {onGeneraNuovoLink && (
                <button
                  onClick={nuovoLink}
                  disabled={inCorso !== null}
                  className="px-3 py-1.5 rounded-full text-xs font-bold bg-dr7-gold hover:bg-[#0A8FA3] text-white disabled:opacity-50"
                >
                  {inCorso === 'nuovo' ? 'Invio...' : 'Genera nuovo link'}
                </button>
              )}
              <button
                onClick={() => apriAuditFirma({ contractId, requestId }).catch((err: unknown) => toast.error(err instanceof Error ? err.message : String(err)))}
                className="px-3 py-1.5 rounded-full text-xs font-semibold bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary"
              >
                Apri Audit Trail
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  ) : null

  return (
    <>
      <button
        onClick={apri}
        className="w-full bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary px-3 py-1 rounded-full text-sm transition-colors flex items-center justify-center gap-1"
      >
        Sicurezza Firma
      </button>
      {finestra}
    </>
  )
}
