import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'

interface InventoryItem {
    id: string
    item_type: 'olio' | 'pastiglie_ant' | 'pastiglie_post'
    quantity: number
    unit: string
    supplier_url: string | null
    updated_at: string
}

const SUPPLIER_URLS = {
    olio: 'https://www.amazon.it/s?k=olio+motore+5w30',
    pastiglie_ant: 'https://www.amazon.it/s?k=pastiglie+freno+anteriori',
    pastiglie_post: 'https://www.amazon.it/s?k=pastiglie+freno+posteriori'
}

export default function FleetInventory() {
    const [inventory, setInventory] = useState<InventoryItem[]>([])
    const [loading, setLoading] = useState(true)
    const [editing, setEditing] = useState<string | null>(null)
    const [editValue, setEditValue] = useState<number>(0)

    useEffect(() => {
        loadInventory()
    }, [])

    async function loadInventory() {
        try {
            setLoading(true)
            const { data, error } = await supabase
                .from('fleet_inventory')
                .select('*')
                .order('item_type')

            if (error) throw error

            // If no inventory exists, create default items
            if (!data || data.length === 0) {
                await initializeInventory()
                return
            }

            setInventory(data)
        } catch (error) {
            console.error('Error loading inventory:', error)
        } finally {
            setLoading(false)
        }
    }

    async function initializeInventory() {
        const defaultItems = [
            { item_type: 'olio', quantity: 0, unit: 'litri', supplier_url: SUPPLIER_URLS.olio },
            { item_type: 'pastiglie_ant', quantity: 0, unit: 'pezzi', supplier_url: SUPPLIER_URLS.pastiglie_ant },
            { item_type: 'pastiglie_post', quantity: 0, unit: 'pezzi', supplier_url: SUPPLIER_URLS.pastiglie_post }
        ]

        const { data, error } = await supabase
            .from('fleet_inventory')
            .insert(defaultItems)
            .select()

        if (error) {
            console.error('Error initializing inventory:', error)
            return
        }

        setInventory(data || [])
        setLoading(false)
    }

    async function updateQuantity(itemId: string, newQuantity: number) {
        try {
            const { error } = await supabase
                .from('fleet_inventory')
                .update({ quantity: newQuantity, updated_at: new Date().toISOString() })
                .eq('id', itemId)

            if (error) throw error

            setInventory(prev => prev.map(item =>
                item.id === itemId ? { ...item, quantity: newQuantity } : item
            ))
            setEditing(null)
        } catch (error) {
            console.error('Error updating quantity:', error)
            alert('Errore aggiornamento quantità')
        }
    }

    function getItemLabel(itemType: string): string {
        switch (itemType) {
            case 'olio': return 'Olio Motore'
            case 'pastiglie_ant': return 'Pastiglie Freno Anteriori'
            case 'pastiglie_post': return 'Pastiglie Freno Posteriori'
            default: return itemType
        }
    }

    function getItemIcon(itemType: string): string {
        switch (itemType) {
            case 'olio': return 'O'
            case 'pastiglie_ant': return 'FA'
            case 'pastiglie_post': return 'FP'
            default: return '?'
        }
    }

    function openSupplier(url: string | null) {
        if (url) {
            window.open(url, '_blank')
        }
    }

    if (loading) return <div className="text-theme-text-muted">Caricamento magazzino...</div>

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-theme-text-primary">Magazzino</h2>
                    <p className="text-sm text-theme-text-muted mt-1">
                        Gestione scorte ricambi e materiali
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {inventory.map(item => (
                    <div
                        key={item.id}
                        className={`rounded-lg border p-6 ${
                            item.quantity === 0
                                ? 'border-red-500/50 bg-red-900/20'
                                : item.quantity <= 2
                                    ? 'border-yellow-500/50 bg-yellow-900/20'
                                    : 'border-gray-700/30 bg-theme-bg-card'
                        }`}
                    >
                        <div className="flex items-start justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <div className={`w-12 h-12 rounded-lg flex items-center justify-center text-lg font-bold ${
                                    item.quantity === 0
                                        ? 'bg-red-900 text-red-200'
                                        : item.quantity <= 2
                                            ? 'bg-yellow-900 text-yellow-200'
                                            : 'bg-blue-900 text-blue-200'
                                }`}>
                                    {getItemIcon(item.item_type)}
                                </div>
                                <div>
                                    <h3 className="text-lg font-semibold text-theme-text-primary">
                                        {getItemLabel(item.item_type)}
                                    </h3>
                                    <p className="text-sm text-theme-text-muted">
                                        Unità: {item.unit}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="mb-4">
                            {editing === item.id ? (
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        min="0"
                                        value={editValue}
                                        onChange={(e) => setEditValue(parseInt(e.target.value) || 0)}
                                        className="w-24 px-3 py-2 bg-theme-bg-secondary border border-theme-border rounded-lg text-theme-text-primary text-center text-2xl font-bold"
                                        autoFocus
                                    />
                                    <button
                                        onClick={() => updateQuantity(item.id, editValue)}
                                        className="px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                                    >
                                        Salva
                                    </button>
                                    <button
                                        onClick={() => setEditing(null)}
                                        className="px-3 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                                    >
                                        Annulla
                                    </button>
                                </div>
                            ) : (
                                <div
                                    className="cursor-pointer"
                                    onClick={() => {
                                        setEditing(item.id)
                                        setEditValue(item.quantity)
                                    }}
                                >
                                    <span className={`text-4xl font-bold ${
                                        item.quantity === 0
                                            ? 'text-red-400'
                                            : item.quantity <= 2
                                                ? 'text-yellow-400'
                                                : 'text-theme-text-primary'
                                    }`}>
                                        {item.quantity}
                                    </span>
                                    <span className="text-xl text-theme-text-muted ml-2">{item.unit}</span>
                                    <p className="text-xs text-theme-text-muted mt-1">Clicca per modificare</p>
                                </div>
                            )}
                        </div>

                        {item.quantity === 0 && (
                            <div className="mb-4">
                                <span className="inline-block px-3 py-1 bg-red-900 text-red-200 rounded text-sm font-bold animate-pulse">
                                    ESAURITO - ORDINARE
                                </span>
                            </div>
                        )}

                        {item.quantity <= 2 && item.quantity > 0 && (
                            <div className="mb-4">
                                <span className="inline-block px-3 py-1 bg-yellow-900 text-yellow-200 rounded text-sm font-bold">
                                    SCORTA BASSA
                                </span>
                            </div>
                        )}

                        <button
                            onClick={() => openSupplier(item.supplier_url)}
                            className={`w-full py-3 rounded-lg font-medium transition-colors ${
                                item.quantity === 0
                                    ? 'bg-red-600 text-white hover:bg-red-700'
                                    : 'bg-transparent border border-white/20 text-white hover:bg-white/10'
                            }`}
                        >
                            {item.quantity === 0 ? 'Ordina Subito' : 'Ordina'}
                        </button>

                        <p className="text-xs text-theme-text-muted mt-3 text-center">
                            Ultimo aggiornamento: {new Date(item.updated_at).toLocaleDateString('it-IT')}
                        </p>
                    </div>
                ))}
            </div>

            {/* Quick Actions */}
            <div className="mt-8 p-4 bg-theme-bg-card rounded-lg border border-theme-border">
                <h3 className="text-lg font-semibold text-theme-text-primary mb-4">Azioni Rapide</h3>
                <div className="flex flex-wrap gap-3">
                    <button
                        onClick={() => {
                            const olioItem = inventory.find(i => i.item_type === 'olio')
                            if (olioItem) {
                                setEditing(olioItem.id)
                                setEditValue(olioItem.quantity)
                            }
                        }}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                        Aggiorna Olio
                    </button>
                    <button
                        onClick={() => {
                            const pastiglieAnt = inventory.find(i => i.item_type === 'pastiglie_ant')
                            if (pastiglieAnt) {
                                setEditing(pastiglieAnt.id)
                                setEditValue(pastiglieAnt.quantity)
                            }
                        }}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                        Aggiorna Pastiglie Ant
                    </button>
                    <button
                        onClick={() => {
                            const pastigliePost = inventory.find(i => i.item_type === 'pastiglie_post')
                            if (pastigliePost) {
                                setEditing(pastigliePost.id)
                                setEditValue(pastigliePost.quantity)
                            }
                        }}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                        Aggiorna Pastiglie Post
                    </button>
                </div>
            </div>
        </div>
    )
}
