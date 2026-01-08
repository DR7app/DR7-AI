import { useState } from 'react';
import IncomingScansList from '../../../components/Scanner/IncomingScansList';
import { supabase } from '../../../supabaseClient';

export default function ScannerTab() {
    const [uploading, setUploading] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);
    const [showScanner, setShowScanner] = useState(false);

    async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        if (!file) return;

        if (file.type !== 'application/pdf') {
            alert('Solo file PDF sono supportati');
            return;
        }

        setUploading(true);
        try {
            // 1. Upload to storage
            const fileName = `${Date.now()}_${file.name}`;
            const { error: uploadError } = await supabase.storage
                .from('scans')
                .upload(fileName, file, {
                    contentType: 'application/pdf'
                });

            if (uploadError) throw uploadError;

            // 2. Create DB record
            const { error: dbError } = await supabase
                .from('document_uploads')
                .insert([{
                    file_path: fileName,
                    original_filename: file.name,
                    mime_type: 'application/pdf',
                    size_bytes: file.size,
                    status: 'ready',
                    metadata: {
                        source: 'direct-upload',
                        uploaded_at: new Date().toISOString()
                    }
                }]);

            if (dbError) throw dbError;

            // 3. Refresh the list
            setRefreshKey(prev => prev + 1);

            // Reset input
            event.target.value = '';

            alert('Documento caricato con successo! Clicca "🔍 OCR" per estrarre i dati.');
        } catch (error: any) {
            console.error('Upload error:', error);
            alert(`Errore nel caricamento: ${error.message}`);
        } finally {
            setUploading(false);
        }
    }

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Scanner Interface */}
            <div className="bg-gray-900 p-6 rounded-3xl border border-gray-800">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold text-white">Scanner Brother</h2>
                    <button
                        onClick={() => setShowScanner(!showScanner)}
                        className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
                    >
                        {showScanner ? '✕ Chiudi Scanner' : '🖨️ Apri Scanner'}
                    </button>
                </div>

                {showScanner && (
                    <div className="bg-white rounded-xl overflow-hidden border-4 border-gray-700">
                        <iframe
                            src="http://192.168.1.214/#/scan/pc"
                            className="w-full h-[600px]"
                            title="Brother Scanner"
                        />
                    </div>
                )}

                {!showScanner && (
                    <div>
                        <p className="text-gray-400 mb-6">
                            Clicca "Apri Scanner" per scansionare documenti direttamente dalla stampante Brother.
                        </p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Open Scanner Button */}
                            <button
                                onClick={() => setShowScanner(true)}
                                className="px-8 py-4 bg-dr7-gold text-black text-xl font-bold rounded-xl hover:bg-yellow-500 transition-colors"
                            >
                                🖨️ Apri Scanner Integrato
                            </button>

                            {/* Manual Upload */}
                            <label className="cursor-pointer">
                                <input
                                    type="file"
                                    accept="application/pdf"
                                    onChange={handleFileUpload}
                                    disabled={uploading}
                                    className="hidden"
                                    id="scan-upload"
                                />
                                <div className="px-8 py-4 bg-gray-700 text-white text-xl font-bold rounded-xl hover:bg-gray-600 transition-colors text-center">
                                    {uploading ? '⏳ Caricamento...' : '📄 Carica PDF'}
                                </div>
                            </label>
                        </div>

                        <div className="mt-4 p-4 bg-gray-800/50 rounded-xl border border-gray-700">
                            <h3 className="text-sm font-semibold text-dr7-gold mb-2">Come funziona:</h3>
                            <ol className="text-sm text-gray-400 space-y-1 list-decimal list-inside">
                                <li>Clicca "🖨️ Apri Scanner Integrato"</li>
                                <li>Usa l'interfaccia Brother per scansionare</li>
                                <li>Scarica il PDF dalla stampante</li>
                                <li>Clicca "📄 Carica PDF" per caricarlo</li>
                                <li>Clicca "🔍 OCR" nella lista sotto per estrarre i dati</li>
                                <li>Clicca "Revisiona" → "Crea Nuovo Cliente"</li>
                            </ol>
                        </div>
                    </div>
                )}
            </div>

            {/* Inbox List */}
            <IncomingScansList key={refreshKey} />
        </div>
    );
}
