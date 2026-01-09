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
    const extractedData = scan.extracted_data || {};
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

    async function handleCreateCustomer() {
        if (!extractedData || !extractedData.nome) {
            alert('Dati insufficienti per creare il cliente');
            return;
        }

        setLoading(true);
        try {
            // Parse birth date to ISO format
            let birthDate = null;
            if (extractedData.data_nascita) {
                const parts = extractedData.data_nascita.split(/[\/\-\.]/);
                if (parts.length === 3) {
                    birthDate = `${parts[2]}-${parts[1]}-${parts[0]}`; // YYYY-MM-DD
                }
            }

            // Create new customer
            const { data: newCustomer, error: createError } = await supabase
                .from('customers_extended')
                .insert([{
                    nome: extractedData.nome,
                    cognome: extractedData.cognome || '',
                    codice_fiscale: extractedData.codice_fiscale || null,
                    data_nascita: birthDate,
                    luogo_nascita: extractedData.luogo_nascita || null,
                    indirizzo: extractedData.indirizzo || null,
                    numero_documento: extractedData.numero_documento || null,
                    tipo_documento: docType,
                    data_scadenza_documento: extractedData.data_scadenza || null,
                }])
                .select()
                .single();

            if (createError) throw createError;

            // Set the newly created customer
            setCustomerId(newCustomer.id);
            setCustomers([newCustomer, ...customers]);

            alert(`Cliente "${newCustomer.nome} ${newCustomer.cognome}" creato con successo!`);
        } catch (err: any) {
            console.error('Error creating customer:', err);
            alert(`Errore nella creazione del cliente: ${err.message}`);
        } finally {
            setLoading(false);
        }
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-theme-bg-primary/80 backdrop-blur-sm">
            <div className="bg-theme-bg-secondary w-full max-w-6xl h-[90vh] rounded-3xl shadow-2xl flex border border-theme-border overflow-hidden">

                {/* Left: Document Viewer */}
                <div className="w-1/2 h-full bg-theme-bg-tertiary p-4 border-r border-theme-border">
                    {fileUrl ? (
                        <iframe src={fileUrl} className="w-full h-full rounded-xl bg-white" title="PDF Viewer" />
                    ) : (
                        <div className="flex items-center justify-center h-full text-theme-text-muted">Caricamento PDF...</div>
                    )}
                </div>

                {/* Right: Data Entry */}
                <div className="w-1/2 h-full p-6 overflow-y-auto">
                    <div className="flex justify-between items-start mb-6">
                        <h2 className="text-2xl font-bold text-theme-text-primary">Revisione Documento</h2>
                        <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-primary">✕</button>
                    </div>

                    <div className="space-y-6">
                        {/* Customer Association */}
                        <div className="bg-theme-bg-tertiary/50 p-4 rounded-xl border border-theme-border">
                            <h3 className="text-lg font-semibold text-dr7-gold mb-3">Associazione Cliente</h3>
                            {customerId ? (
                                <div className="flex justify-between items-center bg-theme-bg-tertiary p-3 rounded-lg">
                                    <span className="text-theme-text-primary">
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
                                        className="w-full bg-theme-bg-secondary border border-theme-border rounded-lg px-4 py-2 text-theme-text-primary mb-2"
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
                                                className="w-full text-left px-3 py-2 hover:bg-theme-bg-hover rounded-lg text-sm text-theme-text-secondary"
                                            >
                                                {c.nome} {c.cognome} <span className="text-gray-500 text-xs">({c.email})</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Document Details with OCR Fields */}
                        <div className="bg-theme-bg-tertiary/50 p-4 rounded-xl border border-theme-border">
                            <h3 className="text-lg font-semibold text-dr7-gold mb-3">Dati Estratti (OCR)</h3>

                            <div className="grid grid-cols-2 gap-4 mb-4">
                                <div>
                                    <label className="block text-xs text-gray-500 mb-1">Tipo Documento</label>
                                    <select
                                        value={docType}
                                        onChange={(e) => setDocType(e.target.value)}
                                        className="w-full bg-theme-bg-secondary border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary text-sm"
                                    >
                                        <option value="generic">Generico</option>
                                        <option value="identity_card">Carta d'Identità</option>
                                        <option value="driving_license">Patente</option>
                                        <option value="passport">Passaporto</option>
                                        <option value="health_card">Tessera Sanitaria</option>
                                    </select>
                                </div>
                                {extractedData.confidence && (
                                    <div>
                                        <label className="block text-xs text-gray-500 mb-1">Confidence</label>
                                        <div className="w-full bg-theme-bg-secondary border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary text-sm">
                                            {(extractedData.confidence * 100).toFixed(0)}%
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Extracted Fields Display */}
                            {extractedData && Object.keys(extractedData).length > 1 ? (
                                <div className="space-y-3">
                                    <div className="grid grid-cols-2 gap-3">
                                        {extractedData.nome && (
                                            <div>
                                                <label className="block text-xs text-gray-500 mb-1">Nome</label>
                                                <div className="bg-theme-bg-secondary border border-green-700/50 rounded-lg px-3 py-2 text-theme-text-primary text-sm">
                                                    {extractedData.nome}
                                                </div>
                                            </div>
                                        )}
                                        {extractedData.cognome && (
                                            <div>
                                                <label className="block text-xs text-gray-500 mb-1">Cognome</label>
                                                <div className="bg-theme-bg-secondary border border-green-700/50 rounded-lg px-3 py-2 text-theme-text-primary text-sm">
                                                    {extractedData.cognome}
                                                </div>
                                            </div>
                                        )}
                                        {extractedData.data_nascita && (
                                            <div>
                                                <label className="block text-xs text-gray-500 mb-1">Data di Nascita</label>
                                                <div className="bg-theme-bg-secondary border border-green-700/50 rounded-lg px-3 py-2 text-theme-text-primary text-sm">
                                                    {extractedData.data_nascita}
                                                </div>
                                            </div>
                                        )}
                                        {extractedData.luogo_nascita && (
                                            <div>
                                                <label className="block text-xs text-gray-500 mb-1">Luogo di Nascita</label>
                                                <div className="bg-theme-bg-secondary border border-green-700/50 rounded-lg px-3 py-2 text-theme-text-primary text-sm">
                                                    {extractedData.luogo_nascita}
                                                </div>
                                            </div>
                                        )}
                                        {extractedData.codice_fiscale && (
                                            <div className="col-span-2">
                                                <label className="block text-xs text-gray-500 mb-1">Codice Fiscale</label>
                                                <div className="bg-theme-bg-secondary border border-green-700/50 rounded-lg px-3 py-2 text-theme-text-primary text-sm font-mono">
                                                    {extractedData.codice_fiscale}
                                                </div>
                                            </div>
                                        )}
                                        {extractedData.numero_documento && (
                                            <div>
                                                <label className="block text-xs text-gray-500 mb-1">Numero Documento</label>
                                                <div className="bg-theme-bg-secondary border border-green-700/50 rounded-lg px-3 py-2 text-theme-text-primary text-sm">
                                                    {extractedData.numero_documento}
                                                </div>
                                            </div>
                                        )}
                                        {extractedData.data_scadenza && (
                                            <div>
                                                <label className="block text-xs text-gray-500 mb-1">Scadenza</label>
                                                <div className="bg-theme-bg-secondary border border-green-700/50 rounded-lg px-3 py-2 text-theme-text-primary text-sm">
                                                    {extractedData.data_scadenza}
                                                </div>
                                            </div>
                                        )}
                                        {extractedData.indirizzo && (
                                            <div className="col-span-2">
                                                <label className="block text-xs text-gray-500 mb-1">Indirizzo</label>
                                                <div className="bg-theme-bg-secondary border border-green-700/50 rounded-lg px-3 py-2 text-theme-text-primary text-sm">
                                                    {extractedData.indirizzo}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div className="p-4 bg-theme-bg-secondary/50 rounded-lg text-sm text-gray-500 text-center">
                                    Nessun dato OCR disponibile. Esegui OCR o inserisci manualmente.
                                </div>
                            )}
                        </div>

                        {/* Actions */}
                        <div className="flex gap-4 pt-4 border-t border-gray-800">
                            {!customerId && extractedData && extractedData.nome && (
                                <button
                                    onClick={handleCreateCustomer}
                                    disabled={loading}
                                    className="flex-1 py-3 bg-green-600 text-theme-text-primary font-bold rounded-xl hover:bg-green-700 transition-colors disabled:opacity-50"
                                >
                                    {loading ? 'Creazione...' : 'Crea Nuovo Cliente'}
                                </button>
                            )}
                            <button
                                onClick={handleConfirm}
                                disabled={loading || !customerId}
                                className="flex-1 py-3 bg-dr7-gold text-black font-bold rounded-xl hover:bg-yellow-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {loading ? 'Salvataggio...' : customerId ? 'Conferma e Salva' : 'Seleziona Cliente'}
                            </button>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
}
