import React, { useState, useEffect, useRef } from 'react';

interface EuropeanDateInputProps {
  value: string; // ISO format (YYYY-MM-DD)
  onChange: (value: string) => void; // ISO format (YYYY-MM-DD)
  min?: string; // ISO format (YYYY-MM-DD)
  max?: string; // ISO format (YYYY-MM-DD)
  required?: boolean;
  className?: string;
  name?: string;
}

/**
 * EuropeanDateInput — DD/MM/YYYY text input + calendar popup.
 *
 * - Text field accepts DD/MM/YYYY typed input (auto-inserts slashes)
 * - Calendar icon on the right opens the browser's native date picker
 *   (visual calendar). Clicking a date fills the text field.
 * - Calls onChange with ISO format (YYYY-MM-DD) for the consuming form.
 */
const EuropeanDateInput: React.FC<EuropeanDateInputProps> = ({
  value,
  onChange,
  min,
  max,
  required = false,
  className = '',
  name,
}) => {
  const [displayValue, setDisplayValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const nativeRef = useRef<HTMLInputElement | null>(null);

  const isoToEuropean = (isoDate: string): string => {
    if (!isoDate) return '';
    const [year, month, day] = isoDate.split('-');
    return `${day}/${month}/${year}`;
  };

  const europeanToIso = (euroDate: string): string => {
    if (!euroDate) return '';
    const parts = euroDate.split('/');
    if (parts.length !== 3) return '';
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];
    if (day.length !== 2 || month.length !== 2 || year.length !== 4) return '';
    const d = parseInt(day, 10);
    const m = parseInt(month, 10);
    const y = parseInt(year, 10);
    if (isNaN(d) || isNaN(m) || isNaN(y)) return '';
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return '';
    const testDate = new Date(y, m - 1, d);
    if (testDate.getFullYear() !== y || testDate.getMonth() !== m - 1 || testDate.getDate() !== d) return '';
    return `${year}-${month}-${day}`;
  };

  useEffect(() => {
    if (value && !isFocused) {
      setDisplayValue(isoToEuropean(value));
    } else if (!value && !isFocused) {
      setDisplayValue('');
    }
  }, [value, isFocused]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value;
    let formatted = input.replace(/\D/g, '');
    if (formatted.length >= 2) formatted = formatted.slice(0, 2) + '/' + formatted.slice(2);
    if (formatted.length >= 5) formatted = formatted.slice(0, 5) + '/' + formatted.slice(5);
    if (formatted.length > 10) formatted = formatted.slice(0, 10);
    setDisplayValue(formatted);
    if (formatted.length === 10) {
      const isoDate = europeanToIso(formatted);
      if (isoDate) {
        if (min && isoDate < min) return;
        if (max && isoDate > max) return;
        onChange(isoDate);
      }
    } else if (formatted === '') {
      onChange('');
    }
  };

  const handleFocus = () => {
    setIsFocused(true);
    if (!displayValue && value) setDisplayValue(isoToEuropean(value));
  };

  const handleBlur = () => {
    setIsFocused(false);
    if (displayValue.length > 0 && displayValue.length < 10) {
      setDisplayValue('');
      onChange('');
    } else if (value) {
      setDisplayValue(isoToEuropean(value));
    }
  };

  // 2026-06-01: pulsante calendario apre il picker nativo del browser
  // tramite showPicker(). In IT mostra il calendario visivo con label
  // DD/MM/YYYY. Fallback: focus + click sull'input nascosto, che apre
  // comunque il picker nei browser piu' vecchi.
  const openNativePicker = () => {
    const el = nativeRef.current;
    if (!el) return;
    try {
      // showPicker() — supportato da Chrome 99+, Safari 16.4+, Firefox 101+
      if (typeof (el as HTMLInputElement & { showPicker?: () => void }).showPicker === 'function') {
        (el as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
        return;
      }
    } catch {
      // Some browsers throw if showPicker is called without user gesture
      // (we ARE in a click handler so this shouldn't trigger, but safe-guard)
    }
    // Fallback: focus + click. Mobile Safari ignores .click() on hidden
    // inputs, so we keep the input visually adjacent (small + opacity 0).
    el.focus();
    el.click();
  };

  return (
    <div className="relative inline-flex items-center">
      <input
        type="text"
        name={name}
        value={displayValue}
        onChange={handleInputChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder="GG/MM/AAAA"
        required={required}
        maxLength={10}
        inputMode="numeric"
        className={`${className} pr-8`}
      />
      {/* Pulsante calendario — apre il picker nativo */}
      <button
        type="button"
        onClick={openNativePicker}
        aria-label="Apri calendario"
        title="Apri calendario"
        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-theme-bg-hover text-theme-text-muted hover:text-theme-text-primary transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </button>
      {/* Input nativo nascosto — riceve i clic del bottone calendario.
          Visualmente in posizione ma trasparente: alcuni browser ignorano
          .click() su display:none o visibility:hidden. */}
      <input
        ref={nativeRef}
        type="date"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        max={max}
        tabIndex={-1}
        aria-hidden="true"
        className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 opacity-0 pointer-events-none"
      />
    </div>
  );
};

export default EuropeanDateInput;
