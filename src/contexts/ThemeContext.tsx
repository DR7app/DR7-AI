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

export type Palette = 'dr7' | 'slate' | 'midnight' | 'graphite'
export type Mode = 'dark' | 'light'

export const PALETTES: { id: Palette; label: string; description: string }[] = [
    { id: 'dr7', label: 'DR7', description: 'Brand DR7 originale, accento ciano.' },
    { id: 'slate', label: 'Slate', description: 'Grigio-blu neutro, professionale.' },
    { id: 'midnight', label: 'Midnight', description: 'Navy profondo + indaco.' },
    { id: 'graphite', label: 'Graphite', description: 'Grigio caldo, accento teal.' },
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

function loadPalette(): Palette {
    if (typeof window === 'undefined') return 'dr7'
    const saved = localStorage.getItem('dr7-palette')
    if (saved === 'dr7' || saved === 'slate' || saved === 'midnight' || saved === 'graphite') {
        return saved
    }
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
