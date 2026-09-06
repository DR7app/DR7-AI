# Website Builder

Area del gestionale da cui si amministra il sito pubblico: pagine,
sezioni, tema, media, SEO, popup, versioni.

Vive **accanto** all'onglet **Sito**, non al posto suo:

| | Sito | Website Builder |
|---|---|---|
| Cosa gestisce | i **testi** delle pagine React esistenti (`site_copy`) | la **struttura**: sezioni, ordine, colori, caratteri, pagine nuove |
| Dove salva | `centralina_pro_config.config.site_copy` | tabelle `wb_*` |
| Va online | al salvataggio | solo con **Pubblica** |
| Storico | no | ogni pubblicazione lascia una versione ripristinabile |

---

## 1. Prima di tutto: la migrazione

```
supabase/migrations/20260904_website_builder.sql
```

Da eseguire nel SQL editor di Supabase. E' **additiva e idempotente**:
crea solo tabelle nuove con prefisso `wb_`, non tocca nessuna tabella
esistente, si puo' rieseguire senza danni. Finche' non gira, il
gestionale e il sito funzionano esattamente come prima e la tab lo dice
in chiaro invece di riempirsi di errori.

Per annullare tutto: `DROP` delle tabelle `wb_*`. Nessun dato del
gestionale o del sito ne dipende.

## 2. Perche' introdurlo non cambia il sito

Tre interruttori, tutti spenti all'inizio:

1. **Per pagina** — `wb_pages.overrides_route`. Finche' e' spento, la
   rotta continua a essere disegnata dal componente React di sempre
   (`WbOppure` in `App.tsx`). Una pagina del builder su un indirizzo
   *nuovo* non ha bisogno del flag: non c'e' niente da sostituire.
2. **Header** — `settings.use_builder_header`.
3. **Footer** — `settings.use_builder_footer`.

E l'importazione (`Impostazioni globali > Importa il sito attuale`)
crea tutte le pagine come **bozze** con gli interruttori spenti.

Se la RPC pubblica non risponde (migrazione non eseguita, rete, permessi)
il sito si comporta come prima: `caricaSitoBuilder()` restituisce `null`
e ogni componente ripiega sui figli.

## 3. Schema dati

| Tabella | Cosa contiene |
|---|---|
| `wb_sites` | un sito per tenant (`tenant_id` + `key` unici), impostazioni globali, tema attivo, puntatore alla versione online |
| `wb_pages` | pagine, con `draft_content` e `published_content` **separati** |
| `wb_themes` | temi = token di design |
| `wb_navigation` | header / footer (bozza + pubblicato) |
| `wb_media` | libreria media (file in `storage://website-media/<tenant>/<sito>/…`) |
| `wb_overlays` | popup, striscioni, promozioni |
| `wb_scripts` | integrazioni di terze parti |
| `wb_templates` | sezioni e pagine salvate come modello |
| `wb_versions` | istantanea COMPLETA del sito a ogni pubblicazione |
| `wb_audit_log` | chi ha fatto cosa |
| `wb_form_submissions` | messaggi ricevuti dai moduli |

### Pubblicazione atomica

`wb_publish_site()` fa tutto in **una transazione**: copia le bozze,
scrive l'istantanea, sposta `wb_sites.published_version_id`. Il sito non
puo' mostrare meta' vecchio e meta' nuovo; se qualcosa fallisce, resta
online l'ultima versione valida.

`wb_restore_version()` non riscrive lo storico: crea una versione nuova
con il contenuto di quella scelta, quindi si puo' tornare anche avanti.
Le **bozze non vengono toccate** da un ripristino.

### Lettura pubblica

Il sito passa da **una sola** chiamata: `wb_public_site(key, tenant)`,
`SECURITY DEFINER`, eseguibile da `anon`. Restituisce solo l'istantanea
pubblicata — bozze e tabelle interne restano invisibili. Nessuna tabella
`wb_*` e' leggibile in chiaro da un utente autenticato qualsiasi: il
gestionale e il sito condividono lo stesso progetto Supabase, quindi
"authenticated" comprende ogni cliente registrato su dr7.app.

## 4. Permessi

In `admins.permissions[]`:

```
website.view   guarda
website.edit   modifica (implica view)
website.publish manda online
website.media  carica ed elimina file
website.seo    modifica i meta
website.theme  cambia tema e Design System
website.settings impostazioni globali e importazione
website.code   HTML libero, CSS globale, script di terze parti
```

`website` come permesso di tab da' tutto **tranne** `website.code`.
Superadmin, `role:direzione` e `role:developer` hanno tutto. Un
operatore puo' quindi modificare senza poter pubblicare.

Gli stessi diritti sono applicati dalla RLS (`wb_puo_leggere`,
`wb_puo_scrivere`, `wb_puo_pubblicare`): il controllo nell'interfaccia
non basta mai da solo.

## 5. File condivisi tra i due repo

Il gestionale disegna l'anteprima con **lo stesso codice** che il sito usa
per disegnare la pagina. I quattro file condivisi:

```
DR7-staging/src/pages/admin/components/website/shared/
  wbSchema.ts          forma dei dati, sanificazione, testi bilingui
  wbStyle.ts           dai valori del builder al CSS (inline + @media)
  wbData.ts            dati veri del gestionale -> elementi di un blocco
  WbBlockRenderer.tsx  42 tipi di sezione, 22 implementazioni

Sito/components/website/   <- copia identica
```

```
npm run wb:sync     copia dal gestionale al sito
npm run wb:check    fallisce se le due copie divergono
```

**La sorgente e' sempre il gestionale.** Se le copie divergono,
l'anteprima comincia a mentire.

Nessuno di quei file importa router, Tailwind o contesti: il sito usa
Tailwind 3 e il gestionale Tailwind 4, e una classe composta a runtime
non verrebbe generata in nessuno dei due. Tutto lo stile guidato dal
builder e' **inline o in una regola CSS generata**.

## 6. Dati veri contro contenuto editoriale

Un blocco a schede puo' avere gli elementi scritti a mano
(`dataSource.kind = 'manual'`) oppure collegati al gestionale
(`auto`, `category`, `ids`, `latest`, `available`).

Nel secondo caso il builder decide **quali** mostrare e **come**; il dato
resta dov'e': se il prezzo cambia in Centralina Pro cambia sul sito senza
toccare la pagina. Le collezioni collegate: `vehicles`, `categories`,
`services`, `promotions`, `reviews`.

Una lettura per collezione per pagina, condivisa tra i blocchi che
chiedono la stessa cosa. Una pagina senza blocchi dinamici non fa
nemmeno una query in piu'.

## 7. Prestazioni

- Il sito fa **una** chiamata per l'intera configurazione, tenuta in
  memoria e in `sessionStorage` per 5 minuti.
- Il renderer completo (50 kB) e' in un chunk separato: si scarica solo
  quando una pagina del builder viene davvero servita. Lo stesso per
  header/footer del builder (7 kB) e per i popup (4 kB).
- Peso aggiunto al bundle principale del sito: circa 10 kB gzip.
- Le immagini caricate vengono ridimensionate e convertite in WebP prima
  del caricamento; le miniature passano dall'endpoint di trasformazione
  di Supabase.
- I caratteri Google non gia' presenti nel sito si caricano solo se il
  tema li usa davvero, con `display=swap`.

## 8. Sicurezza

- Il builder **non salva HTML arbitrario per le pagine**: dati
  strutturati piu' componenti controllati. L'unica eccezione e' il blocco
  "HTML/embed", riservato a `website.code` e comunque ripulito
  (`wbSanitizeHtml`: via script, gestori inline, `javascript:`, tag che
  dirottano la pagina).
- Ogni indirizzo passa da `wbSafeUrl`; gli embed solo dalla lista in
  `WB_EMBED_ALLOWLIST`.
- I file: tipo MIME e dimensione controllati prima del caricamento
  (12 MB immagini, 200 MB video).
- Gli script di terze parti partono **solo dopo il consenso ai cookie**
  gia' in uso sul sito (`dr7-cookie-consent`), tranne quelli dichiarati
  tecnici. Il consenso esistente resta l'autorita'.
- I moduli passano da una Netlify Function con service role: nessun
  permesso di scrittura viene dato ad `anon`.

## 9. Multi-azienda

`tenant_id` + `key` su `wb_sites`, chiave esterna su tutto il resto,
percorsi storage `<tenant>/<sito>/…`. Un'altra azienda sulla stessa
piattaforma non vede nulla, nemmeno i nomi dei file. La RLS non filtra
per tenant perche' oggi c'e' un solo sito per installazione: quando ne
serviranno di piu' per la stessa base dati, va aggiunta la condizione
sul tenant dell'operatore nelle policy `wb_*`.

## 10. Cosa NON e' stato fatto (e perche')

- **Anteprima in una scheda separata**: al suo posto c'e' l'anteprima a
  schermo intero dentro l'editor. Una scheda separata avrebbe richiesto
  di esporre le bozze a una sessione non autenticata.
- **Validazione del CSS avanzato**: il CSS di sezione e' confinato al
  blocco (`&` viene sostituito con il selettore della sezione), quello
  globale no. E' dietro `website.code` e si annulla svuotando il campo o
  ripristinando una versione.
- **Piu' siti per azienda, blog, A/B test, e-commerce**: lo schema non li
  impedisce (`wb_sites` e' gia' plurale), ma non c'e' interfaccia.
- **Sitemap e robots**: quelli del sito non vengono toccati. Le pagine
  del builder dichiarano `index/noindex` e il canonico per pagina.

## 11. Test

```
DR7-staging: npm test        118 test del builder (su 465 totali)
Sito:        npm test        17 test delle regole lato sito (su 46 totali)
```

Coprono: sanificazione HTML e indirizzi, CSS responsive generato,
duplicazione senza id condivisi, controlli prima della pubblicazione
(compreso il contrasto), disegno di **tutti** i 42 tipi di sezione, e la
regola che impedisce a una pagina del builder di sostituire una pagina
esistente senza il flag.

Lo schema SQL ha il suo scenario completo, su un Postgres vero in memoria:

```
npm run wb:verifica
```

Prova migrazione idempotente, permessi granulari, importazione che non
manda niente online, modifica che resta nella bozza, sostituzione di una
pagina esistente, ripristino che non tocca le bozze, pubblicazione
respinta che lascia online la versione precedente, e isolamento fra due
aziende sulla stessa base dati.
