import { useState, useRef } from 'react';
import { supabase } from '../../../supabaseClient';

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

    // Document Info
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

export default function ScannerTab() {
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [imageBase64, setImageBase64] = useState<string | null>(null);
    const [extracting, setExtracting] = useState(false);
    const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
    const [editableData, setEditableData] = useState<ExtractedData>({});
    const [creatingCustomer, setCreatingCustomer] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const cameraInputRef = useRef<HTMLInputElement>(null);

    // Reset states
    const resetAll = () => {
        setImagePreview(null);
        setImageBase64(null);
        setExtractedData(null);
        setEditableData({});
        setError(null);
        setSuccess(null);
    };

    // Handle file selection
    const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        // Validate file type
        const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
        if (!validTypes.includes(file.type)) {
            setError('Formato non supportato. Usa JPG, PNG o WEBP.');
            return;
        }

        // Validate file size (max 10MB)
        if (file.size > 10 * 1024 * 1024) {
            setError('File troppo grande. Massimo 10MB.');
            return;
        }

        setError(null);
        setSuccess(null);
        setExtractedData(null);

        // Read file as base64
        const reader = new FileReader();
        reader.onload = (e) => {
            const result = e.target?.result as string;
            setImagePreview(result);
            // Extract base64 data (remove data:image/...;base64, prefix)
            const base64 = result.split(',')[1];
            setImageBase64(base64);
        };
        reader.readAsDataURL(file);

        // Reset file input
        event.target.value = '';
    };

    // Extract data from image using Claude
    const handleExtract = async () => {
        if (!imageBase64) {
            setError('Nessuna immagine caricata');
            return;
        }

        setExtracting(true);
        setError(null);

        try {
            const response = await fetch('/.netlify/functions/extract-document-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageBase64 })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Estrazione fallita');
            }

            if (result.success && result.data) {
                setExtractedData(result.data);
                setEditableData(result.data);
                setSuccess('Dati estratti con successo!');
            } else {
                throw new Error('Nessun dato estratto');
            }
        } catch (err: any) {
            console.error('Extraction error:', err);
            setError(err.message || 'Errore durante l\'estrazione');
        } finally {
            setExtracting(false);
        }
    };

    // Handle field edit
    const handleFieldChange = (field: keyof ExtractedData, value: string) => {
        setEditableData(prev => ({ ...prev, [field]: value }));
    };

    // Create customer from extracted data
    const handleCreateCustomer = async () => {
        if (!editableData.nome || !editableData.cognome) {
            setError('Nome e cognome sono obbligatori');
            return;
        }

        setCreatingCustomer(true);
        setError(null);

        try {
            // Check if customer already exists by codice_fiscale
            if (editableData.codice_fiscale) {
                const { data: existing } = await supabase
                    .from('customers_extended')
                    .select('id, nome, cognome')
                    .eq('codice_fiscale', editableData.codice_fiscale)
                    .single();

                if (existing) {
                    setError(`Cliente già esistente: ${existing.nome} ${existing.cognome}`);
                    setCreatingCustomer(false);
                    return;
                }
            }

            // Prepare customer data
            const customerData: any = {
                tipo_cliente: 'persona_fisica',
                nome: editableData.nome,
                cognome: editableData.cognome,
                codice_fiscale: editableData.codice_fiscale || null,
                sesso: editableData.sesso || null,
                data_nascita: editableData.data_nascita || null,
                luogo_nascita: editableData.luogo_nascita || null,
                provincia_nascita: editableData.provincia_nascita || null,
                indirizzo: editableData.indirizzo || null,
                numero_civico: editableData.numero_civico || null,
                codice_postale: editableData.codice_postale || null,
                citta_residenza: editableData.citta_residenza || null,
                provincia_residenza: editableData.provincia_residenza || null,
                nazione: 'Italia',
            };

            // Add document info if present
            if (editableData.documento_numero) {
                customerData.numero_documento = editableData.documento_numero;
                customerData.data_scadenza_documento = editableData.documento_scadenza || null;
            }

            // Add driver's license if present
            if (editableData.patente_numero) {
                customerData.patente_numero = editableData.patente_numero;
                customerData.patente_tipo = editableData.patente_tipo || null;
                customerData.patente_rilascio = editableData.patente_rilascio || null;
                customerData.patente_scadenza = editableData.patente_scadenza || null;
                customerData.patente_ente = editableData.patente_ente || null;
            }

            // Create customer
            const { data: newCustomer, error: createError } = await supabase
                .from('customers_extended')
                .insert([customerData])
                .select()
                .single();

            if (createError) throw createError;

            setSuccess(`Cliente creato: ${newCustomer.nome} ${newCustomer.cognome}`);

            // Reset after success
            setTimeout(() => {
                resetAll();
            }, 2000);

        } catch (err: any) {
            console.error('Customer creation error:', err);
            setError(err.message || 'Errore nella creazione del cliente');
        } finally {
            setCreatingCustomer(false);
        }
    };

    // Render field input
    const renderField = (label: string, field: keyof ExtractedData, type: string = 'text', placeholder?: string) => {
        const value = editableData[field] || '';
        const originalValue = extractedData?.[field];
        const isModified = originalValue && value !== originalValue;

        return (
            <div className="relative">
                <label className="block text-xs text-theme-text-muted mb-1">{label}</label>
                <input
                    type={type}
                    value={value}
                    onChange={(e) => handleFieldChange(field, e.target.value)}
                    placeholder={placeholder}
                    className={`w-full bg-gray-800 border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-dr7-gold ${
                        isModified ? 'border-yellow-500' : 'border-gray-700'
                    }`}
                />
                {isModified && (
                    <span className="absolute right-2 top-7 text-yellow-500 text-xs">modificato</span>
                )}
            </div>
        );
    };

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Header */}
            <div className="bg-theme-bg-secondary p-6 rounded-3xl border border-theme-border">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-2xl font-bold text-theme-text-primary">Scanner Documenti</h2>
                        <p className="text-theme-text-muted text-sm mt-1">
                            Carica una foto del documento per estrarre automaticamente i dati
                        </p>
                    </div>
                    {(imagePreview || extractedData) && (
                        <button
                            onClick={resetAll}
                            className="px-4 py-2 bg-gray-700 text-white rounded-full hover:bg-gray-600 transition-colors text-sm"
                        >
                            Ricomincia
                        </button>
                    )}
                </div>

                {/* Upload Section */}
                {!imagePreview && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* File Upload */}
                        <label className="cursor-pointer">
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                onChange={handleFileSelect}
                                className="hidden"
                            />
                            <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-gray-600 rounded-2xl hover:border-dr7-gold hover:bg-gray-800/30 transition-all">
                                <div className="text-5xl mb-4">📁</div>
                                <p className="text-white font-semibold mb-1">Carica Immagine</p>
                                <p className="text-theme-text-muted text-sm">JPG, PNG o WEBP</p>
                            </div>
                        </label>

                        {/* Camera Capture */}
                        <label className="cursor-pointer">
                            <input
                                ref={cameraInputRef}
                                type="file"
                                accept="image/*"
                                capture="environment"
                                onChange={handleFileSelect}
                                className="hidden"
                            />
                            <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-gray-600 rounded-2xl hover:border-dr7-gold hover:bg-gray-800/30 transition-all">
                                <div className="text-5xl mb-4">📷</div>
                                <p className="text-white font-semibold mb-1">Scatta Foto</p>
                                <p className="text-theme-text-muted text-sm">Usa la fotocamera</p>
                            </div>
                        </label>
                    </div>
                )}

                {/* Image Preview */}
                {imagePreview && !extractedData && (
                    <div className="space-y-4">
                        <div className="relative rounded-2xl overflow-hidden bg-black/50 max-w-2xl mx-auto">
                            <img
                                src={imagePreview}
                                alt="Documento"
                                className="w-full h-auto max-h-[400px] object-contain"
                            />
                        </div>

                        <div className="flex justify-center gap-4">
                            <button
                                onClick={() => {
                                    setImagePreview(null);
                                    setImageBase64(null);
                                }}
                                className="px-6 py-3 bg-gray-700 text-white rounded-full hover:bg-gray-600 transition-colors"
                            >
                                Cambia Immagine
                            </button>
                            <button
                                onClick={handleExtract}
                                disabled={extracting}
                                className="px-8 py-3 bg-dr7-gold text-black font-bold rounded-full hover:bg-yellow-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                                {extracting ? (
                                    <>
                                        <span className="animate-spin">⏳</span>
                                        Estrazione in corso...
                                    </>
                                ) : (
                                    <>
                                        <span>🔍</span>
                                        Estrai Dati
                                    </>
                                )}
                            </button>
                        </div>
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

            {/* Extracted Data Form */}
            {extractedData && (
                <div className="bg-theme-bg-secondary p-6 rounded-3xl border border-theme-border">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h3 className="text-xl font-bold text-theme-text-primary">Dati Estratti</h3>
                            <div className="flex items-center gap-2 mt-1">
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                    extractedData.confidence === 'high' ? 'bg-green-900/50 text-green-300' :
                                    extractedData.confidence === 'medium' ? 'bg-yellow-900/50 text-yellow-300' :
                                    'bg-red-900/50 text-red-300'
                                }`}>
                                    Confidenza: {extractedData.confidence || 'N/A'}
                                </span>
                                {extractedData.document_type && (
                                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-900/50 text-blue-300">
                                        {extractedData.document_type === 'carta_identita' ? 'Carta d\'Identità' :
                                         extractedData.document_type === 'patente' ? 'Patente di Guida' :
                                         extractedData.document_type === 'passaporto' ? 'Passaporto' :
                                         extractedData.document_type}
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <img
                                src={imagePreview!}
                                alt="Documento"
                                className="w-16 h-16 object-cover rounded-lg border border-gray-700"
                            />
                        </div>
                    </div>

                    {extractedData.notes && (
                        <div className="mb-4 p-3 bg-yellow-900/20 border border-yellow-600/30 rounded-lg">
                            <p className="text-yellow-300 text-sm">{extractedData.notes}</p>
                        </div>
                    )}

                    {/* Personal Info */}
                    <div className="mb-6">
                        <h4 className="text-sm font-semibold text-dr7-gold mb-3 uppercase tracking-wide">Dati Personali</h4>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {renderField('Nome', 'nome', 'text', 'Mario')}
                            {renderField('Cognome', 'cognome', 'text', 'Rossi')}
                            {renderField('Sesso', 'sesso', 'text', 'M o F')}
                            {renderField('Data di Nascita', 'data_nascita', 'date')}
                            {renderField('Luogo di Nascita', 'luogo_nascita', 'text', 'Roma')}
                            {renderField('Provincia', 'provincia_nascita', 'text', 'RM')}
                            <div className="md:col-span-2">
                                {renderField('Codice Fiscale', 'codice_fiscale', 'text', 'RSSMRA85M01H501Z')}
                            </div>
                        </div>
                    </div>

                    {/* Address */}
                    <div className="mb-6">
                        <h4 className="text-sm font-semibold text-dr7-gold mb-3 uppercase tracking-wide">Indirizzo</h4>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="md:col-span-2">
                                {renderField('Via/Piazza', 'indirizzo', 'text', 'Via Roma')}
                            </div>
                            {renderField('N. Civico', 'numero_civico', 'text', '123')}
                            {renderField('CAP', 'codice_postale', 'text', '00100')}
                            {renderField('Città', 'citta_residenza', 'text', 'Roma')}
                            {renderField('Provincia', 'provincia_residenza', 'text', 'RM')}
                        </div>
                    </div>

                    {/* Document Info */}
                    {(extractedData.documento_numero || extractedData.document_type === 'carta_identita') && (
                        <div className="mb-6">
                            <h4 className="text-sm font-semibold text-dr7-gold mb-3 uppercase tracking-wide">Documento d'Identità</h4>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                {renderField('Numero', 'documento_numero', 'text', 'CA00000AA')}
                                {renderField('Rilasciato il', 'documento_rilascio', 'date')}
                                {renderField('Scadenza', 'documento_scadenza', 'date')}
                                {renderField('Ente', 'documento_ente', 'text', 'Comune di Roma')}
                            </div>
                        </div>
                    )}

                    {/* Driver's License */}
                    {(extractedData.patente_numero || extractedData.document_type === 'patente') && (
                        <div className="mb-6">
                            <h4 className="text-sm font-semibold text-dr7-gold mb-3 uppercase tracking-wide">Patente di Guida</h4>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                {renderField('Numero', 'patente_numero', 'text', 'AB1234567')}
                                {renderField('Categoria', 'patente_tipo', 'text', 'B')}
                                {renderField('Rilasciata il', 'patente_rilascio', 'date')}
                                {renderField('Scadenza', 'patente_scadenza', 'date')}
                                {renderField('Ente', 'patente_ente', 'text', 'MCTC')}
                            </div>
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex justify-end gap-4 pt-4 border-t border-gray-700">
                        <button
                            onClick={resetAll}
                            className="px-6 py-3 bg-gray-700 text-white rounded-full hover:bg-gray-600 transition-colors"
                        >
                            Annulla
                        </button>
                        <button
                            onClick={handleCreateCustomer}
                            disabled={creatingCustomer || !editableData.nome || !editableData.cognome}
                            className="px-8 py-3 bg-dr7-gold text-black font-bold rounded-full hover:bg-yellow-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {creatingCustomer ? (
                                <>
                                    <span className="animate-spin">⏳</span>
                                    Creazione...
                                </>
                            ) : (
                                <>
                                    <span>✅</span>
                                    Crea Cliente
                                </>
                            )}
                        </button>
                    </div>
                </div>
            )}

            {/* Instructions */}
            {!imagePreview && !extractedData && (
                <div className="bg-theme-bg-secondary p-6 rounded-3xl border border-theme-border">
                    <h3 className="text-lg font-bold text-theme-text-primary mb-4">Documenti Supportati</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="p-4 bg-gray-800/50 rounded-xl text-center">
                            <div className="text-3xl mb-2">🪪</div>
                            <p className="text-white font-medium text-sm">Carta d'Identità</p>
                        </div>
                        <div className="p-4 bg-gray-800/50 rounded-xl text-center">
                            <div className="text-3xl mb-2">🚗</div>
                            <p className="text-white font-medium text-sm">Patente di Guida</p>
                        </div>
                        <div className="p-4 bg-gray-800/50 rounded-xl text-center">
                            <div className="text-3xl mb-2">✈️</div>
                            <p className="text-white font-medium text-sm">Passaporto</p>
                        </div>
                        <div className="p-4 bg-gray-800/50 rounded-xl text-center">
                            <div className="text-3xl mb-2">💳</div>
                            <p className="text-white font-medium text-sm">Tessera Sanitaria</p>
                        </div>
                    </div>

                    <div className="mt-6 p-4 bg-blue-900/20 border border-blue-600/30 rounded-xl">
                        <h4 className="text-blue-300 font-semibold mb-2">Come funziona:</h4>
                        <ol className="text-sm text-theme-text-muted space-y-2 list-decimal list-inside">
                            <li>Carica una foto del documento (fronte) o scatta una foto</li>
                            <li>L'AI analizza l'immagine ed estrae automaticamente tutti i dati</li>
                            <li>Verifica e modifica i dati estratti se necessario</li>
                            <li>Clicca "Crea Cliente" per salvare nel database</li>
                        </ol>
                    </div>
                </div>
            )}
        </div>
    );
}
