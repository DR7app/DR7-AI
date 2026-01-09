interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  options: { value: string; label: string }[]
}

export default function Select({ label, options, className = '', ...props }: SelectProps) {
  console.log('Select component rendering with options:', options.length)
  return (
    <div>
      {label && (
        <label className="block text-sm font-medium text-theme-text-primary mb-2">
          {label}
        </label>
      )}
      <select
        className={`w-full px-3 py-2 bg-theme-bg-primary border border-dr7-gold/30 rounded text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors appearance-auto ${className}`}
        style={{ WebkitAppearance: 'menulist', MozAppearance: 'menulist' }}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} style={{ color: 'black', backgroundColor: 'white' }}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}
