/**
 * Contatore compleanni in arrivo, mostrato sul badge della sidebar.
 *
 * 25/08/2026: stava dentro BirthdaysTab. AdminDashboard lo importava da li',
 * quindi TUTTA la tab (1128 righe) finiva nel chunk principale e veniva
 * scaricata da chiunque aprisse il gestionale, anche da chi non apre mai
 * Compleanni. Vive qui perche' il badge serve sempre, la tab no.
 */
import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'

export function useBirthdayCount() {
    const [count, setCount] = useState(0)

    useEffect(() => {
        async function loadCount() {
            try {
                const currentYear = new Date().getFullYear()
                const today = new Date()
                today.setHours(0, 0, 0, 0)

                const { data: customersData } = await supabase
                    .from('customers_extended')
                    .select('id, data_nascita')
                    .not('data_nascita', 'is', null)

                const { data: sentData } = await supabase
                    .from('birthday_messages')
                    .select('customer_id')
                    .eq('year', currentYear)

                const sentSet = new Set((sentData || []).map(s => s.customer_id))

                let upcomingCount = 0
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ;(customersData || []).forEach((c: any) => {
                    if (sentSet.has(c.id)) return

                    const birthDate = parseBirthdayForHook(c.data_nascita)
                    if (birthDate) {
                        const daysUntil = calculateDaysUntilBirthdayForHook(birthDate, today)
                        if (daysUntil >= 0 && daysUntil <= 10) {
                            upcomingCount++
                        }
                    }
                })

                setCount(upcomingCount)
            } catch (error) {
                console.error('Error loading birthday count:', error)
            }
        }

        loadCount()
        // Refresh every 5 minutes
        const interval = setInterval(loadCount, 5 * 60 * 1000)
        return () => clearInterval(interval)
    }, [])

    return count
}

function parseBirthdayForHook(dateStr: string): Date | null {
    if (!dateStr) return null
    const ddmmyyyy = dateStr.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
    if (ddmmyyyy) {
        return new Date(parseInt(ddmmyyyy[3]), parseInt(ddmmyyyy[2]) - 1, parseInt(ddmmyyyy[1]))
    }
    const iso = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (iso) {
        return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]))
    }
    return null
}

function calculateDaysUntilBirthdayForHook(birthDate: Date, today: Date): number {
    let thisYearBirthday = new Date(today.getFullYear(), birthDate.getMonth(), birthDate.getDate())
    thisYearBirthday.setHours(0, 0, 0, 0)
    if (thisYearBirthday < today) {
        thisYearBirthday = new Date(today.getFullYear() + 1, birthDate.getMonth(), birthDate.getDate())
    }
    const diffTime = thisYearBirthday.getTime() - today.getTime()
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
}
