import { useState } from 'react';
import ScanJobCreator from '../../../components/Scanner/ScanJobCreator';
import IncomingScansList from '../../../components/Scanner/IncomingScansList';

export default function ScannerTab() {
    const [activeSubTab, setActiveSubTab] = useState<'new' | 'inbox'>('new');

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Sub Tabs */}
            <div className="flex space-x-4 mb-4 border-b border-gray-800 pb-4">
                <button
                    onClick={() => setActiveSubTab('new')}
                    className={`px-4 py-2 rounded-xl transition-all ${activeSubTab === 'new'
                        ? 'bg-dr7-gold text-black font-bold shadow-lg shadow-dr7-gold/20'
                        : 'text-gray-400 hover:text-white hover:bg-gray-800'
                        }`}
                >
                    Nuova Scansione
                </button>
                <button
                    onClick={() => setActiveSubTab('inbox')}
                    className={`px-4 py-2 rounded-xl transition-all ${activeSubTab === 'inbox'
                        ? 'bg-dr7-gold text-black font-bold shadow-lg shadow-dr7-gold/20'
                        : 'text-gray-400 hover:text-white hover:bg-gray-800'
                        }`}
                >
                    Inbox Scansioni
                </button>
            </div>

            {activeSubTab === 'new' && <ScanJobCreator />}
            {activeSubTab === 'inbox' && <IncomingScansList />}
        </div>
    );
}
