export const ITALIAN_HOLIDAYS_2025 = [
    { date: '2025-01-01', name: 'Capodanno', emoji: '🎉' },
    { date: '2025-01-06', name: 'Epifania', emoji: '👑' },
    { date: '2025-04-20', name: 'Pasqua', emoji: '🕊️' },
    { date: '2025-04-21', name: 'Lunedì dell\'Angelo', emoji: '🧺' },
    { date: '2025-04-25', name: 'Festa della Liberazione', emoji: '🇮🇹' },
    { date: '2025-05-01', name: 'Festa dei Lavoratori', emoji: '🛠️' },
    { date: '2025-06-02', name: 'Festa della Repubblica', emoji: '🇮🇹' },
    { date: '2025-08-15', name: 'Ferragosto', emoji: '🏖️' },
    { date: '2025-11-01', name: 'Ognissanti', emoji: '🕯️' },
    { date: '2025-12-08', name: 'Immacolata Concezione', emoji: '✨' },
    { date: '2025-12-25', name: 'Natale', emoji: '🎄' },
    { date: '2025-12-26', name: 'Santo Stefano', emoji: '🎁' },
];

export const ITALIAN_HOLIDAYS_2026 = [
    { date: '2026-01-01', name: 'Capodanno', emoji: '🎉' },
    { date: '2026-01-06', name: 'Epifania', emoji: '👑' },
    { date: '2026-04-05', name: 'Pasqua', emoji: '🕊️' },
    { date: '2026-04-06', name: 'Lunedì dell\'Angelo', emoji: '🧺' },
    { date: '2026-04-25', name: 'Festa della Liberazione', emoji: '🇮🇹' },
    { date: '2026-05-01', name: 'Festa dei Lavoratori', emoji: '🛠️' },
    { date: '2026-06-02', name: 'Festa della Repubblica', emoji: '🇮🇹' },
    { date: '2026-08-15', name: 'Ferragosto', emoji: '🏖️' },
    { date: '2026-11-01', name: 'Ognissanti', emoji: '🕯️' },
    { date: '2026-12-08', name: 'Immacolata Concezione', emoji: '✨' },
    { date: '2026-12-25', name: 'Natale', emoji: '🎄' },
    { date: '2026-12-26', name: 'Santo Stefano', emoji: '🎁' },
];

export const ALL_ITALIAN_HOLIDAYS = [...ITALIAN_HOLIDAYS_2025, ...ITALIAN_HOLIDAYS_2026];

export const getHolidayForDate = (date: Date): { name: string; emoji: string } | null => {
    const dateStr = date.toISOString().split('T')[0];
    return ALL_ITALIAN_HOLIDAYS.find(h => h.date === dateStr) || null;
};

export const isSunday = (date: Date): boolean => {
    return date.getDay() === 0;
};
