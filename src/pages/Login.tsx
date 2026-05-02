import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { logAdminAction } from '../utils/logAdminAction'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) throw error

      if (data.session) {
        logAdminAction('login', 'session', undefined, { email })
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
      const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
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
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden bg-theme-bg-primary">

      <div className="w-full max-w-xl relative z-10">
        {/* Login box: matches the new DR7 A.I. logo background (pure black) IN
            BOTH themes — the logo PNG has black bg, so the box stays nero
            anche in light mode per non avere il rettangolo nero spaiato
            sopra a un box bianco. La pagina invece segue il tema. */}
        <div className="rounded-2xl px-6 md:px-12 pt-8 md:pt-12 pb-10 md:pb-14 border border-black relative shadow-2xl shadow-black/30" style={{ backgroundColor: '#000' }}>

          <div className="relative">
            <div className="flex justify-center mb-6">
              <img
                src="/rentora-logo.jpeg"
                alt="DR7 A.I."
                className="h-32 sm:h-40 md:h-48 w-auto max-w-full object-contain"
              />
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-white mb-2">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-3 bg-white/5 border border-white/15 rounded-full text-white placeholder-gray-500 focus:outline-none focus:border-dr7-gold focus:ring-2 focus:ring-dr7-gold/30 transition-all duration-200"
                  placeholder="admin@dr7empire.com"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-white mb-2">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-4 py-3 bg-white/5 border border-white/15 rounded-full text-white placeholder-gray-500 focus:outline-none focus:border-dr7-gold focus:ring-2 focus:ring-dr7-gold/30 transition-all duration-200"
                  placeholder="••••••••"
                />
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/40 text-red-300 px-4 py-3 rounded-full text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full text-white font-medium py-3.5 rounded-full transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg tracking-wide uppercase text-sm bg-gradient-to-r from-primary-dark via-primary to-primary-light hover:opacity-90"
              >
                {loading ? 'Accesso in corso...' : 'Accedi'}
              </button>
            </form>

            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => { setShowForgot(!showForgot); setForgotError(''); setForgotMessage(''); }}
                className="text-sm text-gray-400 hover:text-primary-light transition-colors"
              >
                Password dimenticata?
              </button>
            </div>

            {showForgot && (
              <form onSubmit={handleForgotPassword} className="mt-4 space-y-3">
                <p className="text-sm text-gray-400">
                  Inserisci la tua email per ricevere un link di recupero password.
                </p>
                <input
                  type="email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  required
                  className="w-full px-4 py-3 bg-white/5 border border-white/15 rounded-full text-white placeholder-gray-500 focus:outline-none focus:border-dr7-gold focus:ring-2 focus:ring-dr7-gold/30 transition-all duration-200"
                  placeholder="La tua email"
                />
                {forgotError && (
                  <div className="bg-red-500/10 border border-red-500/40 text-red-300 px-4 py-3 rounded-full text-sm">
                    {forgotError}
                  </div>
                )}
                {forgotMessage && (
                  <div className="bg-green-500/10 border border-green-500/40 text-green-300 px-4 py-3 rounded-full text-sm">
                    {forgotMessage}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={forgotLoading}
                  className="w-full bg-white/5 border border-white/15 hover:border-dr7-gold text-white font-medium py-3 rounded-full transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {forgotLoading ? 'Invio in corso...' : 'Invia link di recupero'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
