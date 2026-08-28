/**
 * Campo indirizzo: si scrive e cerca da solo.
 *
 * 28/08/2026 (direzione): "PARTOUT dove c'e' un indirizzo deve essere facile
 * come questo". La ricerca (OpenStreetMap) esisteva gia' ma solo su alcune
 * schermate: altrove l'indirizzo si scriveva a mano e usciva inutilizzabile —
 * "QUARTU SANT' ELENA VIA SERRA PERDOSA 25", senza CAP e con il comune
 * davanti alla via. Sono le fatture rimaste bloccate al SDI per settimane.
 *
 * Qui il comportamento completo sta in UN posto solo:
 *  - si sceglie dalla tendina  -> via, civico, CAP, comune e provincia
 *    arrivano gia' nel formato della fattura elettronica;
 *  - si scrive a mano e si esce dal campo -> se il comune si riconosce, il
 *    CAP (e la provincia) si aggiungono da soli;
 *  - con `mostraAvvisoFattura` si dice subito cosa manca, invece di
 *    scoprirlo settimane dopo quando la fattura non parte.
 */
import toast from 'react-hot-toast'
import AddressAutocomplete from '../pages/admin/components/AddressAutocomplete'
import { completaIndirizzo, cosaMancaNellIndirizzo } from '../utils/indirizzoFattura'
import { getProvinciaByCity } from '../data/sardegnaProvince'

interface Props {
    value: string
    onChange: (valore: string) => void
    placeholder?: string
    className?: string
    label?: string
    required?: boolean
    disabled?: boolean
    /** Riga rossa "non basta per la fattura elettronica" sotto al campo. */
    mostraAvvisoFattura?: boolean
    /** Nome del campo nel toast del CAP automatico ("sede operativa", ...). */
    nomeCampo?: string
}

export default function CampoIndirizzo({
    value,
    onChange,
    placeholder = 'Via Roma 12, 09100 Cagliari (CA)',
    className = '',
    label,
    required,
    disabled,
    mostraAvvisoFattura = false,
    nomeCampo = 'indirizzo',
}: Props) {
    const manca = mostraAvvisoFattura && value.trim() !== '' ? cosaMancaNellIndirizzo(value) : null

    return (
        <>
            <AddressAutocomplete
                value={value}
                onChange={onChange}
                label={label}
                required={required}
                disabled={disabled}
                className={className}
                placeholder={placeholder}
                onSelectParts={(parts) => {
                    const riga2 = [parts.zip || '', parts.city || ''].filter(Boolean).join(' ')
                    // Nominatim dà il NOME della provincia ("Sassari",
                    // "Sud Sardegna"): la fattura vuole la sigla (SS, SU).
                    // Tagliare le prime due lettere darebbe "SA" per Sassari.
                    const grezza = (parts.province || '').toUpperCase()
                    const prov = getProvinciaByCity(parts.city) || (/^[A-Z]{2}$/.test(grezza) ? grezza : '')
                    const completo = [
                        parts.street || parts.full,
                        riga2 ? `${riga2}${prov ? ` (${prov})` : ''}` : '',
                    ].filter(Boolean).join(', ')
                    onChange(completo || parts.full)
                }}
                onBlurComplete={(val) => {
                    const esito = completaIndirizzo(val)
                    if (esito.cambiato) {
                        onChange(esito.indirizzo)
                        toast.success(`CAP di ${esito.comune} aggiunto (${nomeCampo})`)
                    }
                }}
            />
            {manca && (
                <p className="text-[11px] text-rose-400 mt-1">
                    Non basta per la fattura elettronica: {manca}. Formato: "Via Roma 12, 09100 Cagliari (CA)".
                </p>
            )}
        </>
    )
}
