import { useState } from 'react'
import { sanitizeMoney, parseMoney } from '../utils/money'

type MoneyInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type' | 'step' | 'inputMode' | 'min' | 'max'
> & {
  /** Valore corrente: stringa ("155.5") o numero (155.5). */
  value: string | number | null | undefined
  /** Riceve SEMPRE una stringa gia' normalizzata col punto ("155.5"). */
  onChange: (value: string) => void
  /** Limiti CONSIGLIATI: segnalati a video, mai bloccanti. */
  min?: number | string
  max?: number | string
}

/**
 * Campo decimale (importi in €, percentuali, tariffe, quantita' con la virgola).
 *
 * 2026-08-03: sostituisce `<input type="number" step="0.01">`, che con locale di
 * sistema italiano (Chrome/Safari) ingoia il separatore decimale — un danno da
 * 155,50 non era digitabile, restavano solo gli interi.
 *
 * - accetta indifferentemente "." e "," e normalizza col punto (sanitizeMoney)
 * - tiene un BUFFER interno del testo digitato: se lo stato del chiamante e' un
 *   numero, "155." mentre si scrive non viene riscritto a "155" facendo sparire
 *   il punto appena premuto. Al blur si riallinea al valore del padre.
 * - min/max NON sono piu' vincoli del browser (bloccavano il salvataggio senza
 *   spiegazioni): restano come avviso visivo. Regola DR7: si avvisa, non si
 *   blocca — la validazione vera sta nei handler.
 */
export default function MoneyInput({ value, onChange, onBlur, min, max, title, className = '', ...rest }: MoneyInputProps) {
  const [buffer, setBuffer] = useState<string | null>(null)
  const shown = buffer !== null
    ? buffer
    : (value === null || value === undefined ? '' : String(value))

  const num = parseMoney(shown)
  const minNum = min === undefined || min === '' ? null : Number(min)
  const maxNum = max === undefined || max === '' ? null : Number(max)
  const outOfRange = !isNaN(num) && shown !== '' && (
    (minNum !== null && !isNaN(minNum) && num < minNum) ||
    (maxNum !== null && !isNaN(maxNum) && num > maxNum)
  )

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      value={shown}
      title={outOfRange
        ? `Valore consigliato${minNum !== null ? ` da ${minNum}` : ''}${maxNum !== null ? ` a ${maxNum}` : ''} — puoi comunque salvare`
        : title}
      className={`${className}${outOfRange ? ' ring-1 ring-orange-400' : ''}`}
      onChange={(e) => {
        const s = sanitizeMoney(e.target.value)
        setBuffer(s)
        onChange(s)
      }}
      onBlur={(e) => {
        setBuffer(null)
        onBlur?.(e)
      }}
    />
  )
}
