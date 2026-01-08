import { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import DocumentReviewModal from './DocumentReviewModal';

export default function IncomingScansList() {
    const [scans, setScans] = useState<any[]>([]);
    const [selectedScan, setSelectedScan] = useState<any | null>(null);

    useEffect(() => {
        fetchScans();

        const channel = supabase
            .channel('document-uploads-changes')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'document_uploads' },
                () => {
                    fetchScans();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    async function fetchScans() {
        const { data, error } = await supabase
            .from('document_uploads')
            .select('*, customers_extended(nome, cognome)')
            .order('created_at', { ascending: false });

        if (!error && data) {
            setScans(data);
        }
    }

    return (
        <div className="bg-gray-900 p-6 rounded-3xl border border-gray-800">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-white">Inbox Scansioni</h2>
                <button onClick={fetchScans} className="text-gray-400 hover:text-white">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left text-gray-300">
                    <thead className="text-xs text-gray-500 uppercase bg-gray-800/50">
                        <tr>
                            <th className="px-6 py-3">Data</th>
                            <th className="px-6 py-3">File</th>
                            <th className="px-6 py-3">Job ID</th>
                            <th className="px-6 py-3">Cliente</th>
                            <th className="px-6 py-3">Stato</th>
                            <th className="px-6 py-3">Azioni</th>
                        </tr>
                    </thead>
                    <tbody>
                        {scans.map((scan) => (
                            <tr key={scan.id} className="border-b border-gray-800 hover:bg-gray-800/30 transition-colors">
                                <td className="px-6 py-4">{new Date(scan.created_at).toLocaleString()}</td>
                                <td className="px-6 py-4 font-mono text-sm">{scan.original_filename}</td>
                                <td className="px-6 py-4 text-xs font-mono">{scan.scan_job_id || '-'}</td>
                                <td className="px-6 py-4">
                                    {scan.customers_extended ? (
                                        <span className="text-dr7-gold">{scan.customers_extended.nome} {scan.customers_extended.cognome}</span>
                                    ) : (
                                        <span className="text-gray-500 italic">Da assegnare</span>
                                    )}
                                </td>
                                <td className="px-6 py-4">
                                    <span className={`px-2 py-1 text-xs rounded-full ${scan.status === 'confirmed' ? 'bg-green-900 text-green-300' :
                                            scan.status === 'processing' ? 'bg-blue-900 text-blue-300' :
                                                'bg-yellow-900 text-yellow-300'
                                        }`}>
                                        {scan.status}
                                    </span>
                                </td>
                                <td className="px-6 py-4">
                                    <button
                                        onClick={() => setSelectedScan(scan)}
                                        className="text-dr7-gold hover:text-white font-medium text-sm"
                                    >
                                        Revisiona
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {scans.length === 0 && (
                    <div className="text-center py-8 text-gray-500">Nessuna scansione in arrivo</div>
                )}
            </div>

            {selectedScan && (
                <DocumentReviewModal
                    scan={selectedScan}
                    isOpen={!!selectedScan}
                    onClose={() => setSelectedScan(null)}
                    onUpdate={fetchScans}
                />
            )}
        </div>
    );
}
