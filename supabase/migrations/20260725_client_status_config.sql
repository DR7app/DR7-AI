-- Status clienti personalizzabili da Centralina (roadmap 20).
-- Le CHIAVI (standard/member/elite/blacklist) restano stabili perche' guidano la
-- logica; qui si personalizzano SOLO nome, descrizione e colore mostrati.
CREATE TABLE IF NOT EXISTS public.client_status_config (
  status_key   TEXT PRIMARY KEY,   -- standard | member | elite | blacklist
  label        TEXT NOT NULL,
  descrizione  TEXT,
  color        TEXT NOT NULL DEFAULT 'gray',  -- gray|blue|amber|red|emerald|purple
  ordine       INTEGER NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.client_status_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_status_config_all ON public.client_status_config;
CREATE POLICY client_status_config_all ON public.client_status_config
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- Lettura anche anon (il sito potrebbe mostrarlo in futuro).
DROP POLICY IF EXISTS client_status_config_read ON public.client_status_config;
CREATE POLICY client_status_config_read ON public.client_status_config
  FOR SELECT TO anon USING (true);

INSERT INTO public.client_status_config (status_key, label, descrizione, color, ordine) VALUES
  ('standard',  'Cliente Standard',  'Cliente regolare',                       'gray',    1),
  ('member',    'Cliente Member',    'Cliente fidelizzato',                    'blue',    2),
  ('elite',     'Cliente Elite',     'Alto valore, basso rischio',            'amber',   3),
  ('blacklist', 'Cliente in Blacklist', 'Da monitorare / rischio elevato',    'red',     4)
ON CONFLICT (status_key) DO NOTHING;
