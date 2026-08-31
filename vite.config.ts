import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Dove vive questa copia del gestionale.
  //   · vuoto  -> sito tutto suo (platform.dr7ai.com)
  //   · '/NOMEAZIENDA/' -> indirizzo dentro dr7ai.com
  // Il valore viene congelato qui dentro al momento della compilazione: e' il
  // motivo per cui ogni azienda ha il suo pacchetto.
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-pdf': ['pdfjs-dist', 'pdf-lib'],
          'vendor-motion': ['framer-motion'],
        },
      },
    },
  },
  server: {
    proxy: {
      '/.netlify/functions': {
        target: 'http://localhost:8888',
        changeOrigin: true,
      }
    }
  }
})
