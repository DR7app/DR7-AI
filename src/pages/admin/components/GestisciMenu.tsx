import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
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

const GUTTER = 8
/** Altezza minima utile del pannello: sotto questa si apre dall'altro lato. */
const MIN_PANEL = 180
/** Larghezza di fallback finche' il pannello non e' montato e misurabile. */
const MIN_WIDTH = 200

export type Coords = {
    top: number
    right: number
    maxHeight: number
    maxWidth: number
}

export const sameCoords = (a: Coords, b: Coords) =>
    a.top === b.top && a.right === b.right
    && a.maxHeight === b.maxHeight && a.maxWidth === b.maxWidth

/**
 * Posizione del pannello a partire dal rettangolo del trigger.
 *
 * Funzione pura, fuori dal componente, perche' e' la parte che si rompeva
 * su telefono e l'unica verificabile senza un DOM: vedi
 * GestisciMenu.test.ts.
 *
 * Regole:
 * - 2026-08-31: il pannello si vede SEMPRE intero, senza scorrerlo. Prima
 *   veniva schiacciato nello spazio libero sotto (o sopra) al bottone e con
 *   nove voci restava una lista da scorrere: ora, se sotto non ci sta tutto,
 *   si prova sopra, e se non basta nemmeno sopra si alza quanto serve per
 *   entrare nello schermo. Il bottone resta comunque scoperto o coperto solo
 *   di striscio, ma le voci si leggono tutte in un colpo;
 * - si scorre solo nel caso limite in cui il pannello e' piu' alto dello
 *   schermo intero (viewport bassissima): li' non esiste posizione che lo
 *   faccia entrare;
 * - ancoraggio orizzontale a destra del trigger, ma mai oltre i bordi.
 */
export function computeCoords(
    r: { top: number; bottom: number; right: number },
    vw: number,
    vh: number,
    panelWidth: number,
    panelHeight: number,
): Coords {
    const disponibile = vh - GUTTER * 2
    // Altezza che il pannello occupera' davvero: la sua, o al massimo tutto
    // lo schermo utile (oltre quella soglia scorre, non c'e' alternativa).
    const altezza = Math.min(panelHeight || MIN_PANEL, disponibile)

    const width = Math.min(panelWidth, vw - GUTTER * 2)
    const right = Math.min(Math.max(GUTTER, vw - r.right), vw - width - GUTTER)

    // Sotto al bottone se ci sta tutto; altrimenti sopra; altrimenti
    // appoggiato al bordo basso, alzandosi finche' entra per intero.
    let top = r.bottom + GUTTER
    if (top + altezza > vh - GUTTER) {
        const sopra = r.top - GUTTER - altezza
        top = sopra >= GUTTER ? sopra : Math.max(GUTTER, vh - GUTTER - altezza)
    }

    return {
        top,
        right,
        maxHeight: disponibile,
        maxWidth: vw - GUTTER * 2,
    }
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
    // Coordinate viewport calcolate dal trigger. Il menu viene poi
    // renderizzato in un Portal con position: fixed cosi' sfugge a
    // qualunque overflow:auto/hidden in un antenato (es. la tabella
    // Prenotazioni Noleggio ha overflow-x-auto sul wrapper, e per
    // la spec CSS basta UN asse 'auto' per clippare anche l'altro
    // — il dropdown 'absolute' rimaneva tagliato dentro la riga).
    const [coords, setCoords] = useState<Coords | null>(null)
    const wrapRef = useRef<HTMLDivElement>(null)
    const btnRef = useRef<HTMLButtonElement>(null)
    const menuRef = useRef<HTMLDivElement>(null)

    function recalcCoords() {
        if (!btnRef.current) return
        const next = computeCoords(
            btnRef.current.getBoundingClientRect(),
            window.innerWidth,
            window.innerHeight,
            // Larghezza reale una volta montato il pannello; prima di allora
            // una stima, corretta al giro successivo di useLayoutEffect.
            menuRef.current?.offsetWidth || MIN_WIDTH,
            // scrollHeight e non offsetHeight: e' l'altezza VERA del
            // contenuto, quella che il pannello vorrebbe avere, anche
            // quando il maxHeight lo sta gia' tagliando.
            menuRef.current?.scrollHeight || MIN_PANEL,
        )
        // Confronto prima di scrivere: recalcCoords gira anche dopo il
        // montaggio del pannello (per misurarne la larghezza) e senza questo
        // guard il setState si riaccenderebbe all'infinito.
        setCoords(prev => (prev && sameCoords(prev, next)) ? prev : next)
    }

    useEffect(() => {
        if (!open) return
        // pointerdown e non mousedown: su iOS il tap su un elemento non
        // interattivo (lo sfondo di una card) puo' non emettere mousedown e
        // il menu restava aperto sopra la lista.
        const onDoc = (e: Event) => {
            const target = e.target as Node
            if (wrapRef.current?.contains(target)) return
            if (menuRef.current?.contains(target)) return
            setOpen(false)
        }
        const onEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false)
        }
        // Riposiziona se l'utente scrolla la pagina o la tabella —
        // 'true' come terzo arg cattura anche gli scroll dei figli.
        const onReposition = () => recalcCoords()
        document.addEventListener('pointerdown', onDoc)
        document.addEventListener('keydown', onEsc)
        window.addEventListener('scroll', onReposition, true)
        window.addEventListener('resize', onReposition)
        return () => {
            document.removeEventListener('pointerdown', onDoc)
            document.removeEventListener('keydown', onEsc)
            window.removeEventListener('scroll', onReposition, true)
            window.removeEventListener('resize', onReposition)
        }
    }, [open])

    // Calcola le coords prima del paint, per evitare un flash a (0,0).
    // Senza array di dipendenze: il primo giro stima la larghezza, il
    // secondo la misura sul pannello ormai montato. Converge subito perche'
    // setCoords non scrive se il risultato e' identico.
    useLayoutEffect(() => {
        if (open) recalcCoords()
    })

    const handleToggle = (e: React.MouseEvent) => {
        e.stopPropagation()
        setOpen(o => !o)
    }

    const visibleSections = sections
        .map(s => ({ ...s, actions: s.actions.filter(a => a.visible !== false) }))
        .filter(s => s.actions.length > 0)

    if (visibleSections.length === 0) return null

    const trigger = size === 'sm'
        ? 'px-3 py-1.5 text-xs'
        : 'px-4 py-2 text-sm'
    // Voci piu' alte nel menu mobile: py-2 dava un bersaglio da 32px, sotto
    // i 44px di area toccabile e con le voci una addosso all'altra.
    const item = size === 'sm' ? 'py-2' : 'py-3'

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

            {open && coords && createPortal(
                <div
                    ref={menuRef}
                    role="menu"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                        position: 'fixed',
                        top: coords.top,
                        right: coords.right,
                        maxHeight: coords.maxHeight,
                        maxWidth: coords.maxWidth,
                        overflowY: 'auto',
                        // Su mobile evita che lo scroll del pannello trascini
                        // la lista sotto quando si arriva a fine corsa.
                        overscrollBehavior: 'contain',
                        zIndex: 9999,
                    }}
                    className="min-w-[200px] rounded-xl border border-theme-border bg-theme-bg-secondary shadow-2xl py-1"
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
                                    className={`w-full flex items-center gap-2.5 px-3 text-sm text-left transition-colors ${item} ${
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
                </div>,
                document.body
            )}
        </div>
    )
}
