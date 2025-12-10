// Wrapper component for InvoicesTab to maintain backward compatibility
import InvoicesTab from './InvoicesTab'

export default function PaymentsTab() {
    return <InvoicesTab />
}
