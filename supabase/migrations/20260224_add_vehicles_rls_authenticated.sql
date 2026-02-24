-- Add RLS policy for authenticated users on vehicles table
-- Without this, DELETE from the frontend returns 0 rows silently
-- Matches the pattern used by contracts, vehicle_maintenance, and vehicle_events tables

CREATE POLICY "Enable all access for authenticated users" ON public.vehicles
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
