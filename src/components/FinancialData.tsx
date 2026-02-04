import { useAdminRole } from '../hooks/useAdminRole'

interface FinancialDataProps {
  children: React.ReactNode
  fallback?: React.ReactNode
  type?: 'price' | 'total' // price = individual prices, total = revenue totals
}

/**
 * Wrapper component that only shows financial data to admins with permission
 * Usage:
 * - <FinancialData type="total">€500.00</FinancialData> - Hide monthly totals
 * - <FinancialData type="price">€50.00</FinancialData> - Show individual prices
 */
export function FinancialData({ children, fallback = '***', type = 'total' }: FinancialDataProps) {
  const { canViewFinancials, loading } = useAdminRole()

  if (loading) {
    return <span className="text-theme-text-muted">...</span>
  }

  // If type is 'price', always show (individual booking prices are visible to all)
  if (type === 'price') {
    return <>{children}</>
  }

  // If type is 'total', only show to admins with financial permission
  if (!canViewFinancials) {
    return <>{fallback}</>
  }

  return <>{children}</>
}
