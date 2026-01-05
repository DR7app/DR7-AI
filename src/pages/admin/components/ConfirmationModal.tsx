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
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-dr7-dark max-w-md w-full rounded-lg shadow-xl">
                {/* Header */}
                <div className="bg-dr7-darker p-4 border-b border-gray-700 flex justify-between items-center rounded-t-lg">
                    <h3 className={`text-lg font-bold ${isDangerous ? 'text-red-400' : 'text-dr7-gold'}`}>
                        {title}
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white text-2xl leading-none"
                    >
                        ×
                    </button>
                </div>

                {/* Content */}
                <div className="p-6">
                    <p className="text-white whitespace-pre-line">{message}</p>
                </div>

                {/* Actions */}
                <div className="p-4 border-t border-gray-700 flex gap-3 justify-end rounded-b-lg">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded transition-colors"
                    >
                        Annulla
                    </button>
                    <button
                        onClick={handleConfirm}
                        className={`px-4 py-2 text-white rounded transition-colors ${isDangerous
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
