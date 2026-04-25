import { logger } from '../../../utils/logger'

export interface SelectOption {
  value: string
  label: string
  style?: React.CSSProperties
  // Marker for callers that want to detect "exceptional" selections
  // post-render without re-deriving the rule.
  flagged?: boolean
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  options: SelectOption[]
}

export default function Select({ label, options, className = '', ...props }: SelectProps) {
  logger.log('Select component rendering with options:', options.length)
  return (
    <div>
      {label && (
        <label className="block text-sm font-medium text-theme-text-primary mb-2">
          {label}
        </label>
      )}
      <select
        className={`w-full px-3 py-2 min-h-[44px] bg-theme-bg-primary border border-dr7-gold/30 rounded text-base sm:text-sm text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors appearance-auto ${className}`}
        style={{ WebkitAppearance: 'menulist', MozAppearance: 'menulist' }}
        {...props}
      >
        {options.map((opt) => (
          <option
            key={opt.value}
            value={opt.value}
            style={opt.style ?? { color: 'black', backgroundColor: 'white' }}
          >
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}
