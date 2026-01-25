import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
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
        navigate('/admin')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to sign in')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
      {/* Gradient Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-gray-900 via-black to-gray-800" />

      {/* Subtle overlay pattern */}
      <div className="absolute inset-0 opacity-5" style={{
        backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
        backgroundSize: '40px 40px'
      }} />

      <div className="w-full max-w-xl relative z-10">
        {/* Main Card with Glassmorphism */}
        <div className="bg-black backdrop-blur-xl rounded-2xl shadow-2xl p-12 border border-gray-700/50 relative">
          {/* Subtle glow effect */}
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-dr7-gold/5 via-transparent to-transparent pointer-events-none" />

          <div className="relative">
            <div className="flex justify-center mb-8">
              <img src="/rentora.jpeg" alt="DR7 Empire" className="h-64 drop-shadow-2xl" />
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
                  className="w-full px-4 py-3 bg-gray-800/50 border border-gray-600/50 rounded-full text-white placeholder-gray-500 focus:outline-none focus:border-dr7-gold focus:ring-2 focus:ring-dr7-gold/20 transition-all duration-200"
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
                  className="w-full px-4 py-3 bg-gray-800/50 border border-gray-600/50 rounded-full text-white placeholder-gray-500 focus:outline-none focus:border-dr7-gold focus:ring-2 focus:ring-dr7-gold/20 transition-all duration-200"
                  placeholder="••••••••"
                />
              </div>

              {error && (
                <div className="bg-red-900/30 backdrop-blur-sm border border-red-700/50 text-red-200 px-4 py-3 rounded-full text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-black hover:bg-gray-900 text-white font-medium py-3.5 rounded-full transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg border border-gray-700/50 hover:border-gray-600 tracking-wide uppercase text-sm"
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
