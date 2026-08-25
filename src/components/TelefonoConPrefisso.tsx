/**
 * Campo telefono con prefisso internazionale scelto dalla bandiera.
 *
 * 2026-08-25: un numero scritto a mano parte quasi sempre, ma non arriva.
 * Green API tiene solo le cifre del `chatId`: "347 123 4567" senza prefisso,
 * "0039...", un numero francese digitato come se fosse italiano — l'API
 * risponde comunque OK e il messaggio non viene consegnato a nessuno. Qui il
 * paese si sceglie da una tendina e il valore esce SEMPRE in forma E.164
 * ("+39347..."), l'unica che Green API consegna davvero.
 *
 * La tendina mostra bandiera + prefisso: la bandiera si calcola dal codice
 * ISO (due regional indicator Unicode), non e' scritta come emoji nel
 * sorgente. Il nome del paese resta nel `title` di ogni voce e nel testo di
 * aiuto sotto: su Windows le bandiere non vengono disegnate e resterebbero
 * due lettere, che senza il nome non basterebbero.
 */
import { useEffect, useMemo, useState } from 'react'
import { bandiera, componiNumero, paesiOrdinati, paeseDaNumero, separaPrefisso } from '../utils/prefissiPaesi'

interface Props {
    /** Numero completo memorizzato, es. "+393401234567". */
    value: string | null | undefined
    /** Riceve il numero completo E.164, o stringa vuota se il campo e' vuoto. */
    onChange: (valore: string) => void
    placeholder?: string
    /** Classi dell'input del numero (per non cambiare la grafica del chiamante). */
    className?: string
    /** Classi della tendina del prefisso. */
    selectClassName?: string
    disabled?: boolean
    /** Riga di aiuto sotto al campo con il numero che verra' usato davvero. */
    mostraAnteprima?: boolean
}

export default function TelefonoConPrefisso({
    value,
    onChange,
    placeholder = 'es. 3401234567 (senza prefisso)',
    className = '',
    selectClassName = '',
    disabled = false,
    mostraAnteprima = true,
}: Props) {
    const paesi = useMemo(() => paesiOrdinati(), [])
    const separato = separaPrefisso(value)
    // Il prefisso vive in uno stato suo: svuotando il numero il valore
    // completo diventa '' e senza questo si tornerebbe a +39, perdendo il
    // paese appena scelto.
    const [dial, setDial] = useState(separato.dial)
    useEffect(() => {
        const d = separaPrefisso(value).dial
        if (value && d !== dial) setDial(d)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value])

    const numeroLocale = value ? separato.numero : ''
    const completo = componiNumero(dial, numeroLocale)
    const paese = paeseDaNumero(completo)

    const aggiorna = (nuovoDial: string, nuovoNumero: string) => {
        onChange(componiNumero(nuovoDial, nuovoNumero) || '')
    }

    return (
        <div className="space-y-1">
            <div className="flex items-center gap-2">
                <select
                    value={dial}
                    disabled={disabled}
                    aria-label="Prefisso internazionale"
                    onChange={e => { setDial(e.target.value); aggiorna(e.target.value, numeroLocale) }}
                    className={selectClassName || 'w-[104px] shrink-0 px-2 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-sm text-theme-text-primary'}
                >
                    <optgroup label="Piu' usati">
                        {paesi.frequenti.map(p => (
                            <option key={p.iso} value={p.dial} title={p.nome}>{`${bandiera(p.iso)} ${p.dial}`}</option>
                        ))}
                    </optgroup>
                    <optgroup label="Tutti i paesi">
                        {paesi.altri.map(p => (
                            <option key={p.iso} value={p.dial} title={p.nome}>{`${bandiera(p.iso)} ${p.dial}`}</option>
                        ))}
                    </optgroup>
                </select>
                <input
                    type="tel"
                    inputMode="numeric"
                    disabled={disabled}
                    value={numeroLocale}
                    onChange={e => aggiorna(dial, e.target.value)}
                    placeholder={placeholder}
                    className={className || 'flex-1 min-w-0 px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-sm text-theme-text-primary'}
                />
            </div>
            {mostraAnteprima && (
                <div className="text-[10px] text-theme-text-muted">
                    {completo
                        ? <>Verra&apos; usato <span className="font-mono">{completo}</span>{paese ? ` — ${paese.nome}` : ''}</>
                        : <>Scegli il paese e scrivi il numero senza prefisso e senza lo zero iniziale.</>}
                </div>
            )}
        </div>
    )
}
