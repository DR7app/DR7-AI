/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'dr7-gold': '#2d8a7e',
        'dr7-dark': '#1a1a1a',
        'dr7-darker': '#0f0f0f',
        'theme-bg-primary': 'var(--color-theme-bg-primary)',
        'theme-bg-secondary': 'var(--color-theme-bg-secondary)',
        'theme-bg-tertiary': 'var(--color-theme-bg-tertiary)',
        'theme-bg-hover': 'var(--color-theme-bg-hover)',
        'theme-text-primary': 'var(--color-theme-text-primary)',
        'theme-text-secondary': 'var(--color-theme-text-secondary)',
        'theme-text-muted': 'var(--color-theme-text-muted)',
        'theme-border': 'var(--color-theme-border)',
        'theme-border-light': 'var(--color-theme-border-light)',
        'theme-input-bg': 'var(--color-theme-input-bg)',
        'theme-input-border': 'var(--color-theme-input-border)',
      }
    },
  },
  plugins: [],
}
