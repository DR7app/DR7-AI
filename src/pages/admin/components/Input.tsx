import EuropeanDateInput from '../../../components/EuropeanDateInput'
import MoneyInput from '../../../components/MoneyInput'
import TelefonoConPrefisso from '../../../components/TelefonoConPrefisso'
import AddressAutocomplete from './AddressAutocomplete'
import type { AddressParts } from './AddressAutocomplete'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  /** Solo con type="address": i pezzi dell'indirizzo scelto dalla tendina
   *  (via, CAP, comune, provincia), per riempire i campi accanto. */
  onAddressParts?: (parti: AddressParts) => void
}

const BASE_CLASS = 'w-full px-3 py-2 min-h-[44px] bg-theme-bg-primary border border-dr7-gold/30 rounded text-base sm:text-sm text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors'

export default function Input({ label, className = '', onAddressParts, ...props }: InputProps) {
  // 2026-08-02 (direzione): MAI <input type="date"> nativo. Il browser lo
  // renderizza con il locale del sistema operativo, quindi su un Mac in inglese
  // usciva MM/GG/AAAA (08/04/2026 = 4 agosto letto come 8 aprile). In Europa la
  // data e' SEMPRE GG/MM/AAAA: type="date" viene reso da EuropeanDateInput, che
  // legge/scrive ISO ma mostra GG/MM/AAAA e apre comunque il calendario nativo.
  if (props.type === 'date') {
    const onChange = props.onChange
    return (
      <div>
        {label && (
          <label className="block text-sm font-medium text-theme-text-primary mb-2">
            {label}
          </label>
        )}
        <EuropeanDateInput
          value={typeof props.value === 'string' ? props.value : ''}
          onChange={(iso) => onChange?.({
            target: { value: iso, name: props.name ?? '' },
            currentTarget: { value: iso, name: props.name ?? '' },
          } as React.ChangeEvent<HTMLInputElement>)}
          min={typeof props.min === 'string' ? props.min : undefined}
          max={typeof props.max === 'string' ? props.max : undefined}
          required={props.required}
          disabled={props.disabled}
          readOnly={props.readOnly}
          name={props.name}
          id={props.id}
          title={props.title}
          className={`${BASE_CLASS} ${className}`}
        />
      </div>
    )
  }

  // 2026-08-27 (direzione): OGNI campo telefono ha il prefisso internazionale
  // con la bandiera. Scritto a mano il numero parte e non arriva: Green API
  // tiene solo le cifre, quindi "347..." senza prefisso, "0039..." o un numero
  // estero digitato all'italiana risultano consegnati e non lo sono. Qui, come
  // gia' per le date e per gli importi, la scelta e' UNA SOLA e vive nel
  // componente Input: cosi' ogni <Input type="tel"> del gestionale prende la
  // tendina con la bandiera senza doverla ricablare form per form.
  if (props.type === 'tel') {
    const onChange = props.onChange
    return (
      <div>
        {label && (
          <label className="block text-sm font-medium text-theme-text-primary mb-2">
            {label}
          </label>
        )}
        <TelefonoConPrefisso
          value={typeof props.value === 'string' ? props.value : ''}
          onChange={(v) => onChange?.({
            target: { value: v, name: props.name ?? '' },
            currentTarget: { value: v, name: props.name ?? '' },
          } as React.ChangeEvent<HTMLInputElement>)}
          placeholder={props.placeholder}
          disabled={props.disabled}
          className={`${BASE_CLASS} flex-1 min-w-0 ${className}`}
          selectClassName={`${BASE_CLASS} w-[104px] shrink-0 px-2`}
          // Anteprima spenta nei form: qui l'Input sta quasi sempre dentro una
          // griglia a due colonne e la riga di aiuto sfalserebbe le altre voci.
          mostraAnteprima={false}
        />
      </div>
    )
  }

  // 2026-08-28 (direzione): OGNI campo dove si scrive un INDIRIZZO cerca da
  // solo. Si digita "via salvo d'acquisto 7" e si sceglie dalla tendina: via,
  // civico, CAP, citta' e provincia arrivano gia' scritti giusti. Scritti a
  // mano finivano storti (CAP mancante, comune abbreviato) e poi la fattura
  // non partiva al SDI e le consegne non si potevano calcolare. Come per le
  // date, gli importi e il telefono la scelta e' UNA SOLA e vive qui:
  // `<Input type="address">` e il form ha la ricerca, senza ricablarlo.
  if (props.type === 'address') {
    const onChange = props.onChange
    return (
      <div>
        {label && (
          <label className="block text-sm font-medium text-theme-text-primary mb-2">
            {label}
          </label>
        )}
        <AddressAutocomplete
          onSelectParts={onAddressParts}
          value={typeof props.value === 'string' ? props.value : ''}
          onChange={(v) => onChange?.({
            target: { value: v, name: props.name ?? '' },
            currentTarget: { value: v, name: props.name ?? '' },
          } as React.ChangeEvent<HTMLInputElement>)}
          placeholder={props.placeholder}
          required={props.required}
          disabled={props.disabled}
          className={`${BASE_CLASS} ${className}`}
        />
      </div>
    )
  }

  // 2026-08-03 (direzione): i campi IMPORTO non usano piu' type="number". Con
  // locale di sistema italiano il campo numerico rifiuta il separatore decimale
  // (155,50 non digitabile, restano gli interi). step decimale => e' un importo.
  const stepStr = props.step === undefined || props.step === null ? '' : String(props.step)
  if (props.type === 'number' && /^0?\.\d+$/.test(stepStr)) {
    const onChange = props.onChange
    return (
      <div>
        {label && (
          <label className="block text-sm font-medium text-theme-text-primary mb-2">
            {label}
          </label>
        )}
        <MoneyInput
          value={typeof props.value === 'string' || typeof props.value === 'number' ? props.value : ''}
          onChange={(v) => onChange?.({
            target: { value: v, name: props.name ?? '' },
            currentTarget: { value: v, name: props.name ?? '' },
          } as React.ChangeEvent<HTMLInputElement>)}
          min={typeof props.min === 'string' || typeof props.min === 'number' ? props.min : undefined}
          max={typeof props.max === 'string' || typeof props.max === 'number' ? props.max : undefined}
          placeholder={props.placeholder}
          required={props.required}
          disabled={props.disabled}
          readOnly={props.readOnly}
          name={props.name}
          id={props.id}
          title={props.title}
          onKeyDown={props.onKeyDown}
          onBlur={props.onBlur}
          className={`${BASE_CLASS} ${className}`}
        />
      </div>
    )
  }

  return (
    <div>
      {label && (
        <label className="block text-sm font-medium text-theme-text-primary mb-2">
          {label}
        </label>
      )}
      <input
        className={`${BASE_CLASS} ${className}`}
        {...props}
      />
    </div>
  )
}
