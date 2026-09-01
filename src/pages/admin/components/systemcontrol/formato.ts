// System Control — formattazione delle date: sempre 24 ore e gg/mm/aaaa,
// sempre ora di Roma. Sta in un file suo perche' non e' un componente.
export function dataOra(iso?: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('it-IT', {
    timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

export function quandoRelativo(iso?: string | null): string {
  if (!iso) return 'mai'
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.round(diff / 60_000)
  if (min < 1) return 'adesso'
  if (min < 60) return `${min} min fa`
  const ore = Math.round(min / 60)
  if (ore < 24) return `${ore} ${ore === 1 ? 'ora' : 'ore'} fa`
  const giorni = Math.round(ore / 24)
  if (giorni < 30) return `${giorni} ${giorni === 1 ? 'giorno' : 'giorni'} fa`
  return dataOra(iso)
}
