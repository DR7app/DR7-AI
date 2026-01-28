import { useState, useRef } from 'react';
import NewClientModal from './NewClientModal';

interface ExtractedData {
    // Personal Info
    nome?: string;
    cognome?: string;
    sesso?: 'M' | 'F';
    data_nascita?: string;
    luogo_nascita?: string;
    provincia_nascita?: string;
    codice_fiscale?: string;

    // Address
    indirizzo?: string;
    numero_civico?: string;
    codice_postale?: string;
    citta_residenza?: string;
    provincia_residenza?: string;

    // Document Info (ID Card)
    documento_tipo?: string;
    documento_numero?: string;
    documento_rilascio?: string;
    documento_scadenza?: string;
    documento_ente?: string;

    // Driver's License
    patente_numero?: string;
    patente_tipo?: string;
    patente_rilascio?: string;
    patente_scadenza?: string;
    patente_ente?: string;

    // Metadata
    document_type?: string;
    confidence?: string;
    notes?: string;
}

interface DocumentSlot {
    label: string;
    key: 'id_front' | 'id_back' | 'license_front' | 'license_back';
    icon: string;
    preview: string | null;
    base64: string | null;
    extracted: ExtractedData | null;
    extracting: boolean;
}

export default function ScannerTab() {
    const [documents, setDocuments] = useState<Record<string, DocumentSlot>>({
        id_front: { label: 'Carta Identità (Fronte)', key: 'id_front', icon: '🪪', preview: null, base64: null, extracted: null, extracting: false },
        id_back: { label: 'Carta Identità (Retro)', key: 'id_back', icon: '🪪', preview: null, base64: null, extracted: null, extracting: false },
        license_front: { label: 'Patente (Fronte)', key: 'license_front', icon: '🚗', preview: null, base64: null, extracted: null, extracting: false },
        license_back: { label: 'Patente (Retro)', key: 'license_back', icon: '🚗', preview: null, base64: null, extracted: null, extracting: false },
    });

    const [mergedData, setMergedData] = useState<ExtractedData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [showNewClientModal, setShowNewClientModal] = useState(false);
    const [clientModalData, setClientModalData] = useState<any>(null);
    const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

    // Reset all
    const resetAll = () => {
        setDocuments({
            id_front: { label: 'Carta Identità (Fronte)', key: 'id_front', icon: '🪪', preview: null, base64: null, extracted: null, extracting: false },
            id_back: { label: 'Carta Identità (Retro)', key: 'id_back', icon: '🪪', preview: null, base64: null, extracted: null, extracting: false },
            license_front: { label: 'Patente (Fronte)', key: 'license_front', icon: '🚗', preview: null, base64: null, extracted: null, extracting: false },
            license_back: { label: 'Patente (Retro)', key: 'license_back', icon: '🚗', preview: null, base64: null, extracted: null, extracting: false },
        });
        setMergedData(null);
        setError(null);
        setSuccess(null);
    };

    // Handle file selection for a specific slot
    const handleFileSelect = (slotKey: string) => (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
        if (!validTypes.includes(file.type)) {
            setError('Formato non supportato. Usa JPG, PNG o WEBP.');
            return;
        }

        if (file.size > 10 * 1024 * 1024) {
            setError('File troppo grande. Massimo 10MB.');
            return;
        }

        setError(null);

        const reader = new FileReader();
        reader.onload = (e) => {
            const result = e.target?.result as string;
            const base64 = result.split(',')[1];

            setDocuments(prev => ({
                ...prev,
                [slotKey]: {
                    ...prev[slotKey],
                    preview: result,
                    base64: base64,
                    extracted: null
                }
            }));
        };
        reader.readAsDataURL(file);
        event.target.value = '';
    };

    // Extract data from a single document
    const extractDocument = async (slotKey: string) => {
        const slot = documents[slotKey];
        if (!slot.base64) return;

        setDocuments(prev => ({
            ...prev,
            [slotKey]: { ...prev[slotKey], extracting: true }
        }));

        try {
            const response = await fetch('/.netlify/functions/extract-document-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageBase64: slot.base64 })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Estrazione fallita');
            }

            setDocuments(prev => ({
                ...prev,
                [slotKey]: {
                    ...prev[slotKey],
                    extracted: result.data,
                    extracting: false
                }
            }));

            return result.data;
        } catch (err: any) {
            console.error('Extraction error:', err);
            setError(`Errore estrazione ${slot.label}: ${err.message}`);
            setDocuments(prev => ({
                ...prev,
                [slotKey]: { ...prev[slotKey], extracting: false }
            }));
            return null;
        }
    };

    // Extract all uploaded documents
    const extractAll = async () => {
        setError(null);
        setSuccess(null);

        const slotsWithImages = Object.entries(documents).filter(([_, slot]) => slot.base64);

        if (slotsWithImages.length === 0) {
            setError('Carica almeno un documento');
            return;
        }

        // Extract each document
        const results: ExtractedData[] = [];
        for (const [key, _] of slotsWithImages) {
            const data = await extractDocument(key);
            if (data) results.push(data);
        }

        // Merge all extracted data (later values override earlier ones)
        const merged: ExtractedData = {};
        for (const data of results) {
            Object.entries(data).forEach(([key, value]) => {
                if (value && value !== '') {
                    (merged as any)[key] = value;
                }
            });
        }

        setMergedData(merged);
        setSuccess(`Estratti dati da ${results.length} documento/i`);
    };

    // Remove a document from a slot
    const removeDocument = (slotKey: string) => {
        setDocuments(prev => ({
            ...prev,
            [slotKey]: {
                ...prev[slotKey],
                preview: null,
                base64: null,
                extracted: null
            }
        }));
    };

    // Open NewClientModal with merged data
    const openClientModal = () => {
        if (!mergedData) return;

        // Map extracted data to NewClientModal format (matching expected field names)
        const clientData: any = {
            tipo_cliente: 'persona_fisica',
            // Personal info
            nome: mergedData.nome || '',
            cognome: mergedData.cognome || '',
            codice_fiscale: mergedData.codice_fiscale || '',
            sesso: mergedData.sesso || '',
            data_nascita: mergedData.data_nascita || '',
            luogo_nascita: mergedData.luogo_nascita || '',
            provincia_nascita: mergedData.provincia_nascita || '',
            // Address
            indirizzo: mergedData.indirizzo || '',
            numero_civico: mergedData.numero_civico || '',
            codice_postale: mergedData.codice_postale || '',
            citta_residenza: mergedData.citta_residenza || '',
            provincia_residenza: mergedData.provincia_residenza || '',
            nazione: 'Italia',
            // Document info (ID card)
            numero_documento: mergedData.documento_numero || '',
            data_scadenza_documento: mergedData.documento_scadenza || '',
            // Driver's license - use field names that NewClientModal expects
            numero_patente: mergedData.patente_numero || '',
            tipo_patente: mergedData.patente_tipo || '',
            data_rilascio_patente: mergedData.patente_rilascio || '',
            scadenza_patente: mergedData.patente_scadenza || '',
            emessa_da: mergedData.patente_ente || '',
            // Also put in metadata for safety
            metadata: {
                sesso: mergedData.sesso || '',
                provincia_nascita: mergedData.provincia_nascita || '',
                patente: {
                    numero: mergedData.patente_numero || '',
                    tipo: mergedData.patente_tipo || '',
                    rilascio: mergedData.patente_rilascio || '',
                    scadenza: mergedData.patente_scadenza || '',
                    ente: mergedData.patente_ente || '',
                }
            }
        };

        setClientModalData(clientData);
        setShowNewClientModal(true);
    };

    // Count uploaded and extracted documents
    const uploadedCount = Object.values(documents).filter(d => d.base64).length;
    const extractedCount = Object.values(documents).filter(d => d.extracted).length;
    const isExtracting = Object.values(documents).some(d => d.extracting);

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Header */}
            <div className="bg-theme-bg-secondary p-6 rounded-3xl border border-theme-border">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-2xl font-bold text-theme-text-primary">Scanner Documenti</h2>
                        <p className="text-theme-text-muted text-sm mt-1">
                            Carica fronte e retro di Carta d'Identità e Patente per estrarre tutti i dati
                        </p>
                    </div>
                    {uploadedCount > 0 && (
                        <button
                            onClick={resetAll}
                            className="px-4 py-2 bg-gray-700 text-white rounded-full hover:bg-gray-600 transition-colors text-sm"
                        >
                            Ricomincia
                        </button>
                    )}
                </div>

                {/* Document Upload Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    {Object.entries(documents).map(([key, slot]) => (
                        <div key={key} className="relative">
                            <input
                                ref={el => { fileInputRefs.current[key] = el }}
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                onChange={handleFileSelect(key)}
                                className="hidden"
                            />

                            {slot.preview ? (
                                // Document uploaded
                                <div className="relative aspect-[3/2] rounded-xl overflow-hidden border-2 border-green-500 bg-black">
                                    <img
                                        src={slot.preview}
                                        alt={slot.label}
                                        className="w-full h-full object-cover"
                                    />
                                    {slot.extracting && (
                                        <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                                            <div className="text-center">
                                                <div className="animate-spin text-3xl mb-2">⏳</div>
                                                <p className="text-white text-xs">Estrazione...</p>
                                            </div>
                                        </div>
                                    )}
                                    {slot.extracted && !slot.extracting && (
                                        <div className="absolute top-2 right-2 bg-green-500 text-white text-xs px-2 py-1 rounded-full">
                                            ✓ Estratto
                                        </div>
                                    )}
                                    <button
                                        onClick={() => removeDocument(key)}
                                        className="absolute top-2 left-2 bg-red-500 text-white w-6 h-6 rounded-full text-sm hover:bg-red-600"
                                    >
                                        ×
                                    </button>
                                    <div className="absolute bottom-0 inset-x-0 bg-black/70 p-2">
                                        <p className="text-white text-xs text-center truncate">{slot.label}</p>
                                    </div>
                                </div>
                            ) : (
                                // Upload placeholder
                                <div
                                    onClick={() => fileInputRefs.current[key]?.click()}
                                    className="aspect-[3/2] border-2 border-dashed border-gray-600 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-dr7-gold hover:bg-gray-800/30 transition-all"
                                >
                                    <div className="text-3xl mb-2">{slot.icon}</div>
                                    <p className="text-white text-xs font-medium text-center px-2">{slot.label}</p>
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                {/* Action Buttons */}
                {uploadedCount > 0 && (
                    <div className="flex justify-center gap-4">
                        <button
                            onClick={extractAll}
                            disabled={isExtracting || uploadedCount === 0}
                            className="px-8 py-3 bg-dr7-gold text-black font-bold rounded-full hover:bg-yellow-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {isExtracting ? (
                                <>
                                    <span className="animate-spin">⏳</span>
                                    Estrazione in corso...
                                </>
                            ) : (
                                <>
                                    <span>🔍</span>
                                    Estrai Dati ({uploadedCount} doc)
                                </>
                            )}
                        </button>
                    </div>
                )}

                {/* Error/Success Messages */}
                {error && (
                    <div className="mt-4 p-4 bg-red-900/30 border border-red-500 rounded-xl">
                        <p className="text-red-300 font-medium">{error}</p>
                    </div>
                )}
                {success && (
                    <div className="mt-4 p-4 bg-green-900/30 border border-green-500 rounded-xl">
                        <p className="text-green-300 font-medium">{success}</p>
                    </div>
                )}
            </div>

            {/* Merged Data Preview */}
            {mergedData && (
                <div className="bg-theme-bg-secondary p-6 rounded-3xl border border-theme-border">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-xl font-bold text-theme-text-primary">Dati Estratti</h3>
                        <div className="flex items-center gap-2">
                            <span className="text-theme-text-muted text-sm">
                                {extractedCount} documento/i elaborati
                            </span>
                        </div>
                    </div>

                    {/* Data Preview Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        {mergedData.nome && (
                            <div className="bg-gray-800/50 p-3 rounded-lg">
                                <p className="text-xs text-theme-text-muted">Nome</p>
                                <p className="text-white font-medium">{mergedData.nome}</p>
                            </div>
                        )}
                        {mergedData.cognome && (
                            <div className="bg-gray-800/50 p-3 rounded-lg">
                                <p className="text-xs text-theme-text-muted">Cognome</p>
                                <p className="text-white font-medium">{mergedData.cognome}</p>
                            </div>
                        )}
                        {mergedData.codice_fiscale && (
                            <div className="bg-gray-800/50 p-3 rounded-lg md:col-span-2">
                                <p className="text-xs text-theme-text-muted">Codice Fiscale</p>
                                <p className="text-white font-mono text-sm">{mergedData.codice_fiscale}</p>
                            </div>
                        )}
                        {mergedData.data_nascita && (
                            <div className="bg-gray-800/50 p-3 rounded-lg">
                                <p className="text-xs text-theme-text-muted">Data Nascita</p>
                                <p className="text-white font-medium">{mergedData.data_nascita}</p>
                            </div>
                        )}
                        {mergedData.luogo_nascita && (
                            <div className="bg-gray-800/50 p-3 rounded-lg">
                                <p className="text-xs text-theme-text-muted">Luogo Nascita</p>
                                <p className="text-white font-medium">{mergedData.luogo_nascita}</p>
                            </div>
                        )}
                        {mergedData.documento_numero && (
                            <div className="bg-gray-800/50 p-3 rounded-lg">
                                <p className="text-xs text-theme-text-muted">N. Documento</p>
                                <p className="text-white font-mono text-sm">{mergedData.documento_numero}</p>
                            </div>
                        )}
                        {mergedData.documento_scadenza && (
                            <div className="bg-gray-800/50 p-3 rounded-lg">
                                <p className="text-xs text-theme-text-muted">Scadenza Doc.</p>
                                <p className="text-white font-medium">{mergedData.documento_scadenza}</p>
                            </div>
                        )}
                        {mergedData.patente_numero && (
                            <div className="bg-gray-800/50 p-3 rounded-lg">
                                <p className="text-xs text-theme-text-muted">N. Patente</p>
                                <p className="text-white font-mono text-sm">{mergedData.patente_numero}</p>
                            </div>
                        )}
                        {mergedData.patente_tipo && (
                            <div className="bg-gray-800/50 p-3 rounded-lg">
                                <p className="text-xs text-theme-text-muted">Tipo Patente</p>
                                <p className="text-white font-medium">{mergedData.patente_tipo}</p>
                            </div>
                        )}
                        {mergedData.patente_scadenza && (
                            <div className="bg-gray-800/50 p-3 rounded-lg">
                                <p className="text-xs text-theme-text-muted">Scadenza Patente</p>
                                <p className="text-white font-medium">{mergedData.patente_scadenza}</p>
                            </div>
                        )}
                        {mergedData.indirizzo && (
                            <div className="bg-gray-800/50 p-3 rounded-lg md:col-span-2">
                                <p className="text-xs text-theme-text-muted">Indirizzo</p>
                                <p className="text-white font-medium">{mergedData.indirizzo} {mergedData.numero_civico}</p>
                            </div>
                        )}
                        {mergedData.citta_residenza && (
                            <div className="bg-gray-800/50 p-3 rounded-lg">
                                <p className="text-xs text-theme-text-muted">Città</p>
                                <p className="text-white font-medium">{mergedData.citta_residenza} ({mergedData.provincia_residenza})</p>
                            </div>
                        )}
                    </div>

                    {/* Open NewClientModal Button */}
                    <div className="flex justify-end gap-4 pt-4 border-t border-gray-700">
                        <button
                            onClick={resetAll}
                            className="px-6 py-3 bg-gray-700 text-white rounded-full hover:bg-gray-600 transition-colors"
                        >
                            Annulla
                        </button>
                        <button
                            onClick={openClientModal}
                            className="px-8 py-3 bg-dr7-gold text-black font-bold rounded-full hover:bg-yellow-500 transition-all flex items-center gap-2"
                        >
                            <span>✅</span>
                            Apri Form Nuovo Cliente
                        </button>
                    </div>
                </div>
            )}

            {/* Instructions */}
            {uploadedCount === 0 && (
                <div className="bg-theme-bg-secondary p-6 rounded-3xl border border-theme-border">
                    <h3 className="text-lg font-bold text-theme-text-primary mb-4">Come funziona</h3>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                        <div className="p-4 bg-gray-800/50 rounded-xl text-center">
                            <div className="text-3xl mb-2">1️⃣</div>
                            <p className="text-white font-medium text-sm">Carica i documenti</p>
                            <p className="text-theme-text-muted text-xs mt-1">Fronte e retro di CI e Patente</p>
                        </div>
                        <div className="p-4 bg-gray-800/50 rounded-xl text-center">
                            <div className="text-3xl mb-2">2️⃣</div>
                            <p className="text-white font-medium text-sm">Estrai i dati</p>
                            <p className="text-theme-text-muted text-xs mt-1">L'AI legge tutti i documenti</p>
                        </div>
                        <div className="p-4 bg-gray-800/50 rounded-xl text-center">
                            <div className="text-3xl mb-2">3️⃣</div>
                            <p className="text-white font-medium text-sm">Verifica</p>
                            <p className="text-theme-text-muted text-xs mt-1">Controlla i dati estratti</p>
                        </div>
                        <div className="p-4 bg-gray-800/50 rounded-xl text-center">
                            <div className="text-3xl mb-2">4️⃣</div>
                            <p className="text-white font-medium text-sm">Crea Cliente</p>
                            <p className="text-theme-text-muted text-xs mt-1">Apri il form precompilato</p>
                        </div>
                    </div>

                    <div className="p-4 bg-blue-900/20 border border-blue-600/30 rounded-xl">
                        <p className="text-blue-300 text-sm">
                            <strong>Suggerimento:</strong> Per i migliori risultati, usa foto ben illuminate e nitide.
                            Puoi caricare anche solo alcuni documenti - i dati verranno estratti da quelli disponibili.
                        </p>
                    </div>
                </div>
            )}

            {/* NewClientModal */}
            <NewClientModal
                isOpen={showNewClientModal}
                onClose={() => {
                    setShowNewClientModal(false);
                    resetAll();
                }}
                onClientCreated={(clientId) => {
                    console.log('Client created:', clientId);
                    setShowNewClientModal(false);
                    resetAll();
                    setSuccess('Cliente creato con successo!');
                }}
                initialData={clientModalData}
            />
        </div>
    );
}
