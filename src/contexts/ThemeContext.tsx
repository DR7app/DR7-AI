import { createContext, useContext, useState, useEffect } from 'react'
import type { ReactNode } from 'react'

type Theme = 'dark' | 'light'

interface ThemeContextType {
    theme: Theme
    toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }) {
    // Two themes con switcher: 'dark' = black DR7, 'light' = white DR7.
    // Default = dark (matches il nuovo brand); preferenza salvata in
    // localStorage 'dr7-theme'. Se non c'e' nulla salvato, prova
    // prefers-color-scheme; in fallback restiamo su dark.
    const [theme, setTheme] = useState<Theme>(() => {
        if (typeof window === 'undefined') return 'dark'
        const saved = localStorage.getItem('dr7-theme')
        if (saved === 'light' || saved === 'dark') return saved
        const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches
        return prefersLight ? 'light' : 'dark'
    })

    useEffect(() => {
        const root = document.documentElement
        root.classList.remove('light', 'dark')
        root.classList.add(theme)
        localStorage.setItem('dr7-theme', theme)
    }, [theme])

    const toggleTheme = () => {
        setTheme(prev => (prev === 'dark' ? 'light' : 'dark'))
    }

    return (
        <ThemeContext.Provider value={{ theme, toggleTheme }}>
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
