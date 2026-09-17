import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { hasApprovedOverride } from './utils/verifyOverride';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// 17/09/2026 (direzione): la tab Credit Wallet mostra tutti i clienti della
// Lead, anche chi non si e' mai iscritto al sito. Il wallet vive sull'account
// del sito: se la scheda non ne ha uno, lo si crea qui (con l'email della
// scheda, gia' confermata) e lo si aggancia alla scheda, senza doppioni.
// Il cliente entra poi sul sito con "Password dimenticata".
// `id` puo' essere l'id della scheda oppure, per chi non ha scheda, l'id
// dell'account stesso.
async function accountDelCliente(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  id: string,
): Promise<{ userId: string | null; errore?: string }> {
  const { data: scheda } = await db
    .from('customers_extended')
    .select('id, user_id, email')
    .eq('id', id)
    .maybeSingle();

  if (!scheda) {
    // Riga della lista senza scheda: l'id e' gia' quello dell'account.
    const { data: utente } = await db.auth.admin.getUserById(id);
    return utente?.user?.id ? { userId: utente.user.id } : { userId: null, errore: 'Cliente non trovato' };
  }
  if (scheda.user_id) return { userId: scheda.user_id };

  const email = String(scheda.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return { userId: null, errore: 'Il cliente non ha un account sul sito e nella scheda manca l\'email: aggiungila in Lead e riprova.' };
  }

  let userId: string | null = null;
  const { data: creato, error: errCrea } = await db.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { creato_da: 'gestionale_credit_wallet' },
  });
  if (creato?.user?.id) {
    userId = creato.user.id;
  } else {
    // Email gia' registrata: si usa quell'account. generateLink restituisce
    // l'utente senza inviare nulla.
    const { data: link } = await db.auth.admin.generateLink({ type: 'magiclink', email });
    userId = link?.user?.id || null;
    if (!userId) {
      return { userId: null, errore: `Impossibile creare l'account sito del cliente: ${errCrea?.message || 'errore sconosciuto'}` };
    }
  }

  // Il trigger su auth.users puo' aver gia' agganciato questa scheda, oppure
  // aver creato una scheda nuova vuota per lo stesso account: in quel caso la
  // scheda nuova si toglie (solo se creata ora dall'iscrizione) e l'account
  // va sulla scheda dell'ufficio.
  const { data: giaCollegate } = await db
    .from('customers_extended')
    .select('id, source, created_at')
    .eq('user_id', userId);
  const righe = (giaCollegate || []) as Array<{ id: string; source: string | null; created_at: string }>;
  if (righe.some(r => r.id === scheda.id)) return { userId };

  const appenaCreate = righe.filter(r =>
    r.source === 'website_registration' && Date.now() - new Date(r.created_at).getTime() < 5 * 60 * 1000);
  if (appenaCreate.length === righe.length && righe.length > 0) {
    await db.from('customers_extended').delete().in('id', appenaCreate.map(r => r.id));
  } else if (righe.length > 0) {
    // L'account esiste gia' ed e' di un'altra scheda (cliente gia' iscritto):
    // si usa quello, le schede non si toccano.
    return { userId };
  }

  const { error: errAggancio } = await db
    .from('customers_extended')
    .update({ user_id: userId, updated_at: new Date().toISOString() })
    .eq('id', scheda.id)
    .is('user_id', null);
  if (errAggancio) {
    console.error('[customer-wallet-admin] aggancio account fallito:', errAggancio);
  }
  return { userId };
}

const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  }

  try {
    const authHeader = event.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Non autorizzato' }) };
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token non valido' }) };
    }

    const { action, customer_id, user_id, amount, description, query, nature, overrideId,
            destinatari, scadenza, servizi, clientOverrideId } = JSON.parse(event.body || '{}');

    switch (action) {
      case 'list_all_balances': {
        // Return all user_credit_balance records (service role bypasses RLS)
        const serviceSupabase = createClient(
          process.env.VITE_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
        const { data: balances, error: balErr } = await serviceSupabase
          .from('user_credit_balance')
          .select('user_id, balance');
        if (balErr) throw balErr;
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, balances: balances || [] })
        };
      }
      case 'credit_transactions': {
        // Return transactions from BOTH systems (credit_transactions + wallet_transactions)
        const svc = createClient(
          process.env.VITE_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        // Find user_id and phone
        let userId = user_id;
        let custPhone = '';
        if (customer_id) {
          const { data: cust } = await svc
            .from('customers_extended')
            .select('user_id, telefono')
            .eq('id', customer_id)
            .maybeSingle();
          if (cust) {
            userId = userId || cust.user_id;
            custPhone = cust.telefono || '';
          }
        }

        const allTxns: any[] = [];

        // 1. Website credit_transactions (by user_id)
        if (userId) {
          const { data: txns } = await svc
            .from('credit_transactions')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(50);
          if (txns) {
            txns.forEach(t => allTxns.push({
              ...t,
              source: 'credit_transactions'
            }));
          }
        }

        // 2. Referral wallet_transactions (by phone → participant → wallet)
        if (custPhone) {
          // Try multiple phone formats
          let cleanPhone = custPhone.replace(/\D/g, '')
          const phoneVariants = [cleanPhone]
          if (cleanPhone.startsWith('39') && cleanPhone.length === 12) phoneVariants.push(cleanPhone.substring(2))
          if (!cleanPhone.startsWith('39') && cleanPhone.length === 10) phoneVariants.push('39' + cleanPhone)
          phoneVariants.push('+39' + cleanPhone.replace(/^39/, ''))

          let participant: any = null
          for (const pv of phoneVariants) {
            const { data: p } = await svc
              .from('referral_participants')
              .select('id')
              .eq('telefono', pv)
              .maybeSingle()
            if (p) { participant = p; break }
          }

          if (participant) {
            const { data: wallet } = await svc
              .from('wallets')
              .select('id')
              .eq('participant_id', participant.id)
              .maybeSingle();

            if (wallet) {
              const { data: wTxns } = await svc
                .from('wallet_transactions')
                .select('*')
                .eq('wallet_id', wallet.id)
                .order('created_at', { ascending: false })
                .limit(50);

              if (wTxns) {
                wTxns.forEach(t => allTxns.push({
                  id: t.id,
                  user_id: userId,
                  transaction_type: t.amount_cents >= 0 ? 'credit' : 'debit',
                  amount: Math.abs(t.amount_cents) / 100,
                  balance_after: t.balance_after_cents / 100,
                  description: t.description || t.type || '-',
                  created_at: t.created_at,
                  source: 'wallet_transactions'
                }));
              }
            }
          }
        }

        // Sort by date descending and deduplicate
        allTxns.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, transactions: allTxns.slice(0, 50) })
        };
      }
      case 'search': {
        if (!query || query.trim().length < 2) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Inserisci almeno 2 caratteri per la ricerca' }),
          };
        }

        const searchTerm = query.trim().toLowerCase();

        const { data: customers, error: searchError } = await supabase
          .from('customers_extended')
          .select('id, nome, cognome, email, telefono, ragione_sociale, denominazione, tipo_cliente')
          .or(`email.ilike.%${searchTerm}%,nome.ilike.%${searchTerm}%,cognome.ilike.%${searchTerm}%,ragione_sociale.ilike.%${searchTerm}%,denominazione.ilike.%${searchTerm}%,telefono.ilike.%${searchTerm}%`)
          .limit(20);

        if (searchError) throw searchError;

        // Get wallet balances by matching customer phone → referral_participants.telefono → wallets
        const phones = (customers || []).map(c => c.telefono).filter(Boolean);
        let walletMap = new Map<string, number>();

        if (phones.length > 0) {
          const { data: participants } = await supabase
            .from('referral_participants')
            .select('id, telefono')
            .in('telefono', phones);

          if (participants && participants.length > 0) {
            const participantIds = participants.map(p => p.id);
            const { data: wallets } = await supabase
              .from('wallets')
              .select('participant_id, balance_cents')
              .in('participant_id', participantIds);

            // Build phone → balance map
            const participantPhoneMap = new Map<string, string>();
            participants.forEach((p: any) => participantPhoneMap.set(p.id, p.telefono));

            (wallets || []).forEach((w: any) => {
              const phone = participantPhoneMap.get(w.participant_id);
              if (phone) walletMap.set(phone, w.balance_cents);
            });
          }
        }

        const results = (customers || []).map((c: any) => {
          const fullName = c.tipo_cliente === 'persona_fisica'
            ? `${c.nome || ''} ${c.cognome || ''}`.trim()
            : (c.ragione_sociale || c.denominazione || 'Cliente');
          return {
            id: c.id,
            full_name: fullName || 'Cliente',
            email: c.email,
            phone: c.telefono,
            balance_cents: walletMap.get(c.telefono) ?? null,
          };
        });

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, customers: results }),
        };
      }

      case 'credit':
      case 'debit': {
        if (!customer_id || !amount || amount <= 0) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'customer_id e importo obbligatori' }),
          };
        }

        const amountEur = amount;
        const isCredit = action === 'credit';

        // Use service role for user_credit_balance (bypasses RLS)
        const serviceSupabase = createClient(
          process.env.VITE_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        // Account sito del cliente: se manca, lo si crea e lo si aggancia.
        const { userId, errore: erroreAccount } = await accountDelCliente(serviceSupabase, customer_id);
        if (!userId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: erroreAccount || 'Account sito del cliente non trovato.' }),
          };
        }

        // Get or create credit balance
        let { data: creditBalance } = await serviceSupabase
          .from('user_credit_balance')
          .select('user_id, balance')
          .eq('user_id', userId)
          .maybeSingle();

        const currentBalance = creditBalance?.balance ? parseFloat(creditBalance.balance) : 0;
        const newBalance = isCredit
          ? Math.round((currentBalance + amountEur) * 100) / 100
          : Math.round((currentBalance - amountEur) * 100) / 100;

        // 2026-08-09 (roadmap #43, "avviso sempre, blocco mai"): portare il
        // wallet in negativo era vietato in assoluto. Serve pero' quando la
        // direzione addebita una penale o un danno superiore al credito
        // residuo. Ora si puo', con autorizzazione OTP verificata qui dal
        // server: il client manda l'id, non la parola "sono autorizzato".
        if (newBalance < 0) {
          const authorized = await hasApprovedOverride(serviceSupabase, overrideId, 'wallet.saldo_negativo');
          if (!authorized) {
            return {
              statusCode: 400,
              headers,
              body: JSON.stringify({
                error: `Saldo insufficiente: dopo l'addebito il wallet andrebbe a €${newBalance.toFixed(2)}.`,
                overridable: true,
                overrideCode: 'wallet.saldo_negativo',
                resulting_balance: newBalance,
              }),
            };
          }
          console.log(`[customer-wallet-admin] Saldo negativo (€${newBalance.toFixed(2)}) AUTORIZZATO dalla direzione per ${userId}`);
        }

        // 17/09/2026 (direzione): l'addebito manuale vuole il codice del
        // CLIENTE (email). Il database verifica che il codice sia confermato,
        // del titolare di questo wallet e che copra l'importo, e lo consuma.
        // Se la funzione SQL non e' ancora installata si prosegue (il
        // gestionale non deve fermarsi per una migrazione non ancora lanciata).
        if (!isCredit) {
          const { error: autErr } = await serviceSupabase.rpc('dr7_wallet_consuma_autorizzazione', {
            p_override: clientOverrideId || null,
            p_account: userId,
            p_importo: amountEur,
            p_riferimento: { tipo: 'addebito_manuale', operatore: user.email || null },
          });
          if (autErr) {
            const funzioneAssente = autErr.code === 'PGRST202' || autErr.code === '42883'
              || /could not find the function/i.test(autErr.message || '');
            if (!funzioneAssente) {
              return { statusCode: 400, headers, body: JSON.stringify({ error: autErr.message }) };
            }
            console.warn('[customer-wallet-admin] dr7_wallet_consuma_autorizzazione non installata: addebito senza verifica del codice cliente');
          }
        }

        if (!creditBalance) {
          await serviceSupabase.from('user_credit_balance').insert({
            user_id: userId,
            balance: newBalance,
            last_updated: new Date().toISOString()
          });
        } else {
          await serviceSupabase.from('user_credit_balance').update({
            balance: newBalance,
            last_updated: new Date().toISOString()
          }).eq('user_id', userId);
        }

        // Record transaction
        //
        // 2026-08-08: la natura del credito arriva dalla tab Wallet e decide il
        // reference_type. Prima si scriveva sempre 'admin_manual', classificato
        // come BONUS: una ricarica reale registrata a mano finiva quindi nel
        // bonus del cliente (e il bonus del pacchetto nel credito reale) — è la
        // causa dell'inversione credito/bonus segnalata. Ora:
        //   'admin_topup' -> denaro incassato: credito reale, è capitale,
        //                    matura gli interessi DR7 Club, attiva il referral.
        //   'admin_bonus' -> omaggio: è bonus, niente interessi, niente referral.
        // Assente/non riconosciuta -> 'admin_topup' (il caso più frequente per
        // un credito una tantum inserito da un operatore).
        const creditReferenceType = String(nature || '').toLowerCase() === 'bonus'
          ? 'admin_bonus'
          : 'admin_topup';
        await serviceSupabase.from('credit_transactions').insert({
          user_id: userId,
          transaction_type: isCredit ? 'credit' : 'debit',
          amount: amountEur,
          balance_after: newBalance,
          description: description || (isCredit ? 'Credito manuale admin' : 'Addebito manuale admin'),
          reference_type: isCredit ? creditReferenceType : 'admin_manual'
        });

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, new_balance_cents: Math.round(newBalance * 100) }),
        };
      }

      // ── CREDITO VINCOLATO (16/09/2026) ──────────────────────────────
      // Un credito che vale SOLO su certi servizi e SOLO fino a una data.
      // Non entra in `user_credit_balance`: vive nei suoi lotti, e la spesa
      // lo consuma per primo (trigger `dr7_wallet_sync_prenotazione`).
      //
      // Si puo' dare a un cliente, a una selezione o a tutti. "Tutti" vuol
      // dire tutti quelli che hanno un account sito: senza account non c'e'
      // wallet da riempire. La risposta dice quante righe sono state scritte
      // e quanto vale il regalo in totale — chi preme il bottone deve poterlo
      // confrontare con quello che si aspettava.
      case 'credito_vincolato': {
        const importo = Number(amount);
        if (!Number.isFinite(importo) || importo <= 0) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'Importo obbligatorio' }) };
        }

        const serviceSupabase = createClient(
          process.env.VITE_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        const tipo = String(destinatari?.tipo || 'cliente');
        // Il wallet sta sull'ACCOUNT, non sulla scheda: un cliente con due
        // schede non deve ricevere il credito due volte, e un iscritto al sito
        // senza scheda deve poterlo ricevere lo stesso. Per questo la lista
        // del tab Marketing manda gli user_id; le schede restano accettate
        // (customer_ids) per chi chiama dalla scheda cliente.
        const userIdsRichiesti: string[] = Array.isArray(destinatari?.user_ids)
          ? destinatari.user_ids.filter(Boolean).map(String)
          : [];
        const customerIdsRichiesti: string[] = Array.isArray(destinatari?.customer_ids)
          ? destinatari.customer_ids.filter(Boolean).map(String)
          : [];

        const perAccount = new Map<string, { id: string; nome: string }>();

        const aggiungiSchede = async (filtro: (q: any) => any) => {
          const { data, error: err } = await filtro(
            serviceSupabase.from('customers_extended').select('id, user_id, nome, cognome').not('user_id', 'is', null)
          );
          if (err) throw new Error(err.message);
          for (const c of data || []) {
            const uid = String((c as { user_id?: string }).user_id || '');
            if (!uid || perAccount.has(uid)) continue;
            perAccount.set(uid, {
              id: String((c as { id: string }).id),
              nome: [(c as { nome?: string }).nome, (c as { cognome?: string }).cognome].filter(Boolean).join(' '),
            });
          }
        };

        try {
          if (tipo === 'cliente') {
            if (!customer_id) {
              return { statusCode: 400, headers, body: JSON.stringify({ error: 'Cliente obbligatorio' }) };
            }
            await aggiungiSchede(q => q.eq('id', customer_id));
          } else if (tipo === 'selezione') {
            if (userIdsRichiesti.length === 0 && customerIdsRichiesti.length === 0) {
              return { statusCode: 400, headers, body: JSON.stringify({ error: 'Nessun cliente selezionato' }) };
            }
            if (customerIdsRichiesti.length > 0) await aggiungiSchede(q => q.in('id', customerIdsRichiesti));
            for (const uid of userIdsRichiesti) {
              if (!perAccount.has(uid)) perAccount.set(uid, { id: uid, nome: '' });
            }
          } else if (tipo === 'tutti') {
            await aggiungiSchede(q => q);
            // Chi ha gia' un wallet ma non ha una scheda compilata: e' un
            // cliente a tutti gli effetti, "tutti" vuol dire anche lui.
            const { data: saldi } = await serviceSupabase
              .from('user_credit_balance').select('user_id');
            for (const b of saldi || []) {
              const uid = String((b as { user_id?: string }).user_id || '');
              if (uid && !perAccount.has(uid)) perAccount.set(uid, { id: uid, nome: '' });
            }
          } else {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Destinatari non validi' }) };
          }
        } catch (e) {
          return { statusCode: 500, headers, body: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) };
        }

        if (perAccount.size === 0) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Nessun destinatario con account sito: senza account non esiste un wallet da riempire.' }),
          };
        }

        // Servizi: lista vuota = vale su tutto. Vale la pena scriverlo NULL,
        // cosi' la regola in SQL e' una sola.
        const serviziPuliti = Array.isArray(servizi)
          ? servizi.map((s: unknown) => String(s || '').trim()).filter(Boolean)
          : [];

        // Senza scadenza e senza servizi non c'e' nessun vincolo: e' una
        // ricarica normale a piu' persone. Va nel SALDO, non in un lotto —
        // altrimenti il cliente avrebbe un credito che non vede nel saldo e
        // che non conta per gli interessi del Club.
        if (!scadenza && serviziPuliti.length === 0) {
          const tipoRiga = String(nature || '').toLowerCase() === 'bonus' ? 'admin_bonus' : 'admin_topup';
          let scritti = 0;
          for (const uid of perAccount.keys()) {
            const { data: saldoRiga } = await serviceSupabase
              .from('user_credit_balance').select('balance').eq('user_id', uid).maybeSingle();
            const saldoAttuale = saldoRiga?.balance ? parseFloat(String(saldoRiga.balance)) : 0;
            const nuovoSaldo = Math.round((saldoAttuale + importo) * 100) / 100;
            if (saldoRiga) {
              await serviceSupabase.from('user_credit_balance')
                .update({ balance: nuovoSaldo, last_updated: new Date().toISOString() })
                .eq('user_id', uid);
            } else {
              await serviceSupabase.from('user_credit_balance')
                .insert({ user_id: uid, balance: nuovoSaldo, last_updated: new Date().toISOString() });
            }
            await serviceSupabase.from('credit_transactions').insert({
              user_id: uid,
              transaction_type: 'credit',
              amount: importo,
              balance_after: nuovoSaldo,
              description: description || 'Credito manuale admin',
              reference_type: tipoRiga,
            });
            scritti++;
          }
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              destinatari: scritti,
              totale: Math.round(importo * scritti * 100) / 100,
              nel_saldo: true,
            }),
          };
        }

        const righe = [...perAccount.entries()].map(([uid]) => ({
          user_id: uid,
          importo,
          residuo: importo,
          scadenza: scadenza || null,
          servizi: serviziPuliti.length > 0 ? serviziPuliti : null,
          descrizione: description || null,
          origine: 'admin',
          creato_da: user.id,
        }));

        const { error: erroreInsert } = await serviceSupabase
          .from('wallet_crediti_vincolati')
          .insert(righe);

        if (erroreInsert) {
          return { statusCode: 500, headers, body: JSON.stringify({ error: erroreInsert.message }) };
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            destinatari: righe.length,
            totale: Math.round(importo * righe.length * 100) / 100,
          }),
        };
      }

      // Lotti vincolati di un cliente, con quanto resta e se sono ancora buoni.
      case 'crediti_vincolati': {
        if (!user_id && !customer_id) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'Cliente obbligatorio' }) };
        }
        const serviceSupabase = createClient(
          process.env.VITE_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
        let uid = user_id;
        if (!uid && customer_id) {
          const { data: c } = await serviceSupabase
            .from('customers_extended').select('user_id').eq('id', customer_id).maybeSingle();
          uid = (c as { user_id?: string } | null)?.user_id;
        }
        if (!uid) {
          return { statusCode: 200, headers, body: JSON.stringify({ lotti: [] }) };
        }
        const { data: lotti, error: erroreLotti } = await serviceSupabase
          .from('wallet_crediti_vincolati')
          .select('*')
          .eq('user_id', uid)
          .order('created_at', { ascending: false });
        if (erroreLotti) {
          return { statusCode: 500, headers, body: JSON.stringify({ error: erroreLotti.message }) };
        }
        return { statusCode: 200, headers, body: JSON.stringify({ lotti: lotti || [] }) };
      }

      case 'transactions': {
        if (!customer_id) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'customer_id obbligatorio' }),
          };
        }

        // Find customer phone → participant → wallet
        const { data: customer } = await supabase
          .from('customers_extended')
          .select('telefono')
          .eq('id', customer_id)
          .single();

        if (!customer?.telefono) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, wallet: null, transactions: [] }),
          };
        }

        const { data: participant } = await supabase
          .from('referral_participants')
          .select('id')
          .eq('telefono', customer.telefono)
          .single();

        if (!participant) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, wallet: null, transactions: [] }),
          };
        }

        const { data: wallet } = await supabase
          .from('wallets')
          .select('*')
          .eq('participant_id', participant.id)
          .single();

        if (!wallet) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, wallet: null, transactions: [] }),
          };
        }

        const { data: transactions } = await supabase
          .from('wallet_transactions')
          .select('*')
          .eq('wallet_id', wallet.id)
          .order('created_at', { ascending: false })
          .limit(50);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, wallet, transactions: transactions || [] }),
        };
      }

      case 'wallet_stats': {
        // Aggregate credit_transactions over the last 6 calendar months
        // (Europe/Rome). Returns monthly buckets + per-user totals so the
        // admin UI can render charts/columns without N+1 queries.
        const svc = createClient(
          process.env.VITE_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        const sinceDate = new Date();
        sinceDate.setMonth(sinceDate.getMonth() - 6);
        sinceDate.setDate(1);
        sinceDate.setHours(0, 0, 0, 0);

        const allRows: any[] = [];
        let from = 0;
        const PAGE = 1000;
        while (true) {
          const { data, error } = await svc
            .from('credit_transactions')
            .select('user_id, amount, transaction_type, created_at')
            .gte('created_at', sinceDate.toISOString())
            .order('created_at', { ascending: false })
            .range(from, from + PAGE - 1);
          if (error) throw error;
          if (!data || data.length === 0) break;
          allRows.push(...data);
          if (data.length < PAGE) break;
          from += data.length;
        }

        const monthKey = (d: Date) =>
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

        const months: string[] = [];
        const now = new Date();
        for (let i = 5; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          months.push(monthKey(d));
        }
        const monthly: Record<string, { credits_cents: number; debits_cents: number }> = {};
        for (const m of months) monthly[m] = { credits_cents: 0, debits_cents: 0 };

        const perUser: Record<string, {
          spent_cents: number;
          recharged_cents: number;
          last_used_at: string | null;
          tx_count: number;
        }> = {};

        const nowMonthKey = monthKey(now);
        let rechargedThisMonth = 0;
        let totalRecharged = 0;
        let totalSpent = 0;

        for (const r of allRows) {
          const amountCents = Math.round(Number(r.amount || 0) * 100);
          const isCredit = r.transaction_type === 'credit' || amountCents > 0 && r.transaction_type !== 'debit';
          const absCents = Math.abs(amountCents);
          const d = new Date(r.created_at);
          const mk = monthKey(d);

          if (monthly[mk]) {
            if (isCredit) monthly[mk].credits_cents += absCents;
            else monthly[mk].debits_cents += absCents;
          }

          if (isCredit) {
            totalRecharged += absCents;
            if (mk === nowMonthKey) rechargedThisMonth += absCents;
          } else {
            totalSpent += absCents;
          }

          if (r.user_id) {
            if (!perUser[r.user_id]) {
              perUser[r.user_id] = { spent_cents: 0, recharged_cents: 0, last_used_at: null, tx_count: 0 };
            }
            const u = perUser[r.user_id];
            u.tx_count += 1;
            if (isCredit) u.recharged_cents += absCents;
            else {
              u.spent_cents += absCents;
              if (!u.last_used_at || new Date(u.last_used_at) < d) u.last_used_at = r.created_at;
            }
          }
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            months,
            monthly,
            per_user: perUser,
            totals: {
              recharged_cents: totalRecharged,
              spent_cents: totalSpent,
              recharged_this_month_cents: rechargedThisMonth,
            },
          }),
        };
      }

      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: `Azione non valida: ${action}` }),
        };
    }
  } catch (error: any) {
    console.error('Error in customer-wallet-admin:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

export { handler };
