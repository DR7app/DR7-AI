interface ConfirmationModalProps {
    isOpen: boolean
    onClose: () => void
    onConfirm: () => void | Promise<void>
    title: string
    message: string
    isDangerous?: boolean
}

export default function ConfirmationModal({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    isDangerous = false
}: ConfirmationModalProps) {
    if (!isOpen) return null

    const handleConfirm = async () => {
        await onConfirm()
        onClose()
    }

    return (
        <div className="fixed inset-0 bg-theme-bg-primary bg-opacity-75 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
            <div className="bg-theme-bg-primary w-full sm:max-w-md rounded-t-lg sm:rounded-lg shadow-xl flex flex-col max-h-full sm:max-h-[90vh]">
                {/* Header */}
                <div className="bg-theme-bg-primaryer p-4 border-b border-theme-border flex justify-between items-center rounded-t-lg flex-shrink-0">
                    <h3 className={`text-lg font-bold ${isDangerous ? 'text-red-400' : 'text-dr7-gold'}`}>
                        {title}
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-theme-text-muted hover:text-theme-text-primary text-2xl leading-none min-h-[44px] min-w-[44px] flex items-center justify-center"
                    >
                        ×
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 sm:p-6 flex-1 overflow-y-auto">
                    <p className="text-theme-text-primary whitespace-pre-line">{message}</p>
                </div>

                {/* Actions */}
                <div className="p-4 border-t border-theme-border flex flex-col-reverse sm:flex-row gap-3 sm:justify-end rounded-b-lg flex-shrink-0">
                    <button
                        onClick={onClose}
                        className="px-4 py-3 sm:py-2 min-h-[44px] bg-theme-bg-hover hover:bg-theme-bg-hover text-theme-text-primary rounded-full transition-colors"
                    >
                        Annulla
                    </button>
                    <button
                        onClick={handleConfirm}
                        className={`px-4 py-3 sm:py-2 min-h-[44px] text-theme-text-primary rounded-full transition-colors ${isDangerous
                            ? 'bg-red-600 hover:bg-red-700'
                            : 'bg-dr7-gold hover:bg-[#0A8FA3]'
                            }`}
                    >
                        Conferma
                    </button>
                </div>
            </div>
        </div>
    )
}
