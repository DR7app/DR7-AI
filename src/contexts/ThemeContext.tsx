import { createContext, useContext, useState, useEffect } from 'react'
import type { ReactNode } from 'react'

/**
 * Theme system — split in two axes:
 *
 *   palette  → 'dr7' | 'slate' | 'midnight' | 'graphite'
 *              Brand identity. 'dr7' = existing cyan brand. The others
 *              are professional alternatives (Slate / Midnight / Graphite).
 *   mode     → 'dark' | 'light'
 *              Light vs dark variant of the selected palette.
 *
 * <html> ends up with:
 *   data-palette="X"   (one of the 4 palettes)
 *   class="dark"|"light"
 *
 * index.css defines a `.dark` / `.light` baseline (= DR7) and per-palette
 * overrides via `[data-palette="slate"].dark { ... }` etc.
 *
 * The legacy `theme` field + `toggleTheme()` function are kept so existing
 * call sites that only know about dark/light don't break.
 */

export type Palette = 'dr7' | 'graphite' | 'slate' | 'mono' | 'obsidian' | 'frost' | 'tesla'
export type Mode = 'dark' | 'light'

/**
 * 6 premium themes. Each works in both dark + light.
 * IDs are kept stable (dr7 / graphite / slate / mono) for backward
 * compatibility with users who already had one selected; the legacy
 * IDs (midnight / forest / crimson / plum) are silently mapped to
 * 'dr7' by the validator.
 */
export const PALETTES: { id: Palette; label: string; description: string; inspiration: string }[] = [
    { id: 'dr7',      label: 'DR7 Motion',       description: 'Brand DR7 raffinato, accento ciano.', inspiration: 'Tesla UI · mobility OS' },
    { id: 'graphite', label: 'Graphite Pro',     description: 'Monocromatico esecutivo, ultra clean.', inspiration: 'Apple Pro Apps · Linear' },
    { id: 'slate',    label: 'Slate Enterprise', description: 'Fintech AI, blu professionale.', inspiration: 'Stripe · Bloomberg' },
    { id: 'mono',     label: 'Mono Minimal',     description: 'Bianco e nero puro, timeless.', inspiration: 'Apple · Nothing Tech' },
    { id: 'obsidian', label: 'Obsidian',         description: 'Stealth luxury, titanio nero.', inspiration: 'Aston Martin · executive OS' },
    { id: 'frost',    label: 'Frost AI',         description: 'Vetro futuristico, accento ghiaccio.', inspiration: 'Vision Pro · AI OS' },
    { id: 'tesla',    label: 'Tesla Command',    description: 'Mobility OS, accento azzurro elettrico.', inspiration: 'Tesla vehicle OS · fleet dashboard' },
]

interface ThemeContextType {
    /** @deprecated use `mode` instead. Kept for backward compatibility. */
    theme: Mode
    /** @deprecated use `setMode(mode === 'dark' ? 'light' : 'dark')` instead. */
    toggleTheme: () => void
    palette: Palette
    setPalette: (p: Palette) => void
    mode: Mode
    setMode: (m: Mode) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

// Set di tutti gli id palette validi. Tenuto in sync con il tipo
// Palette via PALETTES.map(). 2026-05-20 BUG FIX: prima accettava
// solo le 4 palette originali (dr7/slate/midnight/graphite), quindi
// scegliere forest/crimson/mono/plum si salvava in localStorage ma
// al refresh il validator scartava il valore e tornava a 'dr7'.
const VALID_PALETTES = new Set<string>(PALETTES.map(p => p.id))

function loadPalette(): Palette {
    if (typeof window === 'undefined') return 'dr7'
    const saved = localStorage.getItem('dr7-palette')
    if (saved && VALID_PALETTES.has(saved)) return saved as Palette
    return 'dr7'
}

function loadMode(): Mode {
    if (typeof window === 'undefined') return 'dark'
    // Legacy key kept for backward compat with the old toggleTheme storage.
    const saved = localStorage.getItem('dr7-mode') || localStorage.getItem('dr7-theme')
    if (saved === 'light' || saved === 'dark') return saved
    const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches
    return prefersLight ? 'light' : 'dark'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [palette, setPaletteState] = useState<Palette>(loadPalette)
    const [mode, setModeState] = useState<Mode>(loadMode)

    useEffect(() => {
        const root = document.documentElement
        root.classList.remove('light', 'dark')
        root.classList.add(mode)
        root.dataset.palette = palette
        localStorage.setItem('dr7-mode', mode)
        localStorage.setItem('dr7-palette', palette)
        // Legacy key — keep in sync so any old reader still picks up the mode.
        localStorage.setItem('dr7-theme', mode)
    }, [palette, mode])

    const setPalette = (p: Palette) => setPaletteState(p)
    const setMode = (m: Mode) => setModeState(m)
    const toggleTheme = () => setModeState(prev => (prev === 'dark' ? 'light' : 'dark'))

    return (
        <ThemeContext.Provider value={{ theme: mode, toggleTheme, palette, setPalette, mode, setMode }}>
            {children}
        </ThemeContext.Provider>
    )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
    const context = useContext(ThemeContext)
    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeProvider')
    }
    return context
}
