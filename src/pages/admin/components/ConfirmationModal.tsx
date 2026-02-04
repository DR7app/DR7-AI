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
        <div className="fixed inset-0 bg-theme-bg-primary bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-theme-bg-primary max-w-md w-full rounded-lg shadow-xl">
                {/* Header */}
                <div className="bg-theme-bg-primaryer p-4 border-b border-theme-border flex justify-between items-center rounded-t-lg">
                    <h3 className={`text-lg font-bold ${isDangerous ? 'text-red-400' : 'text-dr7-gold'}`}>
                        {title}
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-theme-text-muted hover:text-theme-text-primary text-2xl leading-none"
                    >
                        ×
                    </button>
                </div>

                {/* Content */}
                <div className="p-6">
                    <p className="text-theme-text-primary whitespace-pre-line">{message}</p>
                </div>

                {/* Actions */}
                <div className="p-4 border-t border-theme-border flex gap-3 justify-end rounded-b-lg">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-theme-bg-hover hover:bg-theme-bg-hover text-theme-text-primary rounded-full transition-colors"
                    >
                        Annulla
                    </button>
                    <button
                        onClick={handleConfirm}
                        className={`px-4 py-2 text-theme-text-primary rounded transition-colors ${isDangerous
                            ? 'bg-red-600 hover:bg-red-700'
                            : 'bg-dr7-gold hover:bg-yellow-600'
                            }`}
                    >
                        Conferma
                    </button>
                </div>
            </div>
        </div>
    )
}
