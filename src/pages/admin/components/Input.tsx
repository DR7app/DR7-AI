import EuropeanDateInput from '../../../components/EuropeanDateInput'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
}

const BASE_CLASS = 'w-full px-3 py-2 min-h-[44px] bg-theme-bg-primary border border-dr7-gold/30 rounded text-base sm:text-sm text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors'

export default function Input({ label, className = '', ...props }: InputProps) {
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
