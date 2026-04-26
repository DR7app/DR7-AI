import { useRef, useEffect } from 'react'

interface OtpInputProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

export default function OtpInput({ value, onChange, disabled }: OtpInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function handleChange(raw: string) {
    if (disabled) return
    const cleaned = raw.replace(/\D/g, '').slice(0, 6)
    onChange(cleaned)
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        disabled={disabled}
        placeholder="------"
        className="w-full h-14 text-center text-2xl font-bold tracking-[0.5em] bg-white/5 border border-white/20 rounded-xl text-white focus:border-[#2d8a7e] focus:ring-1 focus:ring-[#2d8a7e] outline-none transition-all disabled:opacity-50"
      />
    </div>
  )
}
