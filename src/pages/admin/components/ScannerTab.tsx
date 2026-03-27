import { useState, useRef } from 'react';
import NewClientModal from './NewClientModal';
import { logger } from '../../../utils/logger'

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

// Compress image to max 4MB for API - optimized for OCR quality
const compressImage = (file: File, maxSizeMB: number = 4): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let { width, height } = img;

                // Higher resolution for better OCR - max 3000px
                const maxDim = 3000;
                if (width > maxDim || height > maxDim) {
                    if (width > height) {
                        height = (height / width) * maxDim;
                        width = maxDim;
                    } else {
                        width = (width / height) * maxDim;
                        height = maxDim;
                    }
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error('Failed to get canvas context'));
                    return;
                }

                // Use better image smoothing for text
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, width, height);

                // Start with high quality 0.92 for better text readability
                let quality = 0.92;
                let base64 = canvas.toDataURL('image/jpeg', quality);

                // Keep reducing quality until under maxSizeMB
                while (base64.length > maxSizeMB * 1024 * 1024 * 1.37 && quality > 0.3) {
                    quality -= 0.05;
                    base64 = canvas.toDataURL('image/jpeg', quality);
                }

                logger.log(`Image compressed: ${width}x${height}, quality: ${quality.toFixed(2)}`);
                resolve(base64);
            };
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = e.target?.result as string;
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
};

export default function ScannerTab() {
    const [documents, setDocuments] = useState<Record<string, DocumentSlot>>({
        id_front: { label: 'Carta Identità (Fronte)', key: 'id_front', icon: 'ID', preview: null, base64: null, extracted: null, extracting: false },
        id_back: { label: 'Carta Identità (Retro)', key: 'id_back', icon: 'ID', preview: null, base64: null, extracted: null, extracting: false },
        license_front: { label: 'Patente (Fronte)', key: 'license_front', icon: 'PAT', preview: null, base64: null, extracted: null, extracting: false },
        license_back: { label: 'Patente (Retro)', key: 'license_back', icon: 'PAT', preview: null, base64: null, extracted: null, extracting: false },
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
            id_front: { label: 'Carta Identità (Fronte)', key: 'id_front', icon: 'ID', preview: null, base64: null, extracted: null, extracting: false },
            id_back: { label: 'Carta Identità (Retro)', key: 'id_back', icon: 'ID', preview: null, base64: null, extracted: null, extracting: false },
            license_front: { label: 'Patente (Fronte)', key: 'license_front', icon: 'PAT', preview: null, base64: null, extracted: null, extracting: false },
            license_back: { label: 'Patente (Retro)', key: 'license_back', icon: 'PAT', preview: null, base64: null, extracted: null, extracting: false },
        });
        setMergedData(null);
        setError(null);
        setSuccess(null);
    };

    // Handle file selection for a specific slot
    const handleFileSelect = (slotKey: string) => async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
        if (!validTypes.includes(file.type)) {
            setError('Formato non supportato. Usa JPG, PNG o WEBP.');
            return;
        }

        if (file.size > 20 * 1024 * 1024) {
            setError('File troppo grande. Massimo 20MB.');
            return;
        }

        setError(null);

        try {
            // Compress image to max 4MB for API
            const compressedDataUrl = await compressImage(file, 4);
            const base64 = compressedDataUrl.split(',')[1];

            setDocuments(prev => ({
                ...prev,
                [slotKey]: {
                    ...prev[slotKey],
                    preview: compressedDataUrl,
                    base64: base64,
                    extracted: null
                }
            }));
        } catch (err) {
            console.error('Compression error:', err);
            setError('Errore durante la compressione dell\'immagine');
        }

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

        const slotsWithImages = Object.entries(documents).filter(([, slot]) => slot.base64);

        if (slotsWithImages.length === 0) {
            setError('Carica almeno un documento');
            return;
        }

        // Extract each document
        const results: ExtractedData[] = [];
        for (const [key] of slotsWithImages) {
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

    // Convert base64 to File object
    const base64ToFile = (base64: string, filename: string): File => {
        const arr = base64.split(',');
        const mimeMatch = arr[0]?.match(/:(.*?);/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
        const bstr = atob(arr.length > 1 ? arr[1] : base64);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new File([u8arr], filename, { type: mime });
    };

    // Open NewClientModal with merged data
    const openClientModal = () => {
        if (!mergedData) return;

        // Convert scanned documents to File objects for upload
        const scannedFiles: any = {};

        if (documents.id_front.preview) {
            scannedFiles.identityFront = base64ToFile(documents.id_front.preview, 'carta_identita_fronte.jpg');
        }
        if (documents.id_back.preview) {
            scannedFiles.identityBack = base64ToFile(documents.id_back.preview, 'carta_identita_retro.jpg');
        }
        if (documents.license_front.preview) {
            scannedFiles.driversLicenseFront = base64ToFile(documents.license_front.preview, 'patente_fronte.jpg');
        }
        if (documents.license_back.preview) {
            scannedFiles.driversLicenseBack = base64ToFile(documents.license_back.preview, 'patente_retro.jpg');
        }

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
            // Scanned document files for upload
            scannedFiles: scannedFiles,
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
                            className="px-4 py-2 bg-theme-bg-tertiary text-theme-text-primary rounded-full hover:bg-theme-bg-hover transition-colors text-sm"
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
                                <div className="relative aspect-[3/2] rounded-xl overflow-hidden border-2 border-green-500 bg-theme-bg-primary">
                                    <img
                                        src={slot.preview}
                                        alt={slot.label}
                                        className="w-full h-full object-cover"
                                    />
                                    {slot.extracting && (
                                        <div className="absolute inset-0 bg-theme-overlay flex items-center justify-center">
                                            <div className="text-center">
                                                <div className="animate-spin w-6 h-6 border-2 border-theme-text-primary border-t-transparent rounded-full mx-auto mb-2"></div>
                                                <p className="text-theme-text-primary text-xs">Estrazione...</p>
                                            </div>
                                        </div>
                                    )}
                                    {slot.extracted && !slot.extracting && (
                                        <div className="absolute top-2 right-2 bg-green-500 text-white text-xs px-2 py-1 rounded-full">
                                            OK
                                        </div>
                                    )}
                                    <button
                                        onClick={() => removeDocument(key)}
                                        className="absolute top-2 left-2 bg-red-500 text-white w-6 h-6 rounded-full text-sm hover:bg-red-600"
                                    >
                                        ×
                                    </button>
                                    <div className="absolute bottom-0 inset-x-0 bg-theme-overlay p-2">
                                        <p className="text-theme-text-primary text-xs text-center truncate">{slot.label}</p>
                                    </div>
                                </div>
                            ) : (
                                // Upload placeholder
                                <div
                                    onClick={() => fileInputRefs.current[key]?.click()}
                                    className="aspect-[3/2] border-2 border-dashed border-theme-border rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-dr7-gold hover:bg-theme-bg-secondary/30 transition-all"
                                >
                                    <div className="text-lg font-bold text-dr7-gold mb-2">{slot.icon}</div>
                                    <p className="text-theme-text-primary text-xs font-medium text-center px-2">{slot.label}</p>
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
                            className="px-8 py-3 bg-dr7-gold text-white font-bold rounded-full hover:bg-[#247a6f] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {isExtracting ? (
                                <>
                                    <span className="animate-spin w-4 h-4 border-2 border-black border-t-transparent rounded-full"></span>
                                    Estrazione in corso...
                                </>
                            ) : (
                                <>
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
                            <div className="bg-theme-bg-secondary/50 p-3 rounded-lg">
                                <p className="text-xs text-theme-text-muted">Nome</p>
                                <p className="text-theme-text-primary font-medium">{mergedData.nome}</p>
                            </div>
                        )}
                        {mergedData.cognome && (
                            <div className="bg-theme-bg-secondary/50 p-3 rounded-lg">
                                <p className="text-xs text-theme-text-muted">Cognome</p>
                                <p className="text-theme-text-primary font-medium">{mergedData.cognome}</p>
                            </div>
                        )}
                        {mergedData.codice_fiscale && (
                            <div className="bg-theme-bg-secondary/50 p-3 rounded-lg md:col-span-2">
                                <p className="text-xs text-theme-text-muted">Codice Fiscale</p>
                                <p className="text-theme-text-primary font-mono text-sm">{mergedData.codice_fiscale}</p>
                            </div>
                        )}
                        {mergedData.data_nascita && (
                            <div className="bg-theme-bg-secondary/50 p-3 rounded-lg">
                                <p className="text-xs text-theme-text-muted">Data Nascita</p>
                                <p className="text-theme-text-primary font-medium">{mergedData.data_nascita}</p>
                            </div>
                        )}
                        {mergedData.luogo_nascita && (
                            <div className="bg-theme-bg-secondary/50 p-3 rounded-lg">
                                <p className="text-xs text-theme-text-muted">Luogo Nascita</p>
                                <p className="text-theme-text-primary font-medium">{mergedData.luogo_nascita}</p>
                            </div>
                        )}
                        {mergedData.documento_numero && (
                            <div className="bg-theme-bg-secondary/50 p-3 rounded-lg">
                                <p className="text-xs text-theme-text-muted">N. Documento</p>
                                <p className="text-theme-text-primary font-mono text-sm">{mergedData.documento_numero}</p>
                            </div>
                        )}
                        {mergedData.documento_scadenza && (
                            <div className="bg-theme-bg-secondary/50 p-3 rounded-lg">
                                <p className="text-xs text-theme-text-muted">Scadenza Doc.</p>
                                <p className="text-theme-text-primary font-medium">{mergedData.documento_scadenza}</p>
                            </div>
                        )}
                        {mergedData.patente_numero && (
                            <div className="bg-theme-bg-secondary/50 p-3 rounded-lg">
                                <p className="text-xs text-theme-text-muted">N. Patente</p>
                                <p className="text-theme-text-primary font-mono text-sm">{mergedData.patente_numero}</p>
                            </div>
                        )}
                        {mergedData.patente_tipo && (
                            <div className="bg-theme-bg-secondary/50 p-3 rounded-lg">
                                <p className="text-xs text-theme-text-muted">Tipo Patente</p>
                                <p className="text-theme-text-primary font-medium">{mergedData.patente_tipo}</p>
                            </div>
                        )}
                        {mergedData.patente_rilascio && (
                            <div className="bg-theme-bg-secondary/50 p-3 rounded-lg">
                                <p className="text-xs text-theme-text-muted">Data Rilascio Patente</p>
                                <p className="text-theme-text-primary font-medium">{mergedData.patente_rilascio}</p>
                            </div>
                        )}
                        {mergedData.patente_scadenza && (
                            <div className="bg-theme-bg-secondary/50 p-3 rounded-lg">
                                <p className="text-xs text-theme-text-muted">Scadenza Patente</p>
                                <p className="text-theme-text-primary font-medium">{mergedData.patente_scadenza}</p>
                            </div>
                        )}
                        {mergedData.patente_ente && (
                            <div className="bg-theme-bg-secondary/50 p-3 rounded-lg">
                                <p className="text-xs text-theme-text-muted">Ente Rilascio</p>
                                <p className="text-theme-text-primary font-medium">{mergedData.patente_ente}</p>
                            </div>
                        )}
                        {mergedData.indirizzo && (
                            <div className="bg-theme-bg-secondary/50 p-3 rounded-lg md:col-span-2">
                                <p className="text-xs text-theme-text-muted">Indirizzo</p>
                                <p className="text-theme-text-primary font-medium">{mergedData.indirizzo} {mergedData.numero_civico}</p>
                            </div>
                        )}
                        {mergedData.citta_residenza && (
                            <div className="bg-theme-bg-secondary/50 p-3 rounded-lg">
                                <p className="text-xs text-theme-text-muted">Città</p>
                                <p className="text-theme-text-primary font-medium">{mergedData.citta_residenza} ({mergedData.provincia_residenza})</p>
                            </div>
                        )}
                    </div>

                    {/* Open NewClientModal Button */}
                    <div className="flex justify-end gap-4 pt-4 border-t border-theme-border">
                        <button
                            onClick={resetAll}
                            className="px-6 py-3 bg-theme-bg-tertiary text-theme-text-primary rounded-full hover:bg-theme-bg-hover transition-colors"
                        >
                            Annulla
                        </button>
                        <button
                            onClick={openClientModal}
                            className="px-8 py-3 bg-dr7-gold text-white font-bold rounded-full hover:bg-[#247a6f] transition-all"
                        >
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
                        <div className="p-4 bg-theme-bg-secondary/50 rounded-xl text-center">
                            <div className="text-2xl font-bold text-dr7-gold mb-2">1</div>
                            <p className="text-theme-text-primary font-medium text-sm">Carica i documenti</p>
                            <p className="text-theme-text-muted text-xs mt-1">Fronte e retro di CI e Patente</p>
                        </div>
                        <div className="p-4 bg-theme-bg-secondary/50 rounded-xl text-center">
                            <div className="text-2xl font-bold text-dr7-gold mb-2">2</div>
                            <p className="text-theme-text-primary font-medium text-sm">Estrai i dati</p>
                            <p className="text-theme-text-muted text-xs mt-1">L'AI legge tutti i documenti</p>
                        </div>
                        <div className="p-4 bg-theme-bg-secondary/50 rounded-xl text-center">
                            <div className="text-2xl font-bold text-dr7-gold mb-2">3</div>
                            <p className="text-theme-text-primary font-medium text-sm">Verifica</p>
                            <p className="text-theme-text-muted text-xs mt-1">Controlla i dati estratti</p>
                        </div>
                        <div className="p-4 bg-theme-bg-secondary/50 rounded-xl text-center">
                            <div className="text-2xl font-bold text-dr7-gold mb-2">4</div>
                            <p className="text-theme-text-primary font-medium text-sm">Crea Cliente</p>
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
                    logger.log('Client created:', clientId);
                    setShowNewClientModal(false);
                    resetAll();
                    setSuccess('Cliente creato con successo!');
                }}
                initialData={clientModalData}
            />
        </div>
    );
}
