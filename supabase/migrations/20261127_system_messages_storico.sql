-- 27/11/2026 (vocale di Valerio): "ho modificato un messaggio, l'ha salvato,
-- ma continua a mandare quello vecchio". Il motore legge sempre il testo
-- salvato, ma senza storico non si poteva dimostrare QUANDO il testo era
-- cambiato rispetto a un invio. Ogni modifica di testo o titolo lascia qui
-- la versione precedente con l'ora.

CREATE TABLE IF NOT EXISTS public.system_messages_storico (
  id           BIGSERIAL PRIMARY KEY,
  message_id   UUID NOT NULL,
  message_key  TEXT,
  label_prima  TEXT,
  body_prima   TEXT,
  label_dopo   TEXT,
  body_dopo    TEXT,
  modificato_da UUID DEFAULT auth.uid(),
  modificato_il TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS system_messages_storico_msg_idx
  ON public.system_messages_storico (message_id, modificato_il DESC);

ALTER TABLE public.system_messages_storico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS storico_lettura_admin ON public.system_messages_storico;
CREATE POLICY storico_lettura_admin ON public.system_messages_storico
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.dr7_system_messages_storico()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.message_body IS DISTINCT FROM OLD.message_body
     OR NEW.label IS DISTINCT FROM OLD.label THEN
    INSERT INTO public.system_messages_storico
      (message_id, message_key, label_prima, body_prima, label_dopo, body_dopo)
    VALUES (OLD.id, OLD.message_key, OLD.label, OLD.message_body, NEW.label, NEW.message_body);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_system_messages_storico ON public.system_messages;
CREATE TRIGGER trg_system_messages_storico
  AFTER UPDATE ON public.system_messages
  FOR EACH ROW EXECUTE FUNCTION public.dr7_system_messages_storico();
