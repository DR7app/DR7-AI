import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useTheme } from '../contexts/ThemeContext'
import { regolePassword, errorePassword } from '../utils/passwordPolicy'
import { risorsa } from '../utils/basePath'

export default function ResetPassword() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const navigate = useNavigate()
  const { theme, toggleTheme } = useTheme()

  useEffect(() => {
    // Check URL hash for recovery token (handles race condition where event fires before listener).
    // type=invite covers Supabase's inviteUserByEmail flow used by Aggiungi Operatore.
    const hash = window.location.hash
    if (hash && (hash.includes('type=recovery') || hash.includes('type=magiclink') || hash.includes('type=invite'))) {
      setReady(true)
    }

    // 2026-08-25: link generato da netlify/functions/request-password-reset.ts.
    // Arriva come ?token_hash=...&type=recovery invece del solito frammento
    // #access_token: il token non e' ancora una sessione, va scambiato qui con
    // verifyOtp (che parla con Supabase via SDK, senza passare da
    // /auth/v1/verify e quindi senza dipendere dalla Site URL del dashboard).
    const params = new URLSearchParams(window.location.search)
    const tokenHash = params.get('token_hash')
    const tipo = params.get('type')
    if (tokenHash && (tipo === 'recovery' || tipo === 'invite' || tipo === 'magiclink')) {
      supabase.auth
        .verifyOtp({ token_hash: tokenHash, type: tipo })
        .then(({ error: verifyError }) => {
          if (verifyError) {
            setError('Link non valido o scaduto. Richiedi una nuova email di recupero.')
            return
          }
          setReady(true)
          // Il token e' monouso: via dall'URL, cosi' un refresh non lo ripropone
          // e non resta nella cronologia del browser.
          window.history.replaceState({}, '', window.location.pathname)
        })
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setReady(true)
      }
    })

    // Also check if there's already a session (user clicked the link and was auto-logged in)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setReady(true)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Le password non corrispondono')
      return
    }

    // 2026-08-25 (richiesta direzione): maiuscola + numero + simbolo, non piu'
    // solo la lunghezza. Il messaggio dice cosa manca, non "password non valida".
    const mancante = errorePassword(password)
    if (mancante) {
      setError(mancante)
      return
    }

    setLoading(true)

    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      navigate('/admin')
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      setError(_errMsg || 'Errore durante l\'aggiornamento della password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden bg-theme-bg-primary">

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className="absolute top-6 right-6 z-20 p-2 text-theme-text-muted hover:text-theme-text-primary transition-colors"
        title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        aria-label="Toggle theme"
      >
        {theme === 'dark' ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        ) : (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
          </svg>
        )}
      </button>

      <div className="w-full max-w-xl relative z-10">
        <div className={`bg-theme-bg-primary rounded-2xl px-6 md:px-12 pt-8 md:pt-12 pb-12 md:pb-20 border border-theme-border relative ${theme === 'dark' ? 'shadow-2xl' : ''}`}>

          <div className="relative">
            {/* 2026-08-25: qui c'era ancora il logo Rentora (rentora-dark /
                rentora-light .jpeg), cioe' il marchio vecchio, mentre il Login
                mostra gia' dr7-logo.png. Chi reimpostava la password vedeva un
                marchio che non esiste piu'. Stesso file e stesso trattamento
                del Login: PNG trasparente, una sola immagine per i due temi. */}
            <div className="flex justify-center mb-6">
              <img
                src={risorsa("dr7-logo.png")}
                alt="DR7 A.I."
                className="h-14 sm:h-16 w-auto max-w-[200px] object-contain"
              />
            </div>

            <h2 className="text-xl font-semibold text-theme-text-primary text-center mb-6">
              Reimposta Password
            </h2>

            {!ready ? (
              <div className="text-center space-y-4">
                {/* Il link scaduto/gia' usato va detto qui: il riquadro rosso
                    del form non e' ancora montato, senza questo l'utente
                    resterebbe su "Caricamento in corso" per sempre. */}
                {error ? (
                  <div className="bg-red-500/10 border border-red-500/30 text-red-500 px-4 py-3 rounded-full text-sm">
                    {error}
                  </div>
                ) : (
                  <p className="text-theme-text-muted text-sm">
                    Caricamento in corso... Se non vieni reindirizzato, il link potrebbe essere scaduto.
                  </p>
                )}
                <button
                  onClick={() => navigate('/login')}
                  className="text-sm text-dr7-gold hover:underline"
                >
                  Torna al login
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5" autoComplete="off">
                <div>
                  <label htmlFor="new-password" className="block text-sm font-medium text-theme-text-primary mb-2">
                    Nuova Password
                  </label>
                  <input
                    id="new-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-full text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:border-dr7-gold focus:ring-2 focus:ring-dr7-gold/20 transition-all duration-200"
                    placeholder="••••••••"
                  />
                  {/* Checklist viva: si vede subito cosa manca invece di
                      scoprirlo dopo aver premuto il bottone. */}
                  <ul className="mt-3 space-y-1">
                    {regolePassword(password).map(r => (
                      <li key={r.id} className={`flex items-center gap-2 text-xs ${r.ok ? 'text-emerald-500' : 'text-theme-text-muted'}`}>
                        <span aria-hidden="true" className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] leading-none ${r.ok ? 'border-emerald-500 bg-emerald-500/10' : 'border-theme-border'}`}>
                          {r.ok ? '\u2713' : ''}
                        </span>
                        {r.testo}
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <label htmlFor="confirm-password" className="block text-sm font-medium text-theme-text-primary mb-2">
                    Conferma Password
                  </label>
                  <input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-full text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:border-dr7-gold focus:ring-2 focus:ring-dr7-gold/20 transition-all duration-200"
                    placeholder="••••••••"
                  />
                </div>

                {error && (
                  <div className="bg-red-500/10 border border-red-500/30 text-red-500 px-4 py-3 rounded-full text-sm">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-dr7-gold hover:bg-[#0A8FA3] text-white font-medium py-3.5 rounded-full transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg tracking-wide uppercase text-sm"
                >
                  {loading ? 'Aggiornamento in corso...' : 'Aggiorna Password'}
                </button>
              </form>
            )}

            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="text-sm text-theme-text-muted hover:text-dr7-gold transition-colors"
              >
                Torna al login
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
