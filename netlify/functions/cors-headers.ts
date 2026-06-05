/**
 * Shared CORS headers utility for Netlify functions.
 * Replaces wildcard '*' CORS with explicit origin whitelist.
 */

const ALLOWED_ORIGINS = [
  // 2026-06-05: migrazione dominio. Admin -> dr7ai.com, sito -> dr7.app.
  // Aggiunti A FIANCO dei vecchi così entrambi funzionano durante la
  // transizione. dr7.app deve essere qui perché il SITO chiama funzioni
  // dell'admin (post-booking-webhook, nexi-pay-by-link).
  'https://dr7ai.com',
  'https://www.dr7ai.com',
  'https://dr7.app',
  'https://www.dr7.app',
  'https://admin.dr7empire.com',
  'https://dr7empire.com',
  'https://www.dr7empire.com',
  'http://localhost:5173',
  'http://localhost:8888',
]

export function getCorsOrigin(requestOrigin: string | undefined): string {
  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) {
    return requestOrigin
  }
  return ALLOWED_ORIGINS[0]
}

export function corsHeaders(requestOrigin?: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': getCorsOrigin(requestOrigin),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json',
  }
}
