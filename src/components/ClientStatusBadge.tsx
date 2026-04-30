import {
  clientTierMeta,
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
  hideStandard?: boolean
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
  hideStandard = false,
}: Props) {
  const { lookup } = useClientStatus()
  const hasAnyKey = !!(customerId || userId || email || phone)
  const looked = lookup({ customerId, userId, email, phone })

  let resolvedTier: ClientTier | null = tier ?? looked?.tier ?? null
  const resolvedDr7 = dr7Club ?? looked?.dr7Club ?? false

  if (!resolvedTier && !resolvedDr7 && hasAnyKey) resolvedTier = 'new'

  if (hideStandard && resolvedTier === 'standard' && !resolvedDr7) return null
  if (!resolvedTier && !resolvedDr7) return null

  const sizeCls = size === 'md' ? 'px-2 py-0.5 text-xs' : 'px-1.5 py-0.5 text-[10px]'
  const baseCls = `inline-flex items-center rounded font-bold border whitespace-nowrap ${sizeCls}`

  const tierMeta = resolvedTier ? clientTierMeta(resolvedTier) : null
  const showTier = !!tierMeta && !(hideStandard && resolvedTier === 'standard')

  return (
    <span className={`inline-flex items-center gap-1 flex-wrap ${className}`}>
      {showTier && tierMeta && (
        <span
          className={`${baseCls} ${tierMeta.badgeClass}`}
          title={`Stato cliente: ${tierMeta.label}`}
        >
          {tierMeta.label}
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
