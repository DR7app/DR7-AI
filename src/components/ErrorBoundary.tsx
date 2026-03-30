import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: string | null
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error)
    console.error('Component stack:', info.componentStack)
    this.setState({ errorInfo: info.componentStack || null })
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

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
                onClick={() => window.location.reload()}
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
