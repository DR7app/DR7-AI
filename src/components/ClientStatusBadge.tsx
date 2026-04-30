import { clientStatusMeta, useClientStatus, type ClientStatus, type ClientStatusLookupKeys } from '../contexts/ClientStatusContext'

interface Props extends ClientStatusLookupKeys {
  status?: ClientStatus | null
  size?: 'sm' | 'md'
  className?: string
  hideStandard?: boolean
}

export default function ClientStatusBadge({ status, customerId, userId, email, phone, size = 'sm', className = '', hideStandard = false }: Props) {
  const { lookup } = useClientStatus()
  const hasAnyKey = !!(customerId || userId || email || phone)
  let resolved: ClientStatus | null = status ?? lookup({ customerId, userId, email, phone })
  if (!resolved && hasAnyKey) resolved = 'new'
  if (!resolved) return null
  if (hideStandard && resolved === 'standard') return null
  const meta = clientStatusMeta(resolved)
  const sizeCls = size === 'md'
    ? 'px-2 py-0.5 text-xs'
    : 'px-1.5 py-0.5 text-[10px]'
  return (
    <span
      className={`inline-flex items-center rounded font-bold border whitespace-nowrap ${sizeCls} ${meta.badgeClass} ${className}`}
      title={`Stato cliente: ${meta.label}`}
    >
      {meta.label}
    </span>
  )
}
