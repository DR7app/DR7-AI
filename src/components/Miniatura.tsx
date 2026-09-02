import { useState } from 'react'

/**
 * Miniatura di un'immagine di Supabase Storage.
 *
 * Le foto dei veicoli sono PNG da due a quattro megabyte: a schermo finiscono
 * dentro riquadri da poche decine di pixel, ma il browser scaricava comunque
 * l'originale. La sola tab Veicoli si portava dietro 40 MB a ogni apertura.
 *
 * Supabase sa ridimensionare da solo: basta chiedere `/render/image/public/`
 * invece di `/object/public/`. Stessa immagine, 89 KB invece di 4 MB.
 *
 * Se il ridimensionamento non e' disponibile (piano senza trasformazioni, URL
 * che non e' di Supabase) si ricade sull'originale: meglio un'immagine pesante
 * che un riquadro vuoto.
 */
export function urlMiniatura(url: string, larghezza: number, qualita = 60): string {
    if (!url || !url.includes('/storage/v1/object/public/')) return url
    const base = url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/')
    return `${base}${base.includes('?') ? '&' : '?'}width=${larghezza}&quality=${qualita}&resize=contain`
}

interface Props {
    src: string
    alt?: string
    /** Larghezza richiesta a Supabase, in pixel. */
    larghezza: number
    className?: string
    title?: string
}

export default function Miniatura({ src, alt = '', larghezza, className, title }: Props) {
    const [originale, setOriginale] = useState(false)
    return (
        <img
            src={originale ? src : urlMiniatura(src, larghezza)}
            alt={alt}
            title={title}
            loading="lazy"
            decoding="async"
            className={className}
            onError={() => { if (!originale) setOriginale(true) }}
        />
    )
}
