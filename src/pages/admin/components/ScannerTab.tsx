import { useState, useEffect } from 'react';
import IncomingScansList from '../../../components/Scanner/IncomingScansList';
import { supabase } from '../../../supabaseClient';

export default function ScannerTab() {
    const [uploading, setUploading] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);
    const [latestScan, setLatestScan] = useState<any | null>(null);
    const [creatingCustomer, setCreatingCustomer] = useState(false);

    // Fetch latest scan on mount and when refreshKey changes
    useEffect(() => {
        fetchLatestScan();

        // Subscribe to real-time updates
        const channel = supabase
            .channel('scanner-updates')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'document_uploads' },
                () => {
                    fetchLatestScan();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [refreshKey]);

    async function fetchLatestScan() {
        const { data, error } = await supabase
            .from('document_uploads')
            .select('*, customers_extended(nome, cognome)')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (!error && data) {
            setLatestScan(data);
        }
    }

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

            // 3. Refresh
            setRefreshKey(prev => prev + 1);
            event.target.value = '';

            alert('Documento caricato! OCR in corso...');
        } catch (error: any) {
            console.error('Upload error:', error);
            alert(`Errore nel caricamento: ${error.message}`);
        } finally {
            setUploading(false);
        }
    }

    async function createCustomerFromScan() {
        if (!latestScan?.extracted_data) return;

        setCreatingCustomer(true);
        try {
            const data = latestScan.extracted_data;

            // Parse date from DD/MM/YYYY to YYYY-MM-DD
            let birthDate = data.data_nascita;
            if (birthDate && birthDate.includes('/')) {
                const [day, month, year] = birthDate.split('/');
                birthDate = `${year}-${month}-${day}`;
            }

            // Create customer
            const { data: newCustomer, error: customerError } = await supabase
                .from('customers_extended')
                .insert([{
                    nome: data.nome || '',
                    cognome: data.cognome || '',
                    codice_fiscale: data.codice_fiscale || '',
                    data_nascita: birthDate || null,
                    luogo_nascita: data.luogo_nascita || '',
                    numero_documento: data.numero_documento || '',
                    data_scadenza_documento: data.data_scadenza || null,
                    indirizzo: data.indirizzo || '',
                }])
                .select()
                .single();

            if (customerError) throw customerError;

            // Link document to customer
            await supabase
                .from('document_uploads')
                .update({
                    customer_id: newCustomer.id,
                    status: 'confirmed'
                })
                .eq('id', latestScan.id);

            alert(`✅ Cliente creato: ${data.nome} ${data.cognome}`);
            setRefreshKey(prev => prev + 1);
        } catch (error: any) {
            console.error('Customer creation error:', error);
            alert(`Errore nella creazione del cliente: ${error.message}`);
        } finally {
            setCreatingCustomer(false);
        }
    }

    const hasExtractedData = latestScan?.extracted_data?.nome;
    const isProcessing = latestScan && !hasExtractedData && latestScan.status !== 'confirmed';

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Main Scanner Card */}
            <div className="bg-theme-bg-secondary p-8 rounded-3xl border border-theme-border">
                <h2 className="text-3xl font-bold text-theme-text-primary mb-6">📸 Scanner Documenti</h2>

                {/* Scan Button */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <button
                        onClick={() => {
                            const scanWindow = window.open(
                                'http://192.168.1.214/#/scan/pc',
                                'BrotherScanner',
                                'width=1000,height=800,menubar=no,toolbar=no,location=no'
                            );
                            if (scanWindow) scanWindow.focus();
                        }}
                        className="px-8 py-6 bg-dr7-gold text-black text-2xl font-bold rounded-xl hover:bg-yellow-500 transition-all transform hover:scale-105"
                    >
                        🖨️ Scansiona Documento
                    </button>

                    <label className="cursor-pointer">
                        <input
                            type="file"
                            accept="application/pdf"
                            onChange={handleFileUpload}
                            disabled={uploading}
                            className="hidden"
                        />
                        <div className="px-8 py-6 bg-gray-700 text-theme-text-primary text-2xl font-bold rounded-xl hover:bg-gray-600 transition-all text-center">
                            {uploading ? '⏳ Caricamento...' : '📄 Carica PDF'}
                        </div>
                    </label>
                </div>

                {/* Status Indicator */}
                {isProcessing && (
                    <div className="p-4 bg-blue-900/30 border border-blue-500 rounded-xl mb-6">
                        <div className="flex items-center gap-3">
                            <div className="animate-spin text-2xl">🔄</div>
                            <div>
                                <p className="text-blue-300 font-semibold">Elaborazione OCR in corso...</p>
                                <p className="text-sm text-blue-400">Estrazione dati dal documento</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Latest Scan Card with Extracted Data */}
                {hasExtractedData && (
                    <div className="p-6 bg-gradient-to-br from-green-900/20 to-emerald-900/20 border-2 border-green-500 rounded-xl">
                        <div className="flex justify-between items-start mb-4">
                            <h3 className="text-xl font-bold text-green-300">✅ Ultimo Documento Scansionato</h3>
                            <span className="text-xs text-theme-text-muted">
                                {new Date(latestScan.created_at).toLocaleString()}
                            </span>
                        </div>

                        <div className="grid grid-cols-2 gap-4 mb-6">
                            <div>
                                <p className="text-xs text-theme-text-muted mb-1">Nome</p>
                                <p className="text-lg font-semibold text-theme-text-primary">
                                    {latestScan.extracted_data.nome || '-'}
                                </p>
                            </div>
                            <div>
                                <p className="text-xs text-theme-text-muted mb-1">Cognome</p>
                                <p className="text-lg font-semibold text-theme-text-primary">
                                    {latestScan.extracted_data.cognome || '-'}
                                </p>
                            </div>
                            <div>
                                <p className="text-xs text-theme-text-muted mb-1">Codice Fiscale</p>
                                <p className="text-sm font-mono text-theme-text-primary">
                                    {latestScan.extracted_data.codice_fiscale || '-'}
                                </p>
                            </div>
                            <div>
                                <p className="text-xs text-theme-text-muted mb-1">Data di Nascita</p>
                                <p className="text-sm text-theme-text-primary">
                                    {latestScan.extracted_data.data_nascita || '-'}
                                </p>
                            </div>
                            <div className="col-span-2">
                                <p className="text-xs text-theme-text-muted mb-1">Numero Documento</p>
                                <p className="text-sm font-mono text-theme-text-primary">
                                    {latestScan.extracted_data.numero_documento || '-'}
                                </p>
                            </div>
                        </div>

                        {!latestScan.customer_id ? (
                            <button
                                onClick={createCustomerFromScan}
                                disabled={creatingCustomer}
                                className="w-full px-6 py-4 bg-dr7-gold text-black text-xl font-bold rounded-xl hover:bg-yellow-500 transition-all disabled:opacity-50"
                            >
                                {creatingCustomer ? '⏳ Creazione...' : '✅ Crea Nuovo Cliente'}
                            </button>
                        ) : (
                            <div className="p-4 bg-green-900/30 rounded-xl text-center">
                                <p className="text-green-300 font-semibold">
                                    ✅ Cliente già creato: {latestScan.customers_extended?.nome} {latestScan.customers_extended?.cognome}
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {/* Instructions */}
                {!latestScan && (
                    <div className="p-4 bg-theme-bg-tertiary/50 rounded-xl border border-theme-border">
                        <h3 className="text-sm font-semibold text-dr7-gold mb-2">Come funziona:</h3>
                        <ol className="text-sm text-theme-text-muted space-y-1 list-decimal list-inside">
                            <li>Clicca "🖨️ Scansiona Documento" (o usa il pulsante fisico sulla stampante)</li>
                            <li>Il sistema rileva automaticamente il documento</li>
                            <li>L'OCR estrae i dati (nome, cognome, CF, ecc.)</li>
                            <li>Clicca "✅ Crea Nuovo Cliente" per salvare</li>
                        </ol>
                    </div>
                )}
            </div>

            {/* History Inbox */}
            <IncomingScansList key={refreshKey} />
        </div>
    );
}
