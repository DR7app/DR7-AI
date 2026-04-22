import { createContext, useContext, useState, useEffect } from 'react'
import type { ReactNode } from 'react'

type Theme = 'dark' | 'light'

interface ThemeContextType {
    theme: Theme
    toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }) {
    // The admin panel is light-themed everywhere. Ignoring any legacy value in
    // localStorage (some devices still have 'dark' saved from a previous
    // version) to guarantee a white background on every screen, including
    // mobile Preventivi.
    const [theme, setTheme] = useState<Theme>('light')

    useEffect(() => {
        const root = document.documentElement
        root.classList.remove('light', 'dark')
        root.classList.add(theme)
        // Overwrite any legacy saved value with 'light' so the next reload is
        // consistent even if we re-enable user toggling later.
        localStorage.setItem('dr7-theme', 'light')
    }, [theme])

    // Theme toggling is a no-op for now — admin panel must stay light.
    const toggleTheme = () => {
        setTheme('light')
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
