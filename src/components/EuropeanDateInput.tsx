import React, { useState, useEffect, useRef } from 'react';
import { formattaDataEu, rimettiCursore } from '../utils/dataEuMentreScrivi';

interface EuropeanDateInputProps {
  value: string; // ISO format (YYYY-MM-DD)
  onChange: (value: string) => void; // ISO format (YYYY-MM-DD)
  min?: string; // ISO format (YYYY-MM-DD)
  max?: string; // ISO format (YYYY-MM-DD)
  required?: boolean;
  className?: string;
  name?: string;
  id?: string;
  disabled?: boolean;
  readOnly?: boolean;
  autoFocus?: boolean;
  title?: string;
  placeholder?: string;
  style?: React.CSSProperties;
  wrapperClassName?: string;
  onBlur?: () => void;
  'aria-label'?: string;
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
  id,
  disabled = false,
  readOnly = false,
  autoFocus = false,
  title,
  placeholder = 'GG/MM/AAAA',
  style,
  wrapperClassName = '',
  onBlur,
  'aria-label': ariaLabel,
}) => {
  const [displayValue, setDisplayValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const nativeRef = useRef<HTMLInputElement | null>(null);
  const testoRef = useRef<HTMLInputElement | null>(null);
  // 17/09/2026 (direzione): il calendario del browser si apre sotto l'elemento
  // che lo chiama. Chiamarlo dall'input dell'icona (tutto a destra) lo faceva
  // uscire dalla finestra. Questo input invisibile copre tutto il campo: il
  // calendario compare sotto la data, allineato a sinistra.
  const ancoraRef = useRef<HTMLInputElement | null>(null);

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
    // 21/09/2026: correggere solo il giorno non fa piu' scivolare le cifre
    // ne' saltare il cursore sull'anno (vedi utils/dataEuMentreScrivi.ts).
    const { testo: formatted, caret } = formattaDataEu(e.target.value, e.target.selectionStart);
    setDisplayValue(formatted);
    rimettiCursore(e.target, caret);
    if (formatted.length === 10) {
      const isoDate = europeanToIso(formatted);
      if (isoDate) {
        // 2026-08-03: min/max sono un AVVISO, non un blocco. Prima la data fuori
        // intervallo veniva scartata in silenzio (il campo non si aggiornava e
        // nessuno capiva perche'): regola direzione = mai bloccare, si segnala.
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
    onBlur?.();
  };

  // 2026-08-03 FIX MOBILE: il calendario non si apriva piu' da telefono.
  // Prima l'icona era un <button> che chiamava showPicker() su un input nativo
  // con `pointer-events-none`: su iOS/Android quella chiamata non apre nulla
  // (e il fallback focus()+click() su un elemento non interattivo viene
  // ignorato da Safari mobile). Ora l'input nativo E' il bersaglio del tocco —
  // trasparente sopra l'icona — quindi il telefono apre il suo picker da solo.
  // Su desktop il click chiama comunque showPicker() (Chrome apre il calendario
  // solo cliccando la sua icona interna, qui invisibile).
  const openPickerFromNative = (el: HTMLInputElement | null) => {
    if (!el) return;
    try {
      // showPicker() — Chrome 99+, Safari 16.4+, Firefox 101+
      (el as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
    } catch {
      // Alcuni browser lanciano se non c'e' gesture utente: il tocco diretto
      // sull'input basta comunque ad aprire il picker nativo.
    }
  };

  // 19/09/2026 (direzione): scelto il giorno sul calendario, il calendario si
  // chiude da solo e la data compare subito nel campo. Prima restava aperto con
  // il campo apparentemente VUOTO: la sincronizzazione del testo e' legata a
  // useEffect([value, isFocused]) e veniva saltata perche' il campo era a fuoco,
  // cosi' sembrava che il clic non avesse fatto nulla e si ricliccava (il
  // calendario si riapriva all'infinito). Qui si toglie il fuoco a tutti e tre
  // gli input — e' il fuoco che tiene aperto il popup del browser — e si scrive
  // il testo GG/MM/AAAA senza aspettare l'effetto.
  const applicaDataDalCalendario = (iso: string) => {
    ancoraRef.current?.blur();
    nativeRef.current?.blur();
    testoRef.current?.blur();
    setIsFocused(false);
    setDisplayValue(iso ? isoToEuropean(iso) : '');
    onChange(iso);
  };

  // Il campo eredita la larghezza dal className del chiamante: se è w-full il
  // wrapper deve esserlo anche lui, altrimenti l'inline-flex collassa e il campo
  // diventa più stretto del layout originale (era un <input type="date"> pieno).
  const isFullWidth = /(^|\s)w-full(\s|$)/.test(className);

  // 2026-08-03 (direzione): min/max NON bloccano piu'. Il bubble nativo
  // ("Il valore deve essere 03/08/2026 o successivo") impediva di salvare senza
  // alcun modo di forzare — regola DR7: mai un blocco secco, si avvisa e basta.
  // Quindi: niente min/max sull'input nativo (che li trasformerebbe in
  // constraint validation del browser) e bordo rosso di avviso se fuori range.
  const outOfRange = !!value && ((!!min && value < min) || (!!max && value > max));
  const warnTitle = outOfRange
    ? `Attenzione: data fuori dall'intervallo consigliato${min ? ` (dal ${isoToEuropean(min)}` : ''}${max ? `${min ? ' ' : ' ('}al ${isoToEuropean(max)}` : ''}${min || max ? ')' : ''} — puoi salvare comunque`
    : title;

  return (
    <div className={`relative inline-flex items-center ${isFullWidth ? 'w-full' : ''} ${wrapperClassName}`.trim()}>
      <input
        ref={ancoraRef}
        type="date"
        value={value || ''}
        onChange={(e) => applicaDataDalCalendario(e.target.value)}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        className="absolute left-0 top-0 h-full w-full opacity-0 pointer-events-none"
      />
      <input
        ref={testoRef}
        type="text"
        name={name}
        id={id}
        value={displayValue}
        onChange={handleInputChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        // 23/09/2026 (direzione): il clic sul testo NON apre piu' il calendario.
        // Il calendario del browser prende la tastiera appena si apre, quindi
        // le cifre digitate finivano li' e non si poteva piu' scrivere la data
        // a mano (scheda cliente, documenti, ritiro/riconsegna). Il testo si
        // scrive, il calendario si apre dall'icona a destra.
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        readOnly={readOnly}
        autoFocus={autoFocus}
        title={warnTitle}
        style={style}
        aria-label={ariaLabel}
        maxLength={10}
        inputMode="numeric"
        className={`${className} pr-8${outOfRange ? ' ring-1 ring-orange-400' : ''}`}
      />
      {/* Icona calendario — solo grafica: il tocco lo prende l'input nativo qui
          sotto (pointer-events-none, altrimenti su mobile intercetterebbe il tap). */}
      <span
        aria-hidden="true"
        className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-theme-text-muted pointer-events-none ${disabled ? 'opacity-40' : ''}`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </span>
      {/* Input nativo TRASPARENTE sopra l'icona: e' lui a ricevere il tocco, cosi'
          iOS/Android aprono il loro date picker senza passare da showPicker()
          (che da mobile non apriva niente). Copre solo la zona dell'icona, il
          resto del campo resta digitabile in GG/MM/AAAA. */}
      <input
        ref={nativeRef}
        type="date"
        value={value || ''}
        onChange={(e) => applicaDataDalCalendario(e.target.value)}
        onClick={() => openPickerFromNative(ancoraRef.current)}
        disabled={disabled}
        tabIndex={-1}
        aria-label="Apri calendario"
        title="Apri calendario"
        className="absolute right-0 top-0 h-full w-9 opacity-0 cursor-pointer disabled:cursor-not-allowed"
      />
    </div>
  );
};

export default EuropeanDateInput;
