/**
 * Server SMTP della PEC mittente (26/08/2026).
 *
 * Stava scritto solo dentro `process-multa.ts`: la schermata "Prova
 * connessione" di Centralina Pro doveva usare per forza lo stesso server
 * dell'invio vero, altrimenti direbbe "funziona" testando un'altra casella.
 *
 * Il server dipende dal PROVIDER, non dall'azienda: la casella Legalmail non
 * si autentica sul server di Aruba e viceversa. Si ricava dal dominio; se il
 * dominio non e' noto resta Legalmail (la casella storica DR7).
 */
/** Porta di default: SMTPS implicito, quella che usano tutti i provider PEC. */
export const PEC_PORT = 465

const PROVIDER_HOSTS: Array<{ match: RegExp; host: string; nome: string }> = [
  { match: /legalmail\.it$/i, host: 'sendm.cert.legalmail.it', nome: 'Legalmail (InfoCert)' },
  { match: /(^|\.)pec\.it$/i, host: 'smtps.pec.aruba.it', nome: 'Aruba PEC' },
  { match: /arubapec\.it$/i, host: 'smtps.pec.aruba.it', nome: 'Aruba PEC' },
  { match: /pec\.aruba\.it$/i, host: 'smtps.pec.aruba.it', nome: 'Aruba PEC' },
  { match: /postecert\.it$/i, host: 'mail.postecert.it', nome: 'Postecert (Poste Italiane)' },
  { match: /pec\.poste\.it$/i, host: 'mail.postecert.it', nome: 'Postecert (Poste Italiane)' },
  { match: /sicurezzapostale\.it$/i, host: 'smtps.sicurezzapostale.it', nome: 'Sicurezza Postale' },
  { match: /pec\.register\.it$/i, host: 'smtps.pec.register.it', nome: 'Register.it' },
  { match: /(pec\.)?namirial\.it$/i, host: 'smtps.pec.namirial.it', nome: 'Namirial' },
]

const DEFAULT_HOST = 'sendm.cert.legalmail.it'

/** Server SMTP da usare per la casella indicata. */
export function pecHostFor(mittente: string): string {
  const dominio = String(mittente || '').trim().toLowerCase().split('@')[1] || ''
  return PROVIDER_HOSTS.find(p => p.match.test(dominio))?.host || DEFAULT_HOST
}

/** Nome leggibile del provider, per i messaggi di errore. */
export function pecProviderFor(mittente: string): string {
  const dominio = String(mittente || '').trim().toLowerCase().split('@')[1] || ''
  return PROVIDER_HOSTS.find(p => p.match.test(dominio))?.nome || 'provider sconosciuto (uso Legalmail)'
}
