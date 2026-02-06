import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useTheme } from '../contexts/ThemeContext'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const { theme, toggleTheme } = useTheme()

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
        navigate('/admin')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to sign in')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden bg-theme-bg-primary">

      {/* Theme toggle - top right */}
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
        {/* Main Card */}
        <div className={`bg-theme-bg-primary rounded-2xl px-6 md:px-12 pt-8 md:pt-12 pb-12 md:pb-20 border border-theme-border relative ${theme === 'dark' ? 'shadow-2xl' : ''}`}>

          <div className="relative">
            <div className="flex justify-center mb-4">
              <img src={theme === 'dark' ? '/rentora-dark.jpeg' : '/rentora-light.jpeg'} alt="DR7 Empire" className={`h-48 md:h-72 lg:h-96 w-auto max-w-full object-contain ${theme === 'dark' ? 'drop-shadow-2xl' : 'mix-blend-multiply'}`} />
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-theme-text-primary mb-2">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-full text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:border-dr7-gold focus:ring-2 focus:ring-dr7-gold/20 transition-all duration-200"
                  placeholder="admin@dr7empire.com"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-theme-text-primary mb-2">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
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
                className="w-full bg-dr7-gold hover:bg-yellow-500 text-black font-medium py-3.5 rounded-full transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg tracking-wide uppercase text-sm"
              >
                {loading ? 'Accesso in corso...' : 'Accedi'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
