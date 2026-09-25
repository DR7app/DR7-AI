import { useEffect } from 'react'
import { useParams } from 'react-router-dom'

/**
 * 25/09/2026 — La firma si fa solo su dr7trust.com: un vecchio link /firma/<token>
 * aperto qui viene girato li', dove valgono dispositivo, OTP e audit trail.
 */
export default function FirmaPage() {
    const { token } = useParams<{ token: string }>()
    useEffect(() => {
        window.location.replace(`https://dr7trust.com/firma/${encodeURIComponent(token || '')}`)
    }, [token])
    return null
}
