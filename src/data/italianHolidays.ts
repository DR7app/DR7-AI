export const ITALIAN_HOLIDAYS_2025 = [
    { date: '2025-01-01', name: 'Capodanno', label: 'Capodanno' },
    { date: '2025-01-06', name: 'Epifania', label: 'Epifania' },
    { date: '2025-04-20', name: 'Pasqua', label: 'Pasqua' },
    { date: '2025-04-21', name: 'Lunedì dell\'Angelo', label: 'Lunedì' },
    { date: '2025-04-25', name: 'Festa della Liberazione', label: 'Liberazione' },
    { date: '2025-05-01', name: 'Festa dei Lavoratori', label: 'Lavoratori' },
    { date: '2025-06-02', name: 'Festa della Repubblica', label: 'Repubblica' },
    { date: '2025-08-15', name: 'Ferragosto', label: 'Ferragosto' },
    { date: '2025-11-01', name: 'Ognissanti', label: 'Ognissanti' },
    { date: '2025-12-08', name: 'Immacolata Concezione', label: 'Immacolata' },
    { date: '2025-12-25', name: 'Natale', label: 'Natale' },
    { date: '2025-12-26', name: 'Santo Stefano', label: 'S.Stefano' },
];

export const ITALIAN_HOLIDAYS_2026 = [
    { date: '2026-01-01', name: 'Capodanno', label: 'Capodanno' },
    { date: '2026-01-06', name: 'Epifania', label: 'Epifania' },
    { date: '2026-04-05', name: 'Pasqua', label: 'Pasqua' },
    { date: '2026-04-06', name: 'Lunedì dell\'Angelo', label: 'Lunedì' },
    { date: '2026-04-25', name: 'Festa della Liberazione', label: 'Liberazione' },
    { date: '2026-05-01', name: 'Festa dei Lavoratori', label: 'Lavoratori' },
    { date: '2026-06-02', name: 'Festa della Repubblica', label: 'Repubblica' },
    { date: '2026-08-15', name: 'Ferragosto', label: 'Ferragosto' },
    { date: '2026-11-01', name: 'Ognissanti', label: 'Ognissanti' },
    { date: '2026-12-08', name: 'Immacolata Concezione', label: 'Immacolata' },
    { date: '2026-12-25', name: 'Natale', label: 'Natale' },
    { date: '2026-12-26', name: 'Santo Stefano', label: 'S.Stefano' },
];

export const ALL_ITALIAN_HOLIDAYS = [...ITALIAN_HOLIDAYS_2025, ...ITALIAN_HOLIDAYS_2026];

export const getHolidayForDate = (date: Date): { name: string; label: string } | null => {
    // Use local time components to avoid timezone offsets causing "off by one" errors
    // when comparing to fixed date strings (e.g. 2025-12-25)
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    return ALL_ITALIAN_HOLIDAYS.find(h => h.date === dateStr) || null;
};

export const isSunday = (date: Date): boolean => {
    return date.getDay() === 0;
};
