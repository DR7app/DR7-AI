import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'

interface Admin {
    id: string
    user_id: string
    email: string
    role: 'superadmin' | 'admin'
    can_view_financials: boolean
    created_at: string
}

export default function AdminManagementTab() {
    const [admins, setAdmins] = useState<Admin[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        loadAdmins()
    }, [])

    async function loadAdmins() {
        try {
            setLoading(true)
            setError(null)

            const { data, error: fetchError } = await supabase
                .from('admins')
                .select('*')
                .order('created_at', { ascending: false })

            if (fetchError) throw fetchError

            setAdmins(data || [])
        } catch (err) {
            console.error('Error loading admins:', err)
            setError('Errore nel caricamento degli amministratori')
        } finally {
            setLoading(false)
        }
    }

    async function toggleFinancialAccess(adminId: string, currentValue: boolean) {
        try {
            const { error: updateError } = await supabase
                .from('admins')
                .update({ can_view_financials: !currentValue })
                .eq('id', adminId)

            if (updateError) throw updateError

            // Reload admins
            await loadAdmins()
        } catch (err) {
            console.error('Error updating admin:', err)
            alert('Errore nell\'aggiornamento dell\'amministratore')
        }
    }

    async function updateRole(adminId: string, newRole: 'superadmin' | 'admin') {
        try {
            const { error: updateError } = await supabase
                .from('admins')
                .update({ role: newRole })
                .eq('id', adminId)

            if (updateError) throw updateError

            // Reload admins
            await loadAdmins()
        } catch (err) {
            console.error('Error updating admin role:', err)
            alert('Errore nell\'aggiornamento del ruolo')
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-theme-text-primary text-lg">Caricamento...</div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="bg-red-900/20 border border-red-500 text-red-200 p-4 rounded-full">
                {error}
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-theme-text-primary">Gestione Amministratori</h2>
            </div>

            <div className="bg-theme-bg-tertiary rounded-lg overflow-hidden">
                <table className="w-full">
                    <thead className="bg-gray-700">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-secondary uppercase tracking-wider">
                                Email
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-secondary uppercase tracking-wider">
                                Ruolo
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-secondary uppercase tracking-wider">
                                Accesso Finanziario
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-secondary uppercase tracking-wider">
                                Azioni
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700">
                        {admins.map((admin) => (
                            <tr key={admin.id} className="hover:bg-gray-750">
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-theme-text-primary">
                                    {admin.email}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm">
                                    <select
                                        value={admin.role}
                                        onChange={(e) => updateRole(admin.id, e.target.value as 'superadmin' | 'admin')}
                                        className="bg-gray-700 text-theme-text-primary border border-theme-border-light rounded px-2 py-1"
                                    >
                                        <option value="admin">Admin</option>
                                        <option value="superadmin">Superadmin</option>
                                    </select>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm">
                                    <button
                                        onClick={() => toggleFinancialAccess(admin.id, admin.can_view_financials)}
                                        className={`px-3 py-1 rounded-full text-xs font-medium ${admin.can_view_financials
                                                ? 'bg-green-500 text-theme-text-primary'
                                                : 'bg-gray-600 text-theme-text-secondary'
                                            }`}
                                    >
                                        {admin.can_view_financials ? 'Abilitato' : 'Disabilitato'}
                                    </button>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-theme-text-secondary">
                                    <span className="text-xs">
                                        {new Date(admin.created_at).toLocaleDateString('it-IT')}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>

                {admins.length === 0 && (
                    <div className="text-center py-8 text-theme-text-muted">
                        Nessun amministratore trovato
                    </div>
                )}
            </div>
        </div>
    )
}
