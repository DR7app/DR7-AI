import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Sigla della pubblicazione, appesa al nome di ogni file compilato. Su
// Netlify e' l'id del deploy; in locale il momento della compilazione.
const MARCHIO_BUILD = (
  process.env.DEPLOY_ID || process.env.COMMIT_REF || Date.now().toString(36)
).slice(0, 8)

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
        // 07/09/2026 — Ogni pubblicazione ha i SUOI indirizzi: due deploy non
        // riusano mai lo stesso nome di file.
        //
        // Perche': quando un file non esiste, Netlify risponde con la pagina
        // HTML e l'intestazione "immutable, un anno". Il browser si tiene
        // quella risposta sbagliata sotto quell'indirizzo. Finche' i nomi
        // cambiano non succede niente; ma un revert ripubblica contenuto
        // identico, quindi hash identico, quindi lo STESSO indirizzo: il
        // browser serve la pagina HTML al posto del programma e la scheda
        // resta morta per sempre (nemmeno il login si apre). E' successo il
        // 07/09/2026 con assets/index-DCCRui_v.js, ripubblicato dal revert
        // delle 09:25 dopo essere gia' mancato alle 07:39.
        entryFileNames: `assets/[name]-[hash]-${MARCHIO_BUILD}.js`,
        chunkFileNames: `assets/[name]-[hash]-${MARCHIO_BUILD}.js`,
        assetFileNames: `assets/[name]-[hash]-${MARCHIO_BUILD}[extname]`,
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
