-- Sblocco pre-autorizzazione cauzione: nuovo codice OTP configurabile.
--
-- Richiesta direzione (18/08/2026): il bottone "SBLOCCA PRE-AUTH" nella tab
-- Cauzioni rilascia una garanzia in denaro sulla carta del cliente. Come le
-- altre azioni sensibili passa dall'OTP direzionale, e come tutte resta
-- disattivabile dalla tab OTP (is_required = false -> l'azione parte diretta,
-- nessun blocco duro).
INSERT INTO public.system_otp_overrides (id, label, reason, used_in, is_required, sort_order)
VALUES (
  'cauzione_sblocca_preauth',
  'Sblocco Pre-Autorizzazione Cauzione',
  'Rilascio della pre-autorizzazione di una cauzione: i fondi tornano immediatamente disponibili sulla carta del cliente e la garanzia decade. Non si "ri-blocca": per riaverla serve una NUOVA pre-autorizzazione. Richiede autorizzazione della direzione.',
  'Cauzioni (bottone SBLOCCA PRE-AUTH sulla riga)',
  true,
  86
)
ON CONFLICT (id) DO NOTHING;

-- Verifica
SELECT id, label, is_required, sort_order
  FROM public.system_otp_overrides
 WHERE id = 'cauzione_sblocca_preauth';
