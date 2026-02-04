import { useState } from 'react';
import { supabase } from '../../supabaseClient';
import { QRCodeSVG } from 'qrcode.react';

export default function ScanJobCreator() {
    const [currentJobId, setCurrentJobId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    async function createNewJob() {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('scan_jobs')
                .insert([{ status: 'pending', created_by: (await supabase.auth.getUser()).data.user?.id }])
                .select()
                .single();

            if (error) throw error;
            setCurrentJobId(data.id);
        } catch (err) {
            console.error('Error creating scan job:', err);
            alert('Errore nella creazione del job');
        } finally {
            setLoading(false);
        }
    }

    function handlePrint() {
        window.print();
    }

    return (
        <div className="bg-theme-bg-secondary p-6 rounded-3xl border border-theme-border">
            <h2 className="text-2xl font-bold text-theme-text-primary mb-6">Nuova Scansione</h2>

            {!currentJobId ? (
                <div className="text-center py-12">
                    <button
                        onClick={createNewJob}
                        disabled={loading}
                        className="px-8 py-4 bg-dr7-gold text-black text-xl font-bold rounded-full hover:bg-yellow-500 transition-colors disabled:opacity-50"
                    >
                        {loading ? 'Generazione...' : 'Genera Cover Sheet QR'}
                    </button>
                    <p className="mt-4 text-theme-text-muted">
                        Genera un codice QR da stampare e usare come copertina per la scansione.
                    </p>
                </div>
            ) : (
                <div className="flex flex-col items-center animate-fade-in">
                    <div id="print-area" className="bg-theme-text-primary p-8 rounded-full mb-6 text-center max-w-sm w-full mx-auto">
                        <h1 className="text-2xl text-black font-bold mb-4">SCAN COVER SHEET</h1>
                        <p className="text-black mb-4 font-mono">{new Date().toLocaleString()}</p>
                        <div className="flex justify-center mb-4">
                            <QRCodeSVG value={JSON.stringify({ jobId: currentJobId })} size={200} />
                        </div>
                        <p className="text-black font-mono text-sm">{currentJobId}</p>
                        <div className="mt-8 border-t border-dashed border-black pt-4 text-black text-sm">
                            <p>1. Posiziona questo foglio come PRIMA PAGINA.</p>
                            <p>2. Inserisci i documenti dietro.</p>
                            <p>3. Scansiona tutto insieme.</p>
                        </div>
                    </div>

                    <div className="flex gap-4 print:hidden">
                        <button
                            onClick={handlePrint}
                            className="px-6 py-2 bg-theme-text-primary text-theme-bg-primary font-bold rounded-full hover:bg-theme-text-secondary"
                        >
                            Stampa Cover Sheet
                        </button>
                        <button
                            onClick={() => setCurrentJobId(null)}
                            className="px-6 py-2 bg-theme-bg-tertiary text-theme-text-primary font-bold rounded-full hover:bg-theme-bg-hover"
                        >
                            Nuova Scansione
                        </button>
                    </div>
                </div>
            )}

            {/* Print Styles */}
            <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #print-area, #print-area * {
            visibility: visible;
          }
          #print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            margin: 0;
            padding: 2cm;
            border: none;
            border-radius: 0;
          }
        }
      `}</style>
        </div>
    );
}
