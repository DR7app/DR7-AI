/**
 * Shared color palettes for vehicle categories. The Veicoli tab and
 * Calendario Noleggio assign the same palette to a category by looking up
 * the category's index in the Centralina Pro `categories` list, so the
 * pill colors stay consistent across the admin.
 */

export interface CategoryPalette {
    /** Subtle wrap/background tint for cards or section headers. */
    wrapBg: string
    /** Saturated pill background used for category tags. */
    pillBg: string
    /** Pill text color paired with `pillBg`. */
    pillText: string
}

export const CATEGORY_PALETTES: CategoryPalette[] = [
    { wrapBg: 'bg-cyan-900/30', pillBg: 'bg-cyan-900', pillText: 'text-cyan-200' },
    { wrapBg: 'bg-purple-900/30', pillBg: 'bg-purple-900', pillText: 'text-purple-200' },
    { wrapBg: 'bg-orange-900/30', pillBg: 'bg-orange-900', pillText: 'text-orange-200' },
    { wrapBg: 'bg-emerald-900/30', pillBg: 'bg-emerald-900', pillText: 'text-emerald-200' },
    { wrapBg: 'bg-sky-900/30', pillBg: 'bg-sky-900', pillText: 'text-sky-200' },
    { wrapBg: 'bg-rose-900/30', pillBg: 'bg-rose-900', pillText: 'text-rose-200' },
    { wrapBg: 'bg-fuchsia-900/30', pillBg: 'bg-fuchsia-900', pillText: 'text-fuchsia-200' },
    { wrapBg: 'bg-amber-900/30', pillBg: 'bg-amber-900', pillText: 'text-amber-200' },
    { wrapBg: 'bg-lime-900/30', pillBg: 'bg-lime-900', pillText: 'text-lime-200' },
    { wrapBg: 'bg-teal-900/30', pillBg: 'bg-teal-900', pillText: 'text-teal-200' },
    { wrapBg: 'bg-indigo-900/30', pillBg: 'bg-indigo-900', pillText: 'text-indigo-200' },
]

export const ORPHAN_PALETTE: CategoryPalette = {
    wrapBg: 'bg-theme-bg-tertiary',
    pillBg: 'bg-theme-bg-tertiary',
    pillText: 'text-theme-text-secondary',
}

/**
 * Resolve the palette for a given vehicle category id, against the ordered
 * list of Centralina Pro categories. Falls back to ORPHAN_PALETTE for
 * vehicles whose category id isn't in the Pro list (e.g. legacy "exotic"
 * after a rename).
 */
export function getPaletteForCategory(
    categoryId: string | null | undefined,
    proCategories: { id: string }[],
): CategoryPalette {
    if (!categoryId) return ORPHAN_PALETTE
    const idx = proCategories.findIndex(c => c.id === categoryId)
    if (idx < 0) return ORPHAN_PALETTE
    return CATEGORY_PALETTES[idx % CATEGORY_PALETTES.length]
}
