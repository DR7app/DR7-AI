// TimeSelect — la select dell'ora usata da tutti i form di prenotazione
// Mare/Aria. Vive in un file suo perche' i moduli che esportano un componente
// non possono esportare anche costanti/helper (regola react-refresh).
import { INPUT_CLS, buildTimeOptions, isOutOfHours, officeHoursLabel } from './noleggioFormBits'

// Select dell'ora: stessa griglia e stesso avviso fuori-orario ovunque.
export default function TimeSelect({ label, value, dateStr, kind, onChange, serviceType }: {
  label: string
  value: string
  dateStr: string
  kind: 'pickup' | 'return'
  onChange: (v: string) => void
  /** Da quale business leggere gli orari. Omesso = Noleggio Terra. */
  serviceType?: string | null
}) {
  const flagged = isOutOfHours(dateStr, value, kind, serviceType)
  const hours = officeHoursLabel(dateStr, kind, serviceType)
  return (
    <div>
      <label className="text-xs text-theme-text-muted">{label}</label>
      <select className={INPUT_CLS} value={value} onChange={e => onChange(e.target.value)}>
        {buildTimeOptions(dateStr, kind, value, serviceType).map(o => (
          <option key={o.value} value={o.value} style={o.style}>{o.label}</option>
        ))}
      </select>
      {flagged && (
        <p className="mt-1 text-[11px] text-red-400 font-semibold">
          Fuori orario {kind === 'pickup' ? 'ritiro' : 'riconsegna'} {hours ? `(${hours})` : '(giorno di chiusura)'}
        </p>
      )}
    </div>
  )
}

