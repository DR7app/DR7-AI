import { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';

interface DocumentReviewModalProps {
    scan: any;
    isOpen: boolean;
    onClose: () => void;
    onUpdate: () => void;
}

export default function DocumentReviewModal({ scan, isOpen, onClose, onUpdate }: DocumentReviewModalProps) {
    const [loading, setLoading] = useState(false);
    const [fileUrl, setFileUrl] = useState<string | null>(null);

    // Data extraction / linking
    const [customerId, setCustomerId] = useState<string>(scan.customer_id || '');
    const [extractedData, setExtractedData] = useState<any>(scan.extracted_data || {});
    const [docType, setDocType] = useState(extractedData.doc_type || 'generic');

    // Search state for manual linking
    const [customers, setCustomers] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        if (isOpen && scan) {
            loadFileUrl();
            if (!scan.customer_id) searchCustomers('');
        }
    }, [isOpen, scan]);

    async function loadFileUrl() {
        const { data } = await supabase.storage.from('scans').createSignedUrl(scan.file_path, 3600);
        if (data) setFileUrl(data.signedUrl);
    }

    async function searchCustomers(query: string) {
        let q = supabase.from('customers_extended').select('id, nome, cognome, email').limit(10);
        if (query) {
            q = q.or(`nome.ilike.%${query}%,cognome.ilike.%${query}%,email.ilike.%${query}%`);
        }
        const { data } = await q;
        if (data) setCustomers(data);
    }

    async function handleConfirm() {
        setLoading(true);
        try {
            // 1. Update document_uploads
            const { error } = await supabase
                .from('document_uploads')
                .update({
                    status: 'confirmed',
                    customer_id: customerId,
                    extracted_data: { ...extractedData, doc_type: docType },
                    updated_at: new Date().toISOString()
                })
                .eq('id', scan.id);

            if (error) throw error;

            onUpdate();
            onClose();
        } catch (err) {
            console.error('Save error:', err);
            alert('Impossibile salvare');
        } finally {
            setLoading(false);
        }
    }

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <div className="bg-gray-900 w-full max-w-6xl h-[90vh] rounded-3xl shadow-2xl flex border border-gray-700 overflow-hidden">

                {/* Left: Document Viewer */}
                <div className="w-1/2 h-full bg-gray-800 p-4 border-r border-gray-700">
                    {fileUrl ? (
                        <iframe src={fileUrl} className="w-full h-full rounded-xl bg-white" title="PDF Viewer" />
                    ) : (
                        <div className="flex items-center justify-center h-full text-gray-400">Caricamento PDF...</div>
                    )}
                </div>

                {/* Right: Data Entry */}
                <div className="w-1/2 h-full p-6 overflow-y-auto">
                    <div className="flex justify-between items-start mb-6">
                        <h2 className="text-2xl font-bold text-white">Revisione Documento</h2>
                        <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
                    </div>

                    <div className="space-y-6">
                        {/* Customer Association */}
                        <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700">
                            <h3 className="text-lg font-semibold text-dr7-gold mb-3">Associazione Cliente</h3>
                            {customerId ? (
                                <div className="flex justify-between items-center bg-gray-800 p-3 rounded-lg">
                                    <span className="text-white">
                                        {customers.find(c => c.id === customerId)?.nome || 'Cliente selezionato'}
                                    </span>
                                    <button
                                        onClick={() => setCustomerId('')}
                                        className="text-xs text-red-400 hover:text-red-300"
                                    >
                                        Cambia
                                    </button>
                                </div>
                            ) : (
                                <div>
                                    <input
                                        type="text"
                                        placeholder="Cerca cliente..."
                                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white mb-2"
                                        value={searchQuery}
                                        onChange={(e) => {
                                            setSearchQuery(e.target.value);
                                            searchCustomers(e.target.value);
                                        }}
                                    />
                                    <div className="max-h-40 overflow-y-auto space-y-1">
                                        {customers.map(c => (
                                            <button
                                                key={c.id}
                                                onClick={() => setCustomerId(c.id)}
                                                className="w-full text-left px-3 py-2 hover:bg-gray-700 rounded-lg text-sm text-gray-300"
                                            >
                                                {c.nome} {c.cognome} <span className="text-gray-500 text-xs">({c.email})</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Document Details */}
                        <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700">
                            <h3 className="text-lg font-semibold text-dr7-gold mb-3">Dati Estratti</h3>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs text-gray-500 mb-1">Tipo Documento</label>
                                    <select
                                        value={docType}
                                        onChange={(e) => setDocType(e.target.value)}
                                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                                    >
                                        <option value="generic">Generico</option>
                                        <option value="identity_card">Carta d'Identità</option>
                                        <option value="driving_license">Patente</option>
                                        <option value="passport">Passaporto</option>
                                        <option value="health_card">Tessera Sanitaria</option>
                                    </select>
                                </div>
                            </div>

                            {/* Here we would add specific fields inputs like Name, Doc Number etc. based on docType */}
                            <div className="mt-4 p-4 bg-gray-900/50 rounded-lg text-sm text-gray-500 text-center">
                                Campi OCR: {Object.keys(extractedData).length > 0 ? 'Dati presenti' : 'Nessun dato OCR disponibile'}
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-4 pt-4 border-t border-gray-800">
                            <button
                                onClick={handleConfirm}
                                disabled={loading || !customerId}
                                className="flex-1 py-3 bg-dr7-gold text-black font-bold rounded-xl hover:bg-yellow-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {loading ? 'Salvataggio...' : 'Conferma e Salva'}
                            </button>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
}
