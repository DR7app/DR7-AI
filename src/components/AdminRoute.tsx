import { useEffect, useState } from 'react'
import { ScheletroPagina } from './Scheletro'
import { Navigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { leggiRigaAdmin } from '../utils/rigaAdmin'

interface AdminRouteProps {
  children: React.ReactNode
}

export default function AdminRoute({ children }: AdminRouteProps) {
  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)

  useEffect(() => {
    checkAuth()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setAuthorized(false)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function checkAuth() {
    try {
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        setAuthorized(false)
        setLoading(false)
        return
      }

      // 2026-08-18 INCIDENTE: leggere `archived_at` prima che la migrazione
      // fosse eseguita faceva fallire l'INTERA query (colonna inesistente) →
      // admin = null → tutti fuori dal gestionale, direzione compresa.
      // Ora la colonna nuova e' un DI PIU', non una condizione per entrare:
      // se non c'e' ancora, si rilegge senza e si entra come prima.
      //
      // 03/09/2026: la riga arriva da `leggiRigaAdmin`, che la legge una
      // volta sola per tutto l'avvio (prima la chiedevano in quattro). Il
      // ripiego senza `archived_at` e' dentro quella funzione: qui il
      // comportamento non cambia.
      const { riga: admin } = await leggiRigaAdmin(session.user.id)

      // 2026-08-18 (richiesta direzione): un operatore ARCHIVIATO non entra.
      // Prima bastava esistere in `admins` — il campo "Stato" della scheda non
      // era controllato da nessuna parte, quindi un operatore messo
      // "Inattivo" continuava tranquillamente a lavorare nel gestionale.
      // Archiviare conserva riga e storico, ma chiude la porta.
      setAuthorized(!!admin && !admin.archived_at)
    } catch (error) {
      console.error('Auth check error:', error)
      setAuthorized(false)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    // Controllo permessi: dura poche centinaia di millisecondi. Si disegna la
    // forma del gestionale, mai la parola "Loading".
    return (
      <div className="min-h-screen p-6">
        <ScheletroPagina card={4} righe={8} />
      </div>
    )
  }

  if (!authorized) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
