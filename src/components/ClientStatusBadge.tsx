import { avvisoClasses } from '../utils/clientStatusConfig'
import {
  DR7_CLUB_BADGE_CLASS,
  useClientStatus,
  type ClientTier,
  type ClientStatusLookupKeys,
} from '../contexts/ClientStatusContext'

interface Props extends ClientStatusLookupKeys {
  tier?: ClientTier | null
  dr7Club?: boolean
  size?: 'sm' | 'md'
  className?: string
}

export default function ClientStatusBadge({
  tier,
  dr7Club,
  customerId,
  userId,
  email,
  phone,
  size = 'sm',
  className = '',
}: Props) {
  const { lookup, tierMeta } = useClientStatus()
  const hasAnyKey = !!(customerId || userId || email || phone)
  const looked = lookup({ customerId, userId, email, phone })

  let resolvedTier: ClientTier | null = tier ?? looked?.tier ?? null
  const resolvedDr7 = dr7Club ?? looked?.dr7Club ?? false

  if (!resolvedTier && !resolvedDr7 && hasAnyKey) resolvedTier = 'new'
  if (!resolvedTier && !resolvedDr7) return null

  const sizeCls = size === 'md' ? 'px-2 py-0.5 text-xs' : 'px-1.5 py-0.5 text-[10px]'
  const baseCls = `inline-flex items-center rounded font-bold border whitespace-nowrap ${sizeCls}`

  // Nome, colore e avvertenza arrivano da Centralina Pro > Status Clienti.
  // `badgeVisibile` a false nasconde il badge senza togliere lo status.
  const meta = resolvedTier ? tierMeta(resolvedTier) : null
  const showTier = !!meta && meta.badgeVisibile
  if (!showTier && !resolvedDr7) return null

  return (
    <span className={`inline-flex items-center gap-1 flex-wrap ${className}`}>
      {showTier && meta && (
        <span
          className={`${baseCls} ${meta.badgeClass}`}
          title={meta.avviso ? `${meta.label} — ${meta.avviso}` : `Stato cliente: ${meta.label}`}
        >
          {meta.label}
        </span>
      )}
      {/* 2026-08-10 (roadmap #20): l'avvertenza configurata in Centralina Pro >
          Status Clienti esisteva SOLO come tooltip `title=`. Un avviso
          "critico" — es. "Cliente in blacklist: non procedere senza
          autorizzazione della direzione" — non lo vedeva nessuno: bisognava
          fermare il mouse sul badge per scoprirlo. Ora un avviso di livello
          attenzione/critico e' visibile accanto al badge, ovunque il badge
          compaia. Il livello 'info' resta solo nel tooltip per non riempire
          le liste di rumore. */}
      {showTier && meta?.avviso && meta.avvisoLivello !== 'info' && (
        <span
          className={`${baseCls} ${avvisoClasses(meta.avvisoLivello)}`}
          title={meta.avviso}
        >
          {meta.avvisoLivello === 'critico' ? '\u26A0 ' : ''}{meta.avviso}
        </span>
      )}
      {resolvedDr7 && (
        <span
          className={`${baseCls} ${DR7_CLUB_BADGE_CLASS}`}
          title="Iscritto DR7 Club"
        >
          DR7 Club
        </span>
      )}
    </span>
  )
}
