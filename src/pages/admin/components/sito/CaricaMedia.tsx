import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../../supabaseClient'
import { percorsoStorage } from '../../../../utils/percorsoStorage'

/**
 * Carica un'immagine o un filmato per dr7.app e restituisce il suo indirizzo.
 *
 * 22/09/2026 — ogni campo immagine dell'onglet Sito chiedeva di incollare un
 * percorso (/DR7logo1.png) o un URL: per cambiare il logo serviva qualcuno che
 * mettesse prima il file sul server. Ora il file si sceglie dal computer o dal
 * telefono e il campo si riempie da solo con l'indirizzo pubblico.
 *
 * Bucket `catalog-images`, cartella `sito/`: e' il bucket pubblico gia' usato
 * dal catalogo Terra e dal Noleggio, con le policy di scrittura per lo staff
 * gia' in produzione. Nessuna migrazione da eseguire.
 */
const BUCKET = 'catalog-images'
const MAX_IMMAGINE_MB = 10
const MAX_FILMATO_MB = 50

const RE_IMMAGINE = /\.(jpe?g|png|webp|gif|svg|avif|ico)(\?.*)?$/i
const RE_FILMATO = /\.(mp4|webm|mov|m4v)(\?.*)?$/i

export function eFilmato(v: string): boolean {
    return RE_FILMATO.test((v || '').trim())
}

export function sembraMedia(v: string): boolean {
    const s = (v || '').trim()
    return RE_IMMAGINE.test(s) || RE_FILMATO.test(s) || s.includes('/storage/v1/object/public/')
}

/** Le etichette che annunciano un'immagine, senza prendere "Luogo" o "Logo alt". */
const RE_ETICHETTA = /(immagine|foto\b|fotografia|poster|filmato|video|sfondo|avatar|favicon|\bimage\b|\bphoto\b|\blogo\b(?!.*(alt|sottotitolo|subtitle|testo)))/i

export function etichettaMedia(label: string): boolean {
    return RE_ETICHETTA.test(label || '') && !/\b(alt|testo alternativo)\b/i.test(label || '')
}

/**
 * I percorsi relativi (/DR7logo1.png) puntano ai file del sito, non del
 * gestionale: l'anteprima li deve chiedere a dr7.app, altrimenti resta vuota.
 */
export function indirizzoAnteprima(v: string): string {
    const s = (v || '').trim()
    if (!s) return ''
    if (/^(https?:|data:|blob:)/i.test(s)) return s
    return 'https://dr7.app' + (s.startsWith('/') ? s : '/' + s)
}

async function carica(file: File): Promise<string> {
    const filmato = file.type.startsWith('video/')
    if (!filmato && !file.type.startsWith('image/')) throw new Error('Solo immagini o filmati')
    const max = filmato ? MAX_FILMATO_MB : MAX_IMMAGINE_MB
    if (file.size > max * 1024 * 1024) throw new Error(`File troppo pesante: massimo ${max} MB`)
    const nome = file.name.replace(/[^\w.\-]+/g, '_').slice(-80) || 'file'
    // 26/09/2026 — percorso passato da percorsoStorage: un nome con accenti o spazi
    // faceva rifiutare il file allo storage (incidente firma "Huracán").
    const path = percorsoStorage(`sito/${Date.now()}_${nome}`)
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
        cacheControl: '31536000', upsert: false, contentType: file.type,
    })
    if (error) throw error
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
    if (!data?.publicUrl) throw new Error('Indirizzo pubblico non disponibile')
    return data.publicUrl
}

/** Miniatura + pulsante "Carica". Da mettere accanto a un campo indirizzo. */
export function CaricaMedia({ value, onChange, compatto }: { value: string; onChange: (v: string) => void; compatto?: boolean }) {
    const input = useRef<HTMLInputElement>(null)
    const [inCorso, setInCorso] = useState(false)
    const anteprima = indirizzoAnteprima(value)

    const scegli = async (file: File | undefined) => {
        if (!file) return
        setInCorso(true)
        try {
            const url = await carica(file)
            onChange(url)
            toast.success('File caricato. Ricorda di salvare.')
        } catch (e) {
            toast.error('Caricamento non riuscito: ' + (e as Error).message)
        } finally {
            setInCorso(false)
            if (input.current) input.current.value = ''
        }
    }

    return (
        <div className={`flex items-center gap-2 ${compatto ? '' : 'mt-2'}`}>
            {anteprima && (
                <a href={anteprima} target="_blank" rel="noreferrer" title="Apri il file"
                    className="shrink-0 block h-10 w-14 rounded-md overflow-hidden border border-theme-border bg-[#111]">
                    {eFilmato(value)
                        ? <video src={anteprima} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                        : <img src={anteprima} alt="" className="h-full w-full object-contain" />}
                </a>
            )}
            <button
                type="button"
                disabled={inCorso}
                onClick={() => input.current?.click()}
                className="shrink-0 px-3 py-1.5 rounded-lg border border-theme-border bg-theme-bg-secondary hover:bg-theme-bg-tertiary text-[12px] font-medium text-theme-text-primary disabled:opacity-50"
            >
                {inCorso ? 'Caricamento...' : (value ? 'Sostituisci file' : 'Carica file')}
            </button>
            <input
                ref={input}
                type="file"
                accept="image/*,video/mp4,video/webm,video/quicktime"
                className="hidden"
                onChange={e => scegli(e.target.files?.[0])}
            />
        </div>
    )
}

export default CaricaMedia
