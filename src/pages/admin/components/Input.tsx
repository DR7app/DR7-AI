interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
}

export default function Input({ label, className = '', ...props }: InputProps) {
  return (
    <div>
      {label && (
        <label className="block text-sm font-medium text-theme-text-primary mb-2">
          {label}
        </label>
      )}
      <input
        className={`w-full px-3 py-2 bg-theme-bg-primary border border-dr7-gold/30 rounded text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors ${className}`}
        {...props}
      />
    </div>
  )
}
