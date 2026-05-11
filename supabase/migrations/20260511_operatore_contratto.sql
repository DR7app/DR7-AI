-- Tabella contratti operatore. Tiene storico (data_inizio/data_fine) cosi'
-- direzione puo' modificare la retribuzione nel tempo senza perdere lo
-- storico. Solo UN contratto attivo per operatore alla volta (vincolo unique
-- parziale piu' sotto).
--
-- Campi raccolti dalla nuova sezione "Contratti" in Report Operatori.

CREATE TABLE IF NOT EXISTS public.operatore_contratto (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operatore_id UUID NOT NULL REFERENCES public.operatori_persone(id) ON DELETE CASCADE,
  user_id UUID NULL,
  attivo BOOLEAN NOT NULL DEFAULT true,
  data_inizio DATE NOT NULL DEFAULT CURRENT_DATE,
  data_fine DATE NULL,

  tipo_rapporto TEXT NULL,

  -- Ore obiettivo
  ore_target_giornaliere NUMERIC(4,1) NULL,
  ore_target_settimanali NUMERIC(5,1) NULL,
  ore_target_mensili NUMERIC(6,1) NULL,
  giorni_lavorativi_settimana SMALLINT NULL CHECK (giorni_lavorativi_settimana BETWEEN 1 AND 7),

  -- Compenso
  stipendio_mensile_eur NUMERIC(10,2) NULL,
  paga_oraria_eur NUMERIC(8,2) NULL,
  paga_straordinario_eur NUMERIC(8,2) NULL,

  -- Flag operativi
  straordinario_abilitato BOOLEAN NOT NULL DEFAULT false,
  lavora_festivi BOOLEAN NOT NULL DEFAULT false,
  notifiche_attive BOOLEAN NOT NULL DEFAULT true,
  visibilita_fatturato BOOLEAN NOT NULL DEFAULT false,

  -- Note interne libere
  note TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NULL
);

-- Solo UN contratto attivo per operatore alla volta. Indice parziale: se
-- attivo=false e' permesso averne molti (storico).
CREATE UNIQUE INDEX IF NOT EXISTS idx_operatore_contratto_unico_attivo
  ON public.operatore_contratto (operatore_id)
  WHERE attivo = true;

-- Lookup veloce per timesheet / report
CREATE INDEX IF NOT EXISTS idx_operatore_contratto_operatore
  ON public.operatore_contratto (operatore_id, attivo);

CREATE INDEX IF NOT EXISTS idx_operatore_contratto_user
  ON public.operatore_contratto (user_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_operatore_contratto_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_operatore_contratto_updated_at ON public.operatore_contratto;
CREATE TRIGGER trg_operatore_contratto_updated_at
  BEFORE UPDATE ON public.operatore_contratto
  FOR EACH ROW
  EXECUTE FUNCTION public.set_operatore_contratto_updated_at();

-- RLS: direzione (Valerio + Ilenia by email) + ophe (developer) hanno
-- accesso pieno. L'operatore stesso puo' leggere il proprio contratto
-- (per visualizzare il proprio compenso/target). Altri admin: no access.
ALTER TABLE public.operatore_contratto ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operatore_contratto_direzione_all ON public.operatore_contratto;
CREATE POLICY operatore_contratto_direzione_all ON public.operatore_contratto
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = auth.uid()
        AND LOWER(u.email) IN ('valerio@dr7.app', 'ilenia@dr7.app', 'ophe@dr7.app')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = auth.uid()
        AND LOWER(u.email) IN ('valerio@dr7.app', 'ilenia@dr7.app', 'ophe@dr7.app')
    )
  );

DROP POLICY IF EXISTS operatore_contratto_self_read ON public.operatore_contratto;
CREATE POLICY operatore_contratto_self_read ON public.operatore_contratto
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR operatore_id IN (
      SELECT id FROM public.operatori_persone WHERE user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.operatore_contratto IS
  'Contratti operatore con storico: ore target, compenso, flag straordinario/festivi/notifiche. Solo uno attivo per operatore.';
