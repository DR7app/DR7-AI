import { useRef, useEffect } from 'react'

interface OtpInputProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

export default function OtpInput({ value, onChange, disabled }: OtpInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])
  const digits = value.padEnd(6, '').split('').slice(0, 6)

  useEffect(() => {
    inputRefs.current[0]?.focus()
  }, [])

  function handleChange(index: number, char: string) {
    if (disabled) return
    const sanitized = char.replace(/\D/g, '')
    if (!sanitized && char !== '') return

    const newDigits = [...digits]
    newDigits[index] = sanitized
    const newValue = newDigits.join('')
    onChange(newValue)

    if (sanitized && index < 5) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (pasted) {
      onChange(pasted)
      const focusIndex = Math.min(pasted.length, 5)
      inputRefs.current[focusIndex]?.focus()
    }
  }

  return (
    <div className="flex gap-3 justify-center">
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => { inputRefs.current[i] = el }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digit}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={i === 0 ? handlePaste : undefined}
          disabled={disabled}
          className="w-12 h-14 text-center text-2xl font-bold bg-white/5 border border-white/20 rounded-xl text-white focus:border-[#2d8a7e] focus:ring-1 focus:ring-[#2d8a7e] outline-none transition-all disabled:opacity-50"
        />
      ))}
    </div>
  )
}
