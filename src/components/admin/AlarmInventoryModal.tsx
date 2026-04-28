/**
 * AlarmInventoryModal
 *
 * Catalogue of every alarm the system can fire. Pulled live from the
 * alarm logic in `src/contexts/VehicleAlarmContext.tsx` so admins know
 * exactly what to expect when they enable sound. Read-only.
 *
 * Two groups:
 *   1. Prenotazioni — fire on booking lifecycle events (10-min windows).
 *   2. Manutenzione Flotta — fire when vehicle config crosses a threshold.
 */

interface AlarmDef {
  id: string
  label: string
  schedule: string
  reason: string
  group: 'booking' | 'fleet'
}

const ALARMS: AlarmDef[] = [
  // ── Booking lifecycle ──────────────────────────────────────────────
  {
    id: 'car_wash',
    label: 'Lavaggio in arrivo',
    schedule: '10 minuti prima dell\'orario dell\'appuntamento',
    reason: 'Avvisa l\'operatore di preparare la postazione lavaggio. Esclude i lavaggi interni / rientri.',
    group: 'booking',
  },
  {
    id: 'return_before',
    label: 'Promemoria Riconsegna',
    schedule: '10 minuti prima della data di riconsegna',
    reason: 'Avvisa che un veicolo a noleggio sta per rientrare: serve organizzare check-in, controllo veicolo, pulizia.',
    group: 'booking',
  },
  {
    id: 'return_after',
    label: 'Riconsegna in Ritardo',
    schedule: '10 minuti dopo la data di riconsegna',
    reason: 'Il cliente non ha riconsegnato in orario. Trigger indipendente dall\'avviso "prima": continua a suonare se l\'admin non ha confermato il rientro.',
    group: 'booking',
  },
  {
    id: 'deposit',
    label: 'Cauzione da Incassare',
    schedule: '10 minuti prima del ritiro',
    reason: 'Prenotazione con deposit > 0 in arrivo: serve incassare la cauzione al momento della consegna chiavi.',
    group: 'booking',
  },
  {
    id: 'unpaid_pickup',
    label: 'Ritiro con Pagamento Aperto',
    schedule: '10 minuti prima del ritiro',
    reason: 'Il cliente arriva tra poco ma il pagamento non è ancora segnato come paid/completed/succeeded. Da incassare.',
    group: 'booking',
  },

  // ── Fleet maintenance ─────────────────────────────────────────────
  {
    id: 'fleet_service',
    label: 'Tagliando in Scadenza',
    schedule: 'Quando mancano ≤ 1.000 km al prossimo tagliando',
    reason: 'Il veicolo si avvicina al chilometraggio del tagliando programmato (last_service_km + intervallo).',
    group: 'fleet',
  },
  {
    id: 'fleet_tires_front',
    label: 'Gomme Anteriori in Scadenza',
    schedule: 'Quando mancano ≤ 1.000 km al cambio gomme anteriori',
    reason: 'Soglia di sicurezza per programmare in tempo il cambio gomme anteriori.',
    group: 'fleet',
  },
  {
    id: 'fleet_tires_rear',
    label: 'Gomme Posteriori in Scadenza',
    schedule: 'Quando mancano ≤ 1.000 km al cambio gomme posteriori',
    reason: 'Soglia di sicurezza per programmare in tempo il cambio gomme posteriori.',
    group: 'fleet',
  },
  {
    id: 'fleet_brakes_front',
    label: 'Pastiglie Anteriori in Scadenza',
    schedule: 'Quando mancano ≤ 1.000 km al prossimo cambio pastiglie anteriori',
    reason: 'Avvisa per pianificare il cambio pastiglie freni anteriori prima del consumo critico.',
    group: 'fleet',
  },
  {
    id: 'fleet_brakes_rear',
    label: 'Pastiglie Posteriori in Scadenza',
    schedule: 'Quando mancano ≤ 1.000 km al prossimo cambio pastiglie posteriori',
    reason: 'Avvisa per pianificare il cambio pastiglie freni posteriori prima del consumo critico.',
    group: 'fleet',
  },
  {
    id: 'fleet_insurance',
    label: 'Assicurazione in Scadenza',
    schedule: 'Quando mancano ≤ 7 giorni alla scadenza assicurativa',
    reason: 'Veicolo non può circolare senza copertura RC: serve rinnovare in tempo.',
    group: 'fleet',
  },
  {
    id: 'fleet_tax',
    label: 'Bollo in Scadenza',
    schedule: 'Quando mancano ≤ 7 giorni alla scadenza del bollo',
    reason: 'Sanzione amministrativa se non versato entro la scadenza.',
    group: 'fleet',
  },
  {
    id: 'fleet_inspection',
    label: 'Revisione in Scadenza',
    schedule: 'Quando mancano ≤ 7 giorni alla revisione',
    reason: 'Veicolo non revisionato non è abilitato alla circolazione né noleggiabile.',
    group: 'fleet',
  },
]

interface Props {
  isOpen: boolean
  onClose: () => void
  audioEnabled: boolean
  onEnableAudio: () => void
}

export default function AlarmInventoryModal({ isOpen, onClose, audioEnabled, onEnableAudio }: Props) {
  if (!isOpen) return null

  const groups: Array<{ id: 'booking' | 'fleet'; title: string; subtitle: string }> = [
    { id: 'booking', title: 'Prenotazioni', subtitle: 'Eventi legati al ciclo di vita di un noleggio o lavaggio.' },
    { id: 'fleet', title: 'Manutenzione Flotta', subtitle: 'Soglie km e date di scadenza per ogni veicolo attivo.' },
  ]

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-3 py-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-3xl max-h-[88vh] overflow-y-auto bg-theme-bg-primary border border-theme-border rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-4 bg-theme-bg-primary border-b border-theme-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-dr7-gold/15 flex items-center justify-center">
              <svg className="w-5 h-5 text-dr7-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-semibold text-theme-text-primary">Gestione Allarmi</h2>
              <p className="text-xs text-theme-text-muted">{ALARMS.length} avvisi attivi · controllo ogni 60 secondi</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-tertiary transition-colors"
            aria-label="Chiudi"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Audio status */}
        <div className="px-5 py-3 border-b border-theme-border">
          {audioEnabled ? (
            <div className="flex items-center gap-2 text-xs text-green-400">
              <span className="w-2 h-2 rounded-full bg-green-400" />
              Audio attivato — gli allarmi suoneranno quando le condizioni qui sotto sono soddisfatte.
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-xs text-amber-400">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                Audio non attivato — gli allarmi appariranno solo come notifica visiva.
              </div>
              <button
                onClick={onEnableAudio}
                className="px-3 py-1.5 rounded-full text-xs font-semibold bg-dr7-gold text-white hover:opacity-90 transition-opacity"
              >
                Attiva audio
              </button>
            </div>
          )}
        </div>

        {/* Groups */}
        <div className="px-5 py-4 space-y-6">
          {groups.map(g => {
            const items = ALARMS.filter(a => a.group === g.id)
            return (
              <section key={g.id}>
                <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-dr7-gold mb-1">{g.title}</h3>
                <p className="text-xs text-theme-text-muted mb-3">{g.subtitle}</p>
                <ul className="space-y-2">
                  {items.map(a => (
                    <li key={a.id} className="rounded-lg border border-theme-border bg-theme-bg-tertiary/40 p-3">
                      <div className="flex items-start justify-between gap-3 mb-1.5">
                        <h4 className="text-sm font-semibold text-theme-text-primary">{a.label}</h4>
                        <span className="text-[10px] uppercase tracking-wider text-theme-text-muted shrink-0">{a.id}</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-y-1 gap-x-3 text-xs">
                        <span className="text-theme-text-muted">Quando suona</span>
                        <span className="text-theme-text-primary">{a.schedule}</span>
                        <span className="text-theme-text-muted">Motivo</span>
                        <span className="text-theme-text-secondary">{a.reason}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>

        <div className="px-5 py-3 border-t border-theme-border text-[11px] text-theme-text-muted">
          Logica sorgente: <code className="bg-theme-bg-tertiary px-1.5 py-0.5 rounded">VehicleAlarmContext.tsx</code>.
          Polling: 60 s, sospeso quando la scheda non è visibile.
        </div>
      </div>
    </div>
  )
}
