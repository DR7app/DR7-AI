// Types
export interface Scadenza {
  id: string
  category: string
  item_type: string
  description: string
  reference_id: string | null
  reference_type: string | null
  reference_name: string | null
  due_date: string | null
  due_km: number | null
  current_km: number | null
  amount: number | null
  status: 'pending' | 'completed' | 'paid' | 'blocked' | 'refunded' | 'to_refund' | 'to_block'
  advance_days: number
  advance_km: number | null
  is_recurring: boolean
  recurring_interval: string | null
  is_manual: boolean
  created_at: string
}

export interface NewScadenzaForm {
  category: string
  item_type: string
  description: string
  due_date: string
  amount: string
  reference_name: string
}

export interface CategoryConfig {
  label: string
  color: string
  advanceDays?: number | Record<string, number>
  advanceKm?: Record<string, number>
  items: string[]
  actions: string[]
  statuses?: string[]
  allowCustomItems?: boolean
}

// Category configurations with advance periods
export const CATEGORIES: Record<string, CategoryConfig> = {
  noleggi: {
    label: 'Scadenze Noleggi',
    color: 'blue',
    advanceDays: 1,
    items: ['Fine noleggio'],
    actions: ['complete']
  },
  cauzioni: {
    label: 'Scadenze Cauzioni',
    color: 'purple',
    advanceDays: 1,
    items: ['Cauzione noleggio'],
    actions: ['block', 'collect', 'refund', 'mark_refunded'],
    statuses: ['to_block', 'blocked', 'collected', 'to_refund', 'refunded']
  },
  rate_pagamenti: {
    label: 'Scadenze Rate e Pagamenti Finanziari',
    color: 'orange',
    advanceDays: 5,
    items: ['Rata leasing veicolo', 'Rata noleggio flotta', 'Rata carta di credito'],
    actions: ['pay', 'mark_paid']
  },
  carte_credito: {
    label: 'Scadenze Carte di Credito Aziendali',
    color: 'red',
    advanceDays: 5,
    items: ['Carta aziendale principale', 'Carta business secondaria'],
    actions: ['pay', 'mark_paid']
  },
  veicoli_manutenzione: {
    label: 'Scadenze Veicoli - Manutenzione (KM)',
    color: 'yellow',
    advanceKm: { tagliando: 5000, gomme: 500, pastiglie: 500 },
    items: ['Tagliando', 'Gomme', 'Pastiglie'],
    actions: ['complete']
  },
  veicoli_documenti: {
    label: 'Scadenze Veicoli - Documenti e Tasse',
    color: 'green',
    advanceDays: { assicurazione: 2, bollo: 0, superbollo: 0, revisione: 7 },
    items: ['Assicurazione', 'Bollo', 'Superbollo', 'Revisione'],
    actions: ['pay', 'mark_paid', 'complete']
  },
  affitti: {
    label: 'Scadenze Affitti',
    color: 'teal',
    advanceDays: 5,
    items: ['Canone affitto locale 1', 'Canone affitto locale 2'],
    actions: ['pay', 'mark_paid', 'delete'],
    allowCustomItems: true
  },
  personale: {
    label: 'Scadenze Personale',
    color: 'pink',
    advanceDays: { stipendi: 3, consulente: 0, commercialista: 0 },
    items: ['Stipendi', 'Consulente', 'Commercialista'],
    actions: ['pay', 'mark_paid']
  },
  fiscali: {
    label: 'Scadenze Fiscali',
    color: 'indigo',
    advanceDays: 0,
    items: ['IVA'],
    actions: ['pay', 'mark_paid']
  }
}

export const CATEGORY_KEYS = Object.keys(CATEGORIES)

export const STATUS_LABELS: Record<string, string> = {
  pending: 'In attesa',
  completed: 'Completata',
  paid: 'Pagata',
  blocked: 'Bloccata',
  refunded: 'Rimborsata',
  to_refund: 'Da rimborsare',
  to_block: 'Da bloccare',
  collected: 'Incassata'
}

export const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-900 text-yellow-200',
  completed: 'bg-green-900 text-green-200',
  paid: 'bg-green-900 text-green-200',
  blocked: 'bg-blue-900 text-blue-200',
  refunded: 'bg-theme-bg-tertiary text-theme-text-secondary',
  to_refund: 'bg-orange-900 text-orange-200',
  to_block: 'bg-red-900 text-red-200',
  collected: 'bg-green-900 text-green-200'
}

export const COLOR_CLASSES: Record<string, string> = {
  blue: 'bg-blue-900/30 border-blue-700/50',
  purple: 'bg-purple-900/30 border-purple-700/50',
  orange: 'bg-orange-900/30 border-orange-700/50',
  red: 'bg-red-900/30 border-red-700/50',
  yellow: 'bg-yellow-900/30 border-yellow-700/50',
  green: 'bg-green-900/30 border-green-700/50',
  teal: 'bg-teal-900/30 border-teal-700/50',
  pink: 'bg-pink-900/30 border-pink-700/50',
  indigo: 'bg-indigo-900/30 border-indigo-700/50'
}

export const DOT_COLORS: Record<string, string> = {
  blue: 'bg-blue-400',
  purple: 'bg-purple-400',
  orange: 'bg-orange-400',
  red: 'bg-red-400',
  yellow: 'bg-yellow-400',
  green: 'bg-green-400',
  teal: 'bg-teal-400',
  pink: 'bg-pink-400',
  indigo: 'bg-indigo-400'
}

// Utility functions
export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
}

export function formatAmount(cents: number | null): string {
  if (cents === null) return '-'
  return `${(cents / 100).toFixed(2)}`.replace('.', ',')
}

export function getDaysRemaining(dateStr: string | null): { days: number; urgent: boolean; warning: boolean } | null {
  if (!dateStr) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dueDate = new Date(dateStr)
  dueDate.setHours(0, 0, 0, 0)
  const days = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  return {
    days,
    urgent: days <= 0,
    warning: days <= 3 && days > 0
  }
}

export function getKmRemaining(dueKm: number | null, currentKm: number | null): { km: number; urgent: boolean; warning: boolean } | null {
  if (dueKm === null || currentKm === null) return null
  const km = dueKm - currentKm
  return {
    km,
    urgent: km <= 0,
    warning: km <= 500 && km > 0
  }
}
