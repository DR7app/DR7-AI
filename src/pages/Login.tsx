import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { logAdminAction } from '../utils/logAdminAction'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showForgot, setShowForgot] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotMessage, setForgotMessage] = useState('')
  const [forgotError, setForgotError] = useState('')
  const navigate = useNavigate()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      // Mobile keyboards (iOS especially) auto-capitalize the first letter
      // and may insert trailing spaces. Supabase auth.email is case-sensitive
      // for lookup, so always normalize before sending.
      const normalizedEmail = email.trim().toLowerCase()
      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      })

      if (error) throw error

      if (data.session) {
        logAdminAction('login', 'session', undefined, { email: normalizedEmail })
        navigate('/admin')
      }
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to sign in')
    } finally {
      setLoading(false)
    }
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault()
    setForgotError('')
    setForgotMessage('')
    setForgotLoading(true)

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail.trim().toLowerCase(), {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (error) throw error
      setForgotMessage('Email di recupero inviata. Controlla la tua casella di posta.')
    } catch (err: unknown) {
      setForgotError((err as Error).message || 'Errore durante l\'invio dell\'email di recupero')
    } finally {
      setForgotLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8 relative overflow-hidden bg-theme-bg-primary">

      <div className="w-full max-w-md relative z-10">
        {/* Box login: SEGUE il tema. Light = bianco con testo scuro,
            dark = nero con testo chiaro. Il logo usa la classe
            theme-aware-logo (filter invert+hue-rotate in light) cosi'
            lo stesso PNG funziona in entrambi i temi. */}
        <div className="rounded-2xl px-6 sm:px-10 pt-10 pb-8 border border-dr7-gold/40 relative shadow-2xl shadow-dr7-gold/10 bg-theme-bg-primary">
          {/* Logo */}
          <div className="flex justify-center mb-8">
            <img
              src="/rentora-logo.jpeg"
              alt="DR7 A.I."
              className="theme-aware-logo h-32 sm:h-36 w-auto max-w-full object-contain"
            />
          </div>

          {!showForgot ? (
            <form onSubmit={handleSubmit} className="space-y-5" autoComplete="off">
              {/* Email */}
              <div>
                <label htmlFor="email" className="block text-[11px] font-bold uppercase tracking-wider text-dr7-gold mb-2">
                  Email
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-dr7-gold pointer-events-none">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </span>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="off"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    inputMode="email"
                    className="w-full pl-11 pr-4 py-3 bg-theme-bg-secondary border border-theme-border rounded-xl text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:border-dr7-gold focus:ring-2 focus:ring-dr7-gold/20 focus:bg-theme-bg-tertiary transition-all"
                    placeholder="admin@dr7empire.com"
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label htmlFor="password" className="block text-[11px] font-bold uppercase tracking-wider text-dr7-gold mb-2">
                  Password
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-dr7-gold pointer-events-none">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <rect x="5" y="11" width="14" height="10" rx="2" strokeLinecap="round" strokeLinejoin="round" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 11V7a4 4 0 118 0v4" />
                    </svg>
                  </span>
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    // No autofill / no save — admin shared accounts su
                    // device condivisi non devono lasciare credenziali
                    // memorizzate dal browser. autoComplete="off" + opt-out
                    // espliciti per i password manager piu' diffusi.
                    autoComplete="off"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    className="w-full pl-11 pr-12 py-3 bg-theme-bg-secondary border border-theme-border rounded-xl text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:border-dr7-gold focus:ring-2 focus:ring-dr7-gold/20 focus:bg-theme-bg-tertiary transition-all"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(s => !s)}
                    aria-label={showPassword ? 'Nascondi password' : 'Mostra password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-dr7-gold transition-colors p-1"
                  >
                    {showPassword ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M1 1l22 22" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
                <div className="text-right mt-1.5">
                  <button
                    type="button"
                    onClick={() => { setShowForgot(true); setForgotError(''); setForgotMessage(''); setForgotEmail(email) }}
                    className="text-xs text-dr7-gold hover:text-primary-light transition-colors"
                  >
                    Password dimenticata?
                  </button>
                </div>
              </div>

              {error && (
                <div className="text-sm text-theme-error px-4 py-2.5 rounded-xl border border-theme-error/30 bg-theme-error/5">
                  {error}
                </div>
              )}

              {/* ACCEDI */}
              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 text-white font-bold py-3.5 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-dr7-gold/30 tracking-wider uppercase text-sm bg-gradient-to-r from-primary-dark via-primary to-primary-light hover:shadow-dr7-gold/50 active:scale-[0.99]"
              >
                {loading ? 'Accesso in corso...' : 'Accedi'}
                {!loading && (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <p className="text-sm text-theme-text-muted">
                Inserisci la tua email per ricevere un link di recupero password.
              </p>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-dr7-gold pointer-events-none">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </span>
                <input
                  type="email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  required
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  inputMode="email"
                  className="w-full pl-11 pr-4 py-3 bg-white/[0.04] border border-white/10 rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-dr7-gold focus:ring-2 focus:ring-dr7-gold/20 focus:bg-white/[0.06] transition-all"
                  placeholder="La tua email"
                />
              </div>
              {forgotError && (
                <div className="text-sm text-theme-error px-4 py-2.5 rounded-xl border border-theme-error/30 bg-theme-error/5">
                  {forgotError}
                </div>
              )}
              {forgotMessage && (
                <div className="text-sm text-theme-success px-4 py-2.5 rounded-xl border border-theme-success/30 bg-theme-success/5">
                  {forgotMessage}
                </div>
              )}
              <button
                type="submit"
                disabled={forgotLoading}
                className="w-full text-white font-bold py-3 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm tracking-wider uppercase bg-gradient-to-r from-primary-dark via-primary to-primary-light hover:opacity-95"
              >
                {forgotLoading ? 'Invio in corso...' : 'Invia link di recupero'}
              </button>
              <button
                type="button"
                onClick={() => { setShowForgot(false); setForgotError(''); setForgotMessage('') }}
                className="w-full text-xs text-theme-text-muted hover:text-dr7-gold transition-colors py-1"
              >
                ← Torna al login
              </button>
            </form>
          )}

          {/* Footer secure note */}
          <div className="mt-8 pt-5 border-t border-theme-border flex items-center justify-center gap-2 text-[11px] text-theme-text-muted">
            <svg className="w-3.5 h-3.5 text-dr7-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M12 21a9 9 0 100-18 9 9 0 000 18z" />
            </svg>
            <span>Accesso sicuro e protetto</span>
          </div>
        </div>
      </div>
    </div>
  )
}
