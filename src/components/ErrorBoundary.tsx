import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  isChunkError: boolean
  errorInfo: string | null
}

/**
 * Detects if an error is related to chunk/module loading failures.
 * These happen when a deploy replaces chunk files while users have stale HTML cached.
 */
function isChunkLoadError(error: Error): boolean {
  const msg = error.message.toLowerCase()
  return (
    msg.includes('failed to fetch dynamically imported module') ||
    msg.includes('loading chunk') ||
    msg.includes('loading css chunk') ||
    msg.includes('mime type') ||
    msg.includes('text/html') ||
    msg.includes('importing a module script') ||
    msg.includes('failed to load module') ||
    // HTML parsed as JS produces syntax errors
    (msg.includes('unexpected token') && msg.includes('<'))
  )
}

const REFRESH_KEY = 'chunk_error_refresh'

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, isChunkError: false, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
      isChunkError: isChunkLoadError(error)
    }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack)
    this.setState({ errorInfo: info.componentStack || null })

    // For chunk errors, attempt ONE automatic hard refresh
    if (isChunkLoadError(error) && !sessionStorage.getItem(REFRESH_KEY)) {
      console.warn('[ErrorBoundary] Chunk load error detected. Auto-refreshing...')
      sessionStorage.setItem(REFRESH_KEY, '1')
      window.location.reload()
      return
    }
  }

  handleRefresh = () => {
    // Clear the refresh guard so next time we can auto-refresh again
    sessionStorage.removeItem(REFRESH_KEY)
    window.location.reload()
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, isChunkError: false, errorInfo: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      // Chunk load error — show specific messaging
      if (this.state.isChunkError) {
        return (
          <div className="min-h-screen flex items-center justify-center bg-gray-900 p-4">
            <div className="bg-gray-800 rounded-xl p-8 max-w-md w-full text-center border border-gray-700">
              <div className="text-4xl mb-4">&#128260;</div>
              <h1 className="text-xl font-bold text-white mb-2">Aggiornamento disponibile</h1>
              <p className="text-gray-400 mb-4 text-sm">
                {"L'applicazione è stata aggiornata. Ricarica la pagina per utilizzare la nuova versione."}
              </p>
              <p className="text-gray-500 text-xs mb-6 font-mono">
                Errore caricamento modulo
              </p>
              <button
                onClick={this.handleRefresh}
                className="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 px-6 rounded-lg transition-colors"
              >
                Aggiorna pagina
              </button>
            </div>
          </div>
        )
      }

      // Generic error
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-900 p-4">
          <div className="bg-gray-800 rounded-xl p-8 max-w-lg w-full text-center border border-gray-700">
            <h1 className="text-xl font-bold text-white mb-2">Errore imprevisto</h1>
            <p className="text-gray-400 mb-4 text-sm">
              Si è verificato un errore. Puoi provare a ripristinare o ricaricare la pagina.
            </p>
            <div className="bg-gray-900 rounded-lg p-3 mb-6 text-left max-h-40 overflow-auto">
              <p className="text-red-400 text-xs font-mono break-all">
                {this.state.error?.message}
              </p>
              {this.state.errorInfo && (
                <p className="text-gray-600 text-xs font-mono mt-2 whitespace-pre-wrap">
                  {this.state.errorInfo.slice(0, 500)}
                </p>
              )}
            </div>
            <div className="flex gap-3 justify-center">
              <button
                onClick={this.handleRetry}
                className="bg-amber-600 hover:bg-amber-700 text-white font-bold py-2 px-6 rounded-lg transition-colors"
              >
                Riprova
              </button>
              <button
                onClick={this.handleRefresh}
                className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-6 rounded-lg transition-colors"
              >
                Ricarica pagina
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
