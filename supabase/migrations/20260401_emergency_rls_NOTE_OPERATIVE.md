# NOTE OPERATIVE — Emergency RLS Lockdown

## Cosa protegge subito

La migrazione abilita RLS + FORCE RLS su **ogni tabella public** che ne era priva e revoca **tutti i grant al ruolo `anon`**. Inoltre rimuove le policy pericolose che concedevano accesso anonimo (es. `app_settings`, `birthday_discount_codes`, `system_messages`, `review_screenshot_submissions`, `sent_messages_log`).

Installa un event trigger (`trg_auto_enable_rls`) che protegge automaticamente ogni nuova tabella creata in futuro nello schema `public`.

**Tabelle note senza RLS prima della migrazione:**
- `blocked_card_attempts`
- `lottery_email_templates`
- `review_whatsapp_sent`
- `birthday_vouchers`
- `invoice_sequences`
- `review_candidates`
- `review_requests`
- `review_templates`
- `review_settings`
- `review_audit_logs`
- Qualsiasi altra tabella creata fuori dalle migrazioni tracciate (es. `bookings`, `customers_extended`, `vehicles`, `fleet_damages`, ecc.)

## Possibile impatto

**Chi NON e impattato:**
- Le Netlify Functions che usano `SUPABASE_SERVICE_ROLE_KEY` continuano a funzionare normalmente. Il `service_role` bypassa RLS per design Supabase.

**Chi POTREBBE essere impattato:**
- Query client-side (dal browser) che usano `supabase.from('tabella')` su tabelle che prima non avevano RLS: ora restituiranno **righe vuote** (non errori) finche non si creano policy appropriate.
- Policy con ruolo `anon` sono state rimosse. Se esistevano endpoint pubblici (es. validazione codici sconto birthday per utenti non autenticati), queste query non funzioneranno piu lato client.

**Tabelle con policy `anon` rimosse:**
- `app_settings` — aveva 3 policy anon (read/insert/update)
- `birthday_discount_codes` — aveva 1 policy anon (select per validare codici)
- `system_messages` — aveva policy per ruolo `public` (= tutti, incluso anon)
- `sent_messages_log` — aveva policy per ruolo `public`
- `review_screenshot_submissions` — aveva policy per ruolo `public`

## Come creare policy sicure tabella per tabella

Per ogni tabella che necessita accesso da parte di `authenticated`:

```sql
-- Esempio: permettere SELECT a utenti autenticati su una tabella
CREATE POLICY "authenticated_select_<tabella>"
ON public.<tabella>
FOR SELECT
TO authenticated
USING (true);  -- oppure una condizione piu restrittiva

-- Esempio: permettere INSERT a utenti autenticati
CREATE POLICY "authenticated_insert_<tabella>"
ON public.<tabella>
FOR INSERT
TO authenticated
WITH CHECK (true);  -- oppure condizione
```

**Best practice per le nuove policy:**
1. Mai usare `TO anon` a meno che non sia strettamente necessario (es. landing page pubblica)
2. Preferire condizioni specifiche a `USING (true)` — es. `USING (auth.uid() = user_id)`
3. Separare SELECT/INSERT/UPDATE/DELETE in policy distinte
4. Documentare ogni policy con un nome descrittivo
5. Testare sempre con il ruolo `authenticated` nel SQL Editor prima di deployare

## Ordine di esecuzione

1. Eseguire `20260401_emergency_rls_lockdown.sql` nel SQL Editor
2. Eseguire `20260401_emergency_rls_VERIFY.sql` e controllare i risultati
3. Testare l'applicazione (admin panel) — le Netlify Functions usano service_role, quindi dovrebbero funzionare
4. Se serve, creare policy mirate per le tabelle che necessitano accesso client-side `authenticated`
5. In caso di problemi gravi, eseguire `20260401_emergency_rls_ROLLBACK.sql` (rimuove solo il trigger automatico)
