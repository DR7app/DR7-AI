import { useState, useRef, useEffect } from 'react'
import type { ReactNode } from 'react'

export type GestisciAction = {
    label: string
    onClick: () => void
    icon?: ReactNode
    disabled?: boolean
    /** Se false la voce non viene renderizzata (gating contestuale). */
    visible?: boolean
}

export type GestisciSection = {
    title?: string
    actions: GestisciAction[]
}

interface Props {
    sections: GestisciSection[]
    /** Etichetta del bottone trigger; default "Gestisci". */
    label?: string
    /** Compatto (per desktop in tabella) vs full (mobile card). */
    size?: 'sm' | 'md'
}

/**
 * Dropdown unico che racchiude tutte le azioni riga di una prenotazione
 * (Modifica, Estendi, Contratto, Fattura, Link Pagamento, Danni & Penali,
 * Cancella). Sostituisce il cluster di pillole multicolore con un singolo
 * trigger ciano + popover che segue il tema attivo (dark / light).
 *
 * Niente colori hardcoded: bg / border / testo passano da variabili
 * Tailwind theme (bg-theme-bg-secondary, ecc.) cosi' lo switcher tema le
 * cambia automaticamente. Solo l'accento ciano del brand (dr7-gold)
 * e' invariato fra i due temi, per design.
 */
export default function GestisciMenu({ sections, label = 'Gestisci', size = 'sm' }: Props) {
    const [open, setOpen] = useState(false)
    const [openUp, setOpenUp] = useState(false)
    const wrapRef = useRef<HTMLDivElement>(null)
    const btnRef = useRef<HTMLButtonElement>(null)

    useEffect(() => {
        if (!open) return
        const onDoc = (e: MouseEvent) => {
            if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
        }
        const onEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false)
        }
        document.addEventListener('mousedown', onDoc)
        document.addEventListener('keydown', onEsc)
        return () => {
            document.removeEventListener('mousedown', onDoc)
            document.removeEventListener('keydown', onEsc)
        }
    }, [open])

    const handleToggle = (e: React.MouseEvent) => {
        e.stopPropagation()
        if (!open && btnRef.current) {
            const r = btnRef.current.getBoundingClientRect()
            const spaceBelow = window.innerHeight - r.bottom
            setOpenUp(spaceBelow < 280)
        }
        setOpen(o => !o)
    }

    const visibleSections = sections
        .map(s => ({ ...s, actions: s.actions.filter(a => a.visible !== false) }))
        .filter(s => s.actions.length > 0)

    if (visibleSections.length === 0) return null

    const trigger = size === 'sm'
        ? 'px-3 py-1.5 text-xs'
        : 'px-4 py-2 text-sm'

    return (
        <div ref={wrapRef} className="relative inline-block">
            <button
                ref={btnRef}
                type="button"
                onClick={handleToggle}
                aria-haspopup="menu"
                aria-expanded={open}
                className={`${trigger} inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap transition-all bg-dr7-gold text-theme-bg-primary hover:bg-dr7-gold/90 active:scale-95`}
            >
                {label}
                <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {open && (
                <div
                    role="menu"
                    onClick={(e) => e.stopPropagation()}
                    className={`absolute right-0 z-50 min-w-[200px] rounded-xl border border-theme-border bg-theme-bg-secondary shadow-2xl py-1 ${openUp ? 'bottom-full mb-2' : 'top-full mt-2'}`}
                >
                    {visibleSections.map((sec, si) => (
                        <div key={si} className={si > 0 ? 'border-t border-theme-border mt-1 pt-1' : ''}>
                            {sec.title && (
                                <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">
                                    {sec.title}
                                </div>
                            )}
                            {sec.actions.map((a, ai) => (
                                <button
                                    key={ai}
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); if (a.disabled) return; setOpen(false); a.onClick() }}
                                    disabled={a.disabled}
                                    role="menuitem"
                                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${
                                        a.disabled
                                            ? 'text-theme-text-muted opacity-50 cursor-not-allowed'
                                            : 'text-theme-text-primary hover:bg-theme-bg-hover hover:text-dr7-gold'
                                    }`}
                                >
                                    {a.icon && <span className="w-4 h-4 flex-shrink-0">{a.icon}</span>}
                                    <span className="flex-1">{a.label}</span>
                                </button>
                            ))}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
