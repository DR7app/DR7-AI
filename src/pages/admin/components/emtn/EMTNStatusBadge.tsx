/**
 * EMTNStatusBadge — pill colorata per riskBand, eventStatus o stato OTP.
 * Single source of truth per i colori; gli altri componenti la riusano.
 */
import type { ReactNode } from 'react'

type Variant = 'green' | 'yellow' | 'red' | 'neutral' | 'review' | 'approved' | 'rejected'

const STYLES: Record<Variant, { border: string; bg: string; text: string; dot: string }> = {
    green:    { border: 'border-emerald-500/40', bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400' },
    yellow:   { border: 'border-amber-500/40',   bg: 'bg-amber-500/10',   text: 'text-amber-400',   dot: 'bg-amber-400' },
    red:      { border: 'border-red-500/40',     bg: 'bg-red-500/10',     text: 'text-red-400',     dot: 'bg-red-400' },
    neutral:  { border: 'border-theme-border',   bg: 'bg-theme-bg-tertiary', text: 'text-theme-text-muted', dot: 'bg-theme-text-muted' },
    review:   { border: 'border-amber-500/40',   bg: 'bg-amber-500/10',   text: 'text-amber-400',   dot: 'bg-amber-400' },
    approved: { border: 'border-emerald-500/40', bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400' },
    rejected: { border: 'border-red-500/40',     bg: 'bg-red-500/10',     text: 'text-red-400',     dot: 'bg-red-400' },
}

interface Props {
    variant: Variant
    children?: ReactNode
    pulsing?: boolean
}

export default function EMTNStatusBadge({ variant, children, pulsing }: Props) {
    const s = STYLES[variant]
    return (
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium border ${s.border} ${s.bg} ${s.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${s.dot} ${pulsing ? 'animate-pulse' : ''}`} />
            {children}
        </span>
    )
}

export function statusToVariant(status: string | undefined): Variant {
    switch ((status || '').toUpperCase()) {
        case 'UNDER_REVIEW': return 'review'
        case 'APPROVED':     return 'approved'
        case 'REJECTED':     return 'rejected'
        case 'GREEN':        return 'green'
        case 'YELLOW':       return 'yellow'
        case 'RED':          return 'red'
        default:             return 'neutral'
    }
}
