import { useState, useMemo } from 'react'
import { supabase } from '../../../supabaseClient'

interface Preventivo {
  id: string
  vehicle_name: string
  vehicle_plate: string
  vehicle_category: string
  fascia: string
  pickup_date: string
  dropoff_date: string
  pickup_location: string
  dropoff_location: string
  insurance_option: string
  rental_days: number
  daily_rate: number
  total_amount: number
  deposit_amount: number
  km_limit: number
  unlimited_km: boolean
  second_driver: boolean
  no_cauzione: boolean
  delivery_enabled: boolean
  delivery_fee: number
  pickup_enabled: boolean
  pickup_fee: number
  notes: string
  customer_id: string | null
  customer_name: string | null
  status: string
  booking_id: string | null
  valid_until: string | null
  created_at: string
  updated_at: string
}

type Section = 'overview' | 'domanda' | 'conversione' | 'perdite' | 'azioni'

function formatCurrency(amount: number): string {
  return `€${amount.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}



function formatDateShort(d: string): string {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
}

export default function ReportPreventiviTab() {
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const [selectedMonth, setSelectedMonth] = useState(currentMonth)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [preventivi, setPreventivi] = useState<Preventivo[]>([])
  const [loaded, setLoaded] = useState(false)
  const [activeSection, setActiveSection] = useState<Section>('overview')
  // Filters
  const [filterVehicle, setFilterVehicle] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterFascia, setFilterFascia] = useState('')

  async function fetchReport() {
    setLoading(true)
    setError('')
    try {
      const [year, month] = selectedMonth.split('-').map(Number)
      const startDate = new Date(year, month - 1, 1).toISOString()
      const endDate = new Date(year, month, 0, 23, 59, 59).toISOString()

      const { data, error: dbError } = await supabase
        .from('preventivi')
        .select('*')
        .gte('created_at', startDate)
        .lte('created_at', endDate)
        .order('created_at', { ascending: false })

      if (dbError) throw new Error(dbError.message)
      setPreventivi(data || [])
      setLoaded(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Errore sconosciuto')
    } finally {
      setLoading(false)
    }
  }

  // Filtered data
  const filtered = useMemo(() => {
    return preventivi.filter(p => {
      if (filterVehicle && !p.vehicle_name?.toLowerCase().includes(filterVehicle.toLowerCase())) return false
      if (filterCategory && p.vehicle_category !== filterCategory) return false
      if (filterFascia && p.fascia !== filterFascia) return false
      return true
    })
  }, [preventivi, filterVehicle, filterCategory, filterFascia])

  // Status helpers
  const isActive = (p: Preventivo) => p.status === 'bozza' || p.status === 'preventivo'
  const isConverted = (p: Preventivo) => p.status === 'accettato' || p.status === 'convertito'
  const isExpired = (p: Preventivo) => p.status === 'scaduto'
  void isExpired // used in template below

  // ===== OVERVIEW METRICS =====
  const overview = useMemo(() => {
    const total = filtered.length
    const active = filtered.filter(isActive).length
    const converted = filtered.filter(isConverted).length
    const expired = filtered.filter(isExpired).length
    const totalValue = filtered.reduce((s, p) => s + (p.total_amount || 0), 0)
    const convertedValue = filtered.filter(isConverted).reduce((s, p) => s + (p.total_amount || 0), 0)
    const lostValue = filtered.filter(p => !isConverted(p)).reduce((s, p) => s + (p.total_amount || 0), 0)
    const conversionRate = total > 0 ? (converted / total) * 100 : 0
    const withCustomer = filtered.filter(p => p.customer_id).length
    const withDelivery = filtered.filter(p => p.delivery_enabled).length

    return { total, active, converted, expired, totalValue, convertedValue, lostValue, conversionRate, withCustomer, withDelivery }
  }, [filtered])

  // ===== DOMANDA (DEMAND) METRICS =====
  const domanda = useMemo(() => {
    // Top vehicles by request count
    const vehicleMap = new Map<string, { count: number; value: number; converted: number }>()
    filtered.forEach(p => {
      const key = p.vehicle_name || 'N/A'
      const entry = vehicleMap.get(key) || { count: 0, value: 0, converted: 0 }
      entry.count++
      entry.value += p.total_amount || 0
      if (isConverted(p)) entry.converted++
      vehicleMap.set(key, entry)
    })
    const topVehicles = Array.from(vehicleMap.entries())
      .map(([name, data]) => ({ name, ...data, conversionRate: data.count > 0 ? (data.converted / data.count) * 100 : 0 }))
      .sort((a, b) => b.count - a.count)

    // By category
    const categoryMap = new Map<string, { count: number; value: number; converted: number }>()
    filtered.forEach(p => {
      const key = p.vehicle_category || 'N/A'
      const entry = categoryMap.get(key) || { count: 0, value: 0, converted: 0 }
      entry.count++
      entry.value += p.total_amount || 0
      if (isConverted(p)) entry.converted++
      categoryMap.set(key, entry)
    })
    const byCategory = Array.from(categoryMap.entries())
      .map(([name, data]) => ({ name, ...data, conversionRate: data.count > 0 ? (data.converted / data.count) * 100 : 0 }))
      .sort((a, b) => b.count - a.count)

    // By rental duration
    const durationBuckets = { '1g': 0, '2-3g': 0, '4-7g': 0, '7g+': 0 }
    filtered.forEach(p => {
      const d = p.rental_days || 1
      if (d === 1) durationBuckets['1g']++
      else if (d <= 3) durationBuckets['2-3g']++
      else if (d <= 7) durationBuckets['4-7g']++
      else durationBuckets['7g+']++
    })
    const byDuration = Object.entries(durationBuckets).map(([range, count]) => ({ range, count }))

    // Top combos (vehicle + duration + delivery)
    const comboMap = new Map<string, number>()
    filtered.forEach(p => {
      const dur = (p.rental_days || 1) <= 2 ? 'weekend' : (p.rental_days || 1) <= 7 ? 'settimana' : 'lungo'
      const del = p.delivery_enabled ? 'domicilio' : 'sede'
      const key = `${p.vehicle_name || 'N/A'} + ${dur} + ${del}`
      comboMap.set(key, (comboMap.get(key) || 0) + 1)
    })
    const topCombos = Array.from(comboMap.entries())
      .map(([combo, count]) => ({ combo, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    return { topVehicles, byCategory, byDuration, topCombos }
  }, [filtered])

  // ===== CONVERSIONE METRICS =====
  const conversione = useMemo(() => {
    // By price range
    const priceRanges = [
      { label: '0-100€', min: 0, max: 100 },
      { label: '100-300€', min: 100, max: 300 },
      { label: '300-500€', min: 300, max: 500 },
      { label: '500-1000€', min: 500, max: 1000 },
      { label: '1000€+', min: 1000, max: Infinity },
    ]
    const byPrice = priceRanges.map(r => {
      const inRange = filtered.filter(p => (p.total_amount || 0) >= r.min && (p.total_amount || 0) < r.max)
      const conv = inRange.filter(isConverted).length
      return { label: r.label, total: inRange.length, converted: conv, rate: inRange.length > 0 ? (conv / inRange.length) * 100 : 0 }
    }).filter(r => r.total > 0)

    // By fascia
    const byFascia = ['A', 'B'].map(f => {
      const inFascia = filtered.filter(p => p.fascia === f)
      const conv = inFascia.filter(isConverted).length
      return { fascia: f, total: inFascia.length, converted: conv, rate: inFascia.length > 0 ? (conv / inFascia.length) * 100 : 0 }
    }).filter(r => r.total > 0)

    // By insurance
    const insuranceMap = new Map<string, { total: number; converted: number }>()
    filtered.forEach(p => {
      const key = p.insurance_option || 'N/A'
      const entry = insuranceMap.get(key) || { total: 0, converted: 0 }
      entry.total++
      if (isConverted(p)) entry.converted++
      insuranceMap.set(key, entry)
    })
    const byInsurance = Array.from(insuranceMap.entries())
      .map(([option, data]) => ({ option, ...data, rate: data.total > 0 ? (data.converted / data.total) * 100 : 0 }))
      .sort((a, b) => b.total - a.total)

    return { byPrice, byFascia, byInsurance }
  }, [filtered])

  // ===== PERDITE (LOSSES) =====
  const perdite = useMemo(() => {
    const nonConverted = filtered.filter(p => !isConverted(p))

    // Group lost by vehicle
    const lostByVehicle = new Map<string, { count: number; value: number }>()
    nonConverted.forEach(p => {
      const key = p.vehicle_name || 'N/A'
      const entry = lostByVehicle.get(key) || { count: 0, value: 0 }
      entry.count++
      entry.value += p.total_amount || 0
      lostByVehicle.set(key, entry)
    })
    const topLost = Array.from(lostByVehicle.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)

    // Status breakdown of non-converted
    const stillActive = nonConverted.filter(isActive).length
    const expired = nonConverted.filter(isExpired).length
    const noCustomer = nonConverted.filter(p => !p.customer_id).length
    const withCustomerNotConverted = nonConverted.filter(p => p.customer_id).length

    // Top non-converted preventivi by value
    const topByValue = nonConverted
      .sort((a, b) => (b.total_amount || 0) - (a.total_amount || 0))
      .slice(0, 15)

    return { nonConverted, topLost, stillActive, expired, noCustomer, withCustomerNotConverted, topByValue }
  }, [filtered])

  // ===== AZIONI SUGGERITE =====
  const azioni = useMemo(() => {
    const suggestions: { icon: string; title: string; detail: string; priority: 'alta' | 'media' | 'bassa' }[] = []

    // High demand low conversion vehicles
    domanda.topVehicles.forEach(v => {
      if (v.count >= 3 && v.conversionRate < 20) {
        suggestions.push({
          icon: '⚠️',
          title: `${v.name}: alta richiesta, bassa conversione (${v.conversionRate.toFixed(0)}%)`,
          detail: `${v.count} preventivi, solo ${v.converted} convertiti. Verifica pricing o condizioni.`,
          priority: 'alta'
        })
      }
    })

    // High delivery drop-off
    const deliveryPrev = filtered.filter(p => p.delivery_enabled)
    const deliveryConv = deliveryPrev.filter(isConverted).length
    if (deliveryPrev.length >= 3) {
      const deliveryRate = (deliveryConv / deliveryPrev.length) * 100
      const noDeliveryPrev = filtered.filter(p => !p.delivery_enabled)
      const noDeliveryRate = noDeliveryPrev.length > 0 ? (noDeliveryPrev.filter(isConverted).length / noDeliveryPrev.length) * 100 : 0
      if (deliveryRate < noDeliveryRate - 10) {
        suggestions.push({
          icon: '🚗',
          title: `Preventivi con domicilio convertono meno (${deliveryRate.toFixed(0)}% vs ${noDeliveryRate.toFixed(0)}%)`,
          detail: `${deliveryPrev.length} preventivi con consegna domicilio. Rivedere costo consegna.`,
          priority: 'media'
        })
      }
    }

    // Lost value alert
    if (overview.lostValue > 5000) {
      suggestions.push({
        icon: '💰',
        title: `${formatCurrency(overview.lostValue)} di valore potenziale perso`,
        detail: `${perdite.nonConverted.length} preventivi non convertiti. ${perdite.noCustomer} senza cliente assegnato.`,
        priority: 'alta'
      })
    }

    // No customer assigned
    if (perdite.noCustomer > 3) {
      suggestions.push({
        icon: '👤',
        title: `${perdite.noCustomer} preventivi senza cliente assegnato`,
        detail: `Assegna un cliente per poter inviare il preventivo e aumentare le conversioni.`,
        priority: 'media'
      })
    }

    // High price = low conversion
    const highPriceBucket = conversione.byPrice.find(b => b.label === '1000€+' || b.label === '500-1000€')
    if (highPriceBucket && highPriceBucket.total >= 3 && highPriceBucket.rate < 15) {
      suggestions.push({
        icon: '📊',
        title: `Fascia prezzo ${highPriceBucket.label}: conversione bassa (${highPriceBucket.rate.toFixed(0)}%)`,
        detail: `${highPriceBucket.total} preventivi, solo ${highPriceBucket.converted} convertiti. Valuta sconti o promozioni.`,
        priority: 'media'
      })
    }

    // Expired preventivi
    if (perdite.expired > 2) {
      suggestions.push({
        icon: '⏳',
        title: `${perdite.expired} preventivi scaduti`,
        detail: `Valuta di estendere la validità o contattare i clienti prima della scadenza.`,
        priority: 'bassa'
      })
    }

    // Sort by priority
    const priorityOrder = { alta: 0, media: 1, bassa: 2 }
    suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

    return suggestions
  }, [domanda, overview, perdite, conversione, filtered])

  const sections: { key: Section; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'domanda', label: 'Domanda' },
    { key: 'conversione', label: 'Conversione' },
    { key: 'perdite', label: 'Perdite' },
    { key: 'azioni', label: 'Azioni Suggerite' },
  ]

  const categories = [...new Set(preventivi.map(p => p.vehicle_category).filter(Boolean))]

  return (
    <div className="space-y-6">
      {/* Header */}
      <h2 className="text-2xl font-bold text-theme-text-primary">Report Preventivi</h2>

      {/* Controls */}
      <div className="bg-theme-bg-secondary/50 backdrop-blur-sm rounded-xl border border-theme-border p-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
          <div>
            <label className="block text-xs text-theme-text-muted mb-1">Mese</label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-3 py-2 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary text-sm"
            />
          </div>
          <button
            onClick={fetchReport}
            disabled={loading}
            className="px-6 py-2 bg-dr7-gold text-white font-semibold rounded-full hover:bg-[#247a6f] transition-colors disabled:opacity-50"
          >
            {loading ? 'Caricamento...' : 'Genera Report'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      {loaded && preventivi.length > 0 && (
        <>
          {/* Section Tabs */}
          <div className="flex gap-1 overflow-x-auto border-b border-theme-border pb-1">
            {sections.map(s => (
              <button
                key={s.key}
                onClick={() => setActiveSection(s.key)}
                className={`px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors rounded-t-lg ${
                  activeSection === s.key
                    ? 'text-dr7-gold border-b-2 border-dr7-gold bg-dr7-gold/10'
                    : 'text-theme-text-muted hover:text-theme-text-primary'
                }`}
              >
                {s.label}
                {s.key === 'azioni' && azioni.length > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 text-[10px] rounded-full bg-red-500/20 text-red-400 font-bold">{azioni.length}</span>
                )}
              </button>
            ))}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <input
              type="text"
              placeholder="Filtra veicolo..."
              value={filterVehicle}
              onChange={(e) => setFilterVehicle(e.target.value)}
              className="px-3 py-1.5 text-sm bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary placeholder-theme-text-muted"
            />
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-3 py-1.5 text-sm bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
            >
              <option value="">Tutte le categorie</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              value={filterFascia}
              onChange={(e) => setFilterFascia(e.target.value)}
              className="px-3 py-1.5 text-sm bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary"
            >
              <option value="">Tutte le fasce</option>
              <option value="A">Fascia A</option>
              <option value="B">Fascia B</option>
            </select>
            {(filterVehicle || filterCategory || filterFascia) && (
              <button
                onClick={() => { setFilterVehicle(''); setFilterCategory(''); setFilterFascia('') }}
                className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300"
              >
                Rimuovi filtri
              </button>
            )}
          </div>

          {/* ===== OVERVIEW ===== */}
          {activeSection === 'overview' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <StatCard label="Preventivi Totali" value={overview.total} />
                <StatCard label="Attivi" value={overview.active} color="text-blue-400" />
                <StatCard label="Convertiti" value={overview.converted} color="text-green-400" />
                <StatCard label="Scaduti" value={overview.expired} color="text-red-400" />
                <StatCard label="Conversion Rate" value={`${overview.conversionRate.toFixed(1)}%`} color="text-dr7-gold" />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <StatCard label="Valore Totale" value={formatCurrency(overview.totalValue)} color="text-theme-text-primary" />
                <StatCard label="Valore Convertito" value={formatCurrency(overview.convertedValue)} color="text-green-400" />
                <StatCard label="Valore Potenziale Perso" value={formatCurrency(overview.lostValue)} color="text-red-400" highlight />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Con Cliente Assegnato" value={overview.withCustomer} />
                <StatCard label="Con Consegna Domicilio" value={overview.withDelivery} />
              </div>
            </div>
          )}

          {/* ===== DOMANDA ===== */}
          {activeSection === 'domanda' && (
            <div className="space-y-6">
              {/* Top Vehicles */}
              <ReportTable
                title="Top Veicoli per Preventivi"
                headers={['Veicolo', 'Richieste', 'Valore', 'Conv.', 'Rate']}
                rows={domanda.topVehicles.map(v => [
                  v.name,
                  String(v.count),
                  formatCurrency(v.value),
                  String(v.converted),
                  `${v.conversionRate.toFixed(0)}%`
                ])}
              />

              {/* By Category */}
              <ReportTable
                title="Per Categoria"
                headers={['Categoria', 'Richieste', 'Valore', 'Conv.', 'Rate']}
                rows={domanda.byCategory.map(c => [
                  c.name,
                  String(c.count),
                  formatCurrency(c.value),
                  String(c.converted),
                  `${c.conversionRate.toFixed(0)}%`
                ])}
              />

              {/* By Duration */}
              <ReportTable
                title="Per Durata Noleggio"
                headers={['Durata', 'Richieste']}
                rows={domanda.byDuration.filter(d => d.count > 0).map(d => [d.range, String(d.count)])}
              />

              {/* Top Combos */}
              {domanda.topCombos.length > 0 && (
                <ReportTable
                  title="Top Combinazioni Richieste"
                  headers={['Combinazione', 'Richieste']}
                  rows={domanda.topCombos.map(c => [c.combo, String(c.count)])}
                />
              )}
            </div>
          )}

          {/* ===== CONVERSIONE ===== */}
          {activeSection === 'conversione' && (
            <div className="space-y-6">
              {/* Conversion by Vehicle */}
              <ReportTable
                title="Conversione per Veicolo"
                headers={['Veicolo', 'Richieste', 'Convertiti', 'Rate']}
                rows={domanda.topVehicles.map(v => [
                  v.name,
                  String(v.count),
                  String(v.converted),
                  `${v.conversionRate.toFixed(0)}%`
                ])}
                highlightLowRate
              />

              {/* Conversion by Price */}
              <ReportTable
                title="Conversione per Fascia Prezzo"
                headers={['Fascia', 'Totale', 'Convertiti', 'Rate']}
                rows={conversione.byPrice.map(b => [
                  b.label,
                  String(b.total),
                  String(b.converted),
                  `${b.rate.toFixed(0)}%`
                ])}
                highlightLowRate
              />

              {/* Conversion by Fascia */}
              {conversione.byFascia.length > 0 && (
                <ReportTable
                  title="Conversione per Fascia Cliente"
                  headers={['Fascia', 'Totale', 'Convertiti', 'Rate']}
                  rows={conversione.byFascia.map(f => [
                    `Fascia ${f.fascia}`,
                    String(f.total),
                    String(f.converted),
                    `${f.rate.toFixed(0)}%`
                  ])}
                />
              )}

              {/* Conversion by Insurance */}
              <ReportTable
                title="Conversione per Assicurazione"
                headers={['Assicurazione', 'Totale', 'Convertiti', 'Rate']}
                rows={conversione.byInsurance.map(i => [
                  i.option,
                  String(i.total),
                  String(i.converted),
                  `${i.rate.toFixed(0)}%`
                ])}
              />
            </div>
          )}

          {/* ===== PERDITE ===== */}
          {activeSection === 'perdite' && (
            <div className="space-y-6">
              {/* Loss summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Non Convertiti" value={perdite.nonConverted.length} color="text-red-400" />
                <StatCard label="Ancora Attivi" value={perdite.stillActive} color="text-blue-400" />
                <StatCard label="Scaduti" value={perdite.expired} color="text-orange-400" />
                <StatCard label="Senza Cliente" value={perdite.noCustomer} color="text-purple-400" />
              </div>

              {/* Top lost by vehicle */}
              <ReportTable
                title="Perdite per Veicolo (Top 10)"
                headers={['Veicolo', 'Preventivi Persi', 'Valore Perso']}
                rows={perdite.topLost.map(v => [
                  v.name,
                  String(v.count),
                  formatCurrency(v.value)
                ])}
              />

              {/* Top non-converted by value */}
              <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border overflow-hidden">
                <div className="px-4 py-3 border-b border-theme-border">
                  <h3 className="text-sm font-semibold text-theme-text-primary">Preventivi Non Convertiti (Top per Valore)</h3>
                </div>
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-theme-bg-primary/50 text-theme-text-muted">
                        <th className="text-left px-4 py-3">Veicolo</th>
                        <th className="text-left px-4 py-3">Periodo</th>
                        <th className="text-left px-4 py-3">Cliente</th>
                        <th className="text-center px-4 py-3">Stato</th>
                        <th className="text-right px-4 py-3">Valore</th>
                      </tr>
                    </thead>
                    <tbody>
                      {perdite.topByValue.map(p => (
                        <tr key={p.id} className="border-t border-theme-border hover:bg-theme-bg-tertiary/30">
                          <td className="px-4 py-3 font-medium text-theme-text-primary">{p.vehicle_name}</td>
                          <td className="px-4 py-3 text-theme-text-muted">{formatDateShort(p.pickup_date)} → {formatDateShort(p.dropoff_date)} ({p.rental_days}g)</td>
                          <td className="px-4 py-3 text-theme-text-muted">{p.customer_name || <span className="text-purple-400 text-xs">Non assegnato</span>}</td>
                          <td className="text-center px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${isActive(p) ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'}`}>
                              {isActive(p) ? 'Attivo' : 'Scaduto'}
                            </span>
                          </td>
                          <td className="text-right px-4 py-3 font-semibold text-red-400">{formatCurrency(p.total_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Mobile */}
                <div className="md:hidden p-3 space-y-2">
                  {perdite.topByValue.map(p => (
                    <div key={p.id} className="bg-theme-bg-tertiary/30 rounded-lg p-3 border border-theme-border">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium text-theme-text-primary text-sm">{p.vehicle_name}</p>
                          <p className="text-xs text-theme-text-muted">{formatDateShort(p.pickup_date)} → {formatDateShort(p.dropoff_date)}</p>
                          <p className="text-xs text-theme-text-muted">{p.customer_name || 'Non assegnato'}</p>
                        </div>
                        <p className="font-bold text-red-400">{formatCurrency(p.total_amount)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ===== AZIONI SUGGERITE ===== */}
          {activeSection === 'azioni' && (
            <div className="space-y-3">
              {azioni.length === 0 ? (
                <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-8 text-center">
                  <p className="text-theme-text-muted">Nessuna azione suggerita per questo periodo. Ottimo lavoro!</p>
                </div>
              ) : (
                azioni.map((a, i) => (
                  <div key={i} className={`rounded-xl border p-4 ${
                    a.priority === 'alta' ? 'border-red-500/40 bg-red-500/5' :
                    a.priority === 'media' ? 'border-orange-500/40 bg-orange-500/5' :
                    'border-theme-border bg-theme-bg-secondary/50'
                  }`}>
                    <div className="flex items-start gap-3">
                      <span className="text-xl">{a.icon}</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-semibold text-theme-text-primary text-sm">{a.title}</h4>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            a.priority === 'alta' ? 'bg-red-500/20 text-red-400' :
                            a.priority === 'media' ? 'bg-orange-500/20 text-orange-400' :
                            'bg-gray-500/20 text-gray-400'
                          }`}>{a.priority}</span>
                        </div>
                        <p className="text-sm text-theme-text-muted">{a.detail}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {loaded && preventivi.length === 0 && (
        <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-12 text-center">
          <p className="text-theme-text-muted text-lg mb-2">Nessun preventivo trovato per questo mese</p>
          <p className="text-theme-text-muted text-sm">Prova a selezionare un mese diverso</p>
        </div>
      )}

      {!loaded && !loading && !error && (
        <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-12 text-center">
          <svg className="w-16 h-16 mx-auto text-theme-text-muted mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-theme-text-muted text-lg mb-2">Seleziona un mese e genera il report</p>
          <p className="text-theme-text-muted text-sm">Analisi completa: overview, domanda, conversione, perdite e azioni suggerite</p>
        </div>
      )}
    </div>
  )
}

// ===== REUSABLE COMPONENTS =====

function StatCard({ label, value, color, highlight }: { label: string; value: string | number; color?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? 'border-red-500/40 bg-red-500/5' : 'border-theme-border bg-theme-bg-secondary/50'}`}>
      <p className="text-xs text-theme-text-muted">{label}</p>
      <p className={`text-2xl font-bold ${color || 'text-theme-text-primary'}`}>{value}</p>
    </div>
  )
}

function ReportTable({ title, headers, rows, highlightLowRate }: {
  title: string
  headers: string[]
  rows: string[][]
  highlightLowRate?: boolean
}) {
  if (rows.length === 0) return null

  return (
    <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border overflow-hidden">
      <div className="px-4 py-3 border-b border-theme-border">
        <h3 className="text-sm font-semibold text-theme-text-primary">{title}</h3>
      </div>
      {/* Desktop */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-theme-bg-primary/50 text-theme-text-muted">
              {headers.map((h, i) => (
                <th key={i} className={`px-4 py-3 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              const lastCol = row[row.length - 1]
              const isLow = highlightLowRate && lastCol.endsWith('%') && parseFloat(lastCol) < 20
              return (
                <tr key={ri} className={`border-t border-theme-border hover:bg-theme-bg-tertiary/30 ${isLow ? 'bg-red-500/5' : ''}`}>
                  {row.map((cell, ci) => (
                    <td key={ci} className={`px-4 py-3 ${ci === 0 ? 'text-left font-medium text-theme-text-primary' : 'text-right'} ${
                      ci === row.length - 1 && cell.endsWith('%')
                        ? isLow ? 'text-red-400 font-semibold' : 'text-green-400 font-semibold'
                        : cell.startsWith('€') ? 'text-dr7-gold font-semibold' : 'text-theme-text-primary'
                    }`}>{cell}</td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {/* Mobile */}
      <div className="md:hidden p-3 space-y-2">
        {rows.map((row, ri) => (
          <div key={ri} className="bg-theme-bg-tertiary/30 rounded-lg p-3 border border-theme-border">
            <p className="font-medium text-theme-text-primary text-sm mb-1">{row[0]}</p>
            <div className="flex flex-wrap gap-3 text-xs">
              {headers.slice(1).map((h, hi) => (
                <div key={hi}>
                  <span className="text-theme-text-muted">{h}: </span>
                  <span className={`font-semibold ${
                    row[hi + 1]?.startsWith('€') ? 'text-dr7-gold' :
                    row[hi + 1]?.endsWith('%') ? (parseFloat(row[hi + 1]) < 20 ? 'text-red-400' : 'text-green-400') :
                    'text-theme-text-primary'
                  }`}>{row[hi + 1]}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
