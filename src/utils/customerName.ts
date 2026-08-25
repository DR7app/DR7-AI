/**
 * Nome da mostrare per una riga di `customers_extended`.
 *
 * `tipo_cliente` NON e' garantito: le righe nate da registrazione sito, invito
 * cliente, import massivo e vecchi flussi lo hanno nullo o vuoto. Chi si
 * fermava al tipo scriveva "N/A" come nome, e quel cliente diventava
 * INTROVABILE nella ricerca del form prenotazione (la ricerca guarda il nome),
 * pur essendo regolarmente in anagrafica e visibile nella tab Clienti.
 *
 * Ordine: prima il campo del tipo dichiarato, poi qualunque nome presente.
 * Mai "N/A": in ultima istanza email o telefono, cosi' la riga resta
 * cercabile e selezionabile.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function customerDisplayName(c: any): string {
  const s = (v: unknown) => (v == null ? '' : String(v)).trim()

  const persona = [s(c?.nome) || s(c?.first_name), s(c?.cognome) || s(c?.last_name)]
    .filter(Boolean).join(' ')
  const azienda = s(c?.denominazione) || s(c?.ragione_sociale)
  const ente = s(c?.ente_ufficio) || s(c?.ente_o_ufficio)

  const byType = c?.tipo_cliente === 'azienda'
    ? azienda
    : c?.tipo_cliente === 'pubblica_amministrazione'
      ? ente
      : persona

  return byType
    || s(c?.full_name)
    || persona || azienda || ente
    || s(c?.email) || s(c?.telefono) || s(c?.phone)
    || 'Cliente senza nome'
}
