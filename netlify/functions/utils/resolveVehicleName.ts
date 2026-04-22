/**
 * Risolve il display_name del veicolo dalla fonte più affidabile (vehicles.display_name)
 * con fallback sui dati embed nel booking. Usare in ogni flow che sostituisce
 * {vehicle_name} in un messaggio uscente al cliente.
 *
 * Motivo: booking.vehicle_name è una stringa salvata all'epoca della prenotazione,
 * può essere stantia, con mismatch di maiuscole/parole extra, o puntare a un veicolo
 * eliminato. Il source of truth è vehicles.display_name via vehicle_id / plate.
 */
export async function resolveVehicleName(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  booking: any,
): Promise<string> {
  const FALLBACK =
    booking?.vehicle_name ||
    booking?.booking_details?.vehicle?.name ||
    booking?.booking_details?.vehicle?.display_name ||
    '';

  if (!booking) return FALLBACK;

  try {
    if (booking.vehicle_id) {
      const { data } = await supabase
        .from('vehicles')
        .select('display_name')
        .eq('id', booking.vehicle_id)
        .maybeSingle();
      if (data?.display_name) return data.display_name;
    }

    if (booking.vehicle_plate) {
      const plate = String(booking.vehicle_plate).replace(/\s/g, '').toUpperCase();
      const { data } = await supabase
        .from('vehicles')
        .select('display_name')
        .ilike('plate', plate)
        .maybeSingle();
      if (data?.display_name) return data.display_name;
    }
  } catch (err) {
    console.warn('[resolveVehicleName] lookup failed, falling back:', err);
  }

  return FALLBACK;
}
