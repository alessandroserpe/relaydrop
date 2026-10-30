# API 0.6

Origine HTTPS, senza prefisso; HTTP solo loopback con opzione esplicita. Nessun CORS. Il formato dei file RD01 è compatibile con 0.1. API completa descritta anche in [OpenAPI JSON](openapi.json).

## Identità e sessioni

Le API di gestione accettano `Authorization: Bearer TOKEN_IDENTITA` o il cookie della dashboard. `POST /v1/session` richiede Bearer e crea una sessione di otto ore; `DELETE /v1/session` termina la sessione; `GET /v1/me` restituisce id, nome, ruolo e stato configurazione avvisi. Mutazioni con cookie richiedono Origin corretto. Le sessioni sopravvivono ai riavvii. Logout e rotazione della credenziale le invalidano.

`POST /v1/session` accetta l’header opzionale `X-Remember-Device: 1`: cookie persistente di 90 giorni con rinnovo al massimo orario durante le richieste autenticate `GET /v1/me`, `/v1/transfers` e `/v1/session`. Header assente o `0`: otto ore fisse. La scadenza deve essere ancora valida prima del rinnovo.

`GET /v1/session` restituisce `{remember, expires_at}` per il cookie corrente, oppure `null` per un accesso solo Bearer. `PATCH /v1/session` accetta JSON `{remember: true|false}` e richiede cookie valido e Origin esatto: consente di cambiare modalità senza reinserire la credenziale, solo per il browser corrente. Disattivare l’opzione imposta la scadenza alle successive otto ore.

`GET /v1/identities`: admin/uploader vedono ID, nomi, ruoli e disponibilità avvisi; recipient vede solo se stesso. Nessun hash token o configurazione ntfy viene restituito.

## Impostazioni

`GET /v1/policy`: pubblico, restituisce limite file e massimi TTL/download. `GET /v1/settings`: solo admin, impostazioni più spazio usato/prenotato. `PATCH /v1/settings`: solo admin, corpo JSON completo con questi campi:

| Campo | Default | Intervallo |
|---|---:|---|
| maxFileBytes | 104857600 | 1 .. 2147479552 |
| maxBytes | 1073741824 | 1 .. 10 TiB; almeno maxFileBytes |
| maxTransfers | 1000 | 1 .. 10000 |
| maxTTL | 86400 | 1 .. 2592000 secondi |
| maxDownloads | 20 | 1 .. 1000 |
| auditDays | 30 | 1 .. 365 |
| allowRetention | false | boolean; omissione nelle modifiche conserva il valore corrente |

Le impostazioni salvate prevalgono sui valori iniziali d’ambiente. Cambi di limite riguardano nuove ammissioni; upload già accettati e file esistenti mantengono i loro limiti. Non inviare nomi file in chiaro per renderli ricercabili sul server: la ricerca dei nomi avviene dopo la decifratura nel browser.

## Dispositivi

`GET /v1/devices`: dispositivi del proprio utente. `POST /v1/devices`: JSON `{name, public_key}` con JWK RSA pubblico 2048 bit, esponente AQAB, RSA-OAEP/SHA-256. Il server assegna id e user_id autenticato. Massimo quattro browser per utente. `DELETE /v1/devices/{id}`: proprietario o admin.

`GET /v1/recipient-devices/{recipient_id}`: admin/uploader possono leggere i dispositivi destinatari; un recipient può leggere soltanto `/v1/recipient-devices/{proprio_id}`. Restituisce le chiavi pubbliche dei propri browser e di quelli del destinatario autorizzato. Il client cifra una busta per ciascuno. Il server non riceve chiavi private; non verificare l’identità del destinatario tramite un nome visualizzato arbitrario, usare l’ID configurato.

## Upload

`POST /v1/transfers`: admin/uploader, oppure recipient solo con `X-Recipient-Id` uguale alla propria identità e `X-Require-Recipient: 1`. Un recipient non può inviare ad altri né creare link anonimi. Body `application/octet-stream` con `Content-Length` esatto: massimo impostazione file + 4 KiB. Il server memorizza byte opachi, non prova che un client personalizzato abbia cifrato.

Header:

- `X-Download-Token-SHA256`: SHA-256 hex lowercase della stringa base64url del token casuale di download da 32 byte.
- `X-TTL-Seconds`, `X-Max-Downloads`: opzionali; default min(3600, massimo TTL) e min(3, massimo tentativi).
- `X-Recipient-Id`: identità destinataria facoltativa.
- `X-Require-Recipient: 1`: obbliga identità destinataria oltre alla capability; richiede recipient.
- `X-Notify: 1`: avviso esplicito, richiede recipient con Web Push attivo oppure ntfy configurato.
- `X-Sender-Device-Ids`: opzionale, massimo quattro ID di browser del mittente, separati da virgole, senza duplicati. ID estranei rifiutati. Esclude solo le relative sottoscrizioni Web Push; non modifica destinatario o buste di chiavi.
- `X-File-Metadata`: base64url del JSON `{details, envelopes}`. `details` è ciphertext AES-GCM dei metadati. `envelopes` contiene al massimo otto `{device_id, box}` per dispositivi dell’uploader/destinatario. Campi errati o dispositivi estranei rifiutati. Header totali limitati a 32 KiB.

201 restituisce id, dimensione cifrata, scadenza, conteggio, mittente, destinatario, modalità accesso e stato notifica. Le buste nella risposta sono filtrate per l’identità corrente. Il client costruisce `ORIGIN/d/ID#DOWNLOAD_TOKEN.AES_KEY` localmente. Nessun retry implicito; un timeout dopo commit è ambiguo. Un errore di notifica non annulla un upload riuscito.

## Elenco, audit e revoca

`GET /v1/transfers`: file disponibili visibili all’identità. Admin vede metadati di tutti; uploader propri file; recipient file assegnati. Buste solo per browser dell’identità corrente. Nome e summary restano ciphertext nell’API.

`GET /v1/transfers/{id}`: metadati del file visibile. `DELETE`: admin o proprietario dell’upload, incluso un recipient per i propri invii personali. Nessun file caricato da altri è revocabile da un recipient.

`GET /v1/events`: ultimi 500 eventi visibili, dal più recente. Stato memorizzato in `control.json`, massimo 2.000 eventi e TTL configurato. Eventi: uploaded, download_started, download_transferred, download_interrupted, revoked, expired, exhausted, settings_changed, notification_accepted, notification_failed. Actor nullo indica sistema o link anonimo secondo il tipo. Nessuna garanzia di audit immutabile. I file rimossi restano rappresentati dai loro eventi fino alla retention.

## Ricezione e preview

`POST /v1/transfers/{id}/preview` e `POST /v1/transfers/{id}/download`: Authorization Bearer è **il token di download**, non quello d’identità. Identità aggiuntiva tramite cookie dashboard oppure `X-Identity-Token`. Se il file richiede un destinatario, deve corrispondere esattamente all’ID assegnato.

Preview restituisce bytes, details cifrati e require_recipient, senza consumare tentativi. Download incrementa e persiste il contatore prima di inviare il corpo. Unknown/expired/exhausted/wrong token => 404; identità destinataria mancante/errata => 403. Nessun GET/range/resume. Il nome della risposta ciphertext è fisso `encrypted.bin`.

L’esito `download_transferred` indica che lo stream server è terminato: non è una prova di salvataggio o lettura. Disconnessioni contano. L’ultimo tentativo elimina blob/metadati, ma non il registro. Revoca/scadenza non ritirano stream già aperti.

## Formati crittografici

**File RD01:** magic ASCII `RD01` (4 byte), IV (12), ciphertext variabile, tag GCM (16). AES-256-GCM, chiave casuale per file, AAD UTF-8 `RelayDrop/v1`. Plaintext: lunghezza uint32 big-endian dei metadati JSON, metadati `{name,size}`, poi byte del file. Il nome non è un percorso. Il ricevitore verifica tag, lunghezze e size prima di offrire il salvataggio.

**Details:** base64url di `IV12 || ciphertext || tag16`, stessa chiave file, IV nuova e AAD `RelayDrop/details/v1`. Plaintext JSON `{name, summary}`; summary può essere null o `{text, source, model?, generated_at?, reviewed?}`. Massimo plaintext 11.000 byte, summary 4.000 caratteri. Nome e riepilogo si decifrano nella dashboard senza scaricare il file.

**Busta browser:** RSA-OAEP 2048 con SHA-256, ciphertext base64url di 256 byte (342 caratteri). Plaintext UTF-8 `TOKEN43.KEY43`. Ogni browser genera e conserva la chiave privata in IndexedDB. La chiave pubblica distribuita dal relay è parte del confine di fiducia; nessun pinning/fingerprint indipendente.

## Errori

JSON `{error: codice}` se ancora possibile rispondere. 400 input; 401 autenticazione; 403 autorizzazione/origine; 404 indisponibile; 405 metodo; 409 limite dispositivi; 411 lunghezza; 413 dimensione; 415 MIME; 429 rate limit (`Retry-After:60`); 503 capacità; 507 quota; 500 errore interno. Stream interrotti possono terminare senza corpo JSON.

`GET /healthz` controlla il processo HTTP, non lo spazio o la correttezza dei backup. Rate limiter globale incluse pagine, asset e health check.

## Web Push

`GET /v1/push/config`: autenticato, restituisce `enabled`, `public_key` VAPID e `devices` (ID dei propri dispositivi con avvisi attivi). Nessun endpoint o chiave privata.

`POST /v1/push/subscriptions`: autenticato, JSON `{device_id, subscription: {endpoint, keys: {p256dh, auth}}}`; device deve appartenere all’utente corrente. Una sottoscrizione per dispositivo, endpoint non condivisibile tra dispositivi/utenti; massimo quattro browser. Corpo massimo 8 KiB. Risposta 201 `{device_id, enabled:true}`. Configurazione server assente: 503. Endpoint/chiavi non validi: 400; device estraneo: 403; endpoint già assegnato: 409.

`DELETE /v1/push/subscriptions/{device_id}`: disattiva solo una propria sottoscrizione, senza rimuovere la chiave del browser. La rimozione del dispositivo elimina anche la sottoscrizione. Autenticazione cookie richiede Origin corretto.

Asset pubblici: `/v1/push/manifest.webmanifest`, `/v1/push/sw.js`, `/v1/push/client.js`, `/v1/push/icon-192.png`, `/v1/push/icon-512.png`. Lo script del service worker dichiara `Service-Worker-Allowed: /`.

Le risposte trasferimento includono `notification_deliveries` (null o conteggi `accepted`, `failed`, `expired`). I provider 404/410 sono rimossi. `notification:accepted` indica almeno un’accettazione; può esserci consegna parziale e non prova la ricezione.

## Browser 0.4

`/v1/browser/files.js` e `/v1/browser/decrypt.js` sono moduli pubblici per l’invio Web Crypto e il download diretto. Nessun nuovo endpoint può leggere plaintext. Il browser usa il protocollo RD01, metadati AES-GCM e buste RSA-OAEP già usati dalla CLI. Il suo upload è limitato a 100 MiB e alla policy corrente, scade entro 24 ore e permette fino a 20 download, sempre entro la policy. L’avviso è una casella facoltativa, non preselezionata.

Gli upload espongono `sender_device_ids` come metadato operativo. `notification: skipped` indica che non restava un altro dispositivo da avvisare, oppure che il fallback ntfy non permette di escludere il mittente. `notification_deliveries.excluded`, quando presente, conta le sottoscrizioni omesse. Le chiamate CLI senza header mittente continuano ad avvisare tutte le sottoscrizioni del destinatario.


## Conservazione 0.6

`GET /v1/policy` include `allowRetention`. I client precedenti che non inviano nuove opzioni mantengono TTL/tentativi precedenti. Nuovi header di upload, solo con `allowRetention: true`:

- `X-Keep: 1`: `expires_at: null` e `max_downloads: null`, conservazione fino alla revoca manuale.
- `X-Expires-At`: data UTC ISO (`YYYY-MM-DDTHH:mm:ssZ`, millisecondi facoltativi di tre cifre), futura ed entro `now + maxTTL`; `max_downloads: null`.

I due header sono mutuamente esclusivi e non si combinano con `X-TTL-Seconds`/`X-Max-Downloads` (400). Quote e rate limit restano validi. Non inviare stringhe `"null"`, zero o date locali senza timezone. Disabilitazione policy: 403. Una data che passa durante l’upload causa rifiuto e cleanup del parziale.

`PATCH /v1/transfers/{id}` accetta esclusivamente `{expires_at: ISO_UTC | null}`, solo proprietario dell’upload/admin e file ancora disponibile. Mantiene `downloads`, imposta `max_downloads: null`, persiste e registra `retention_changed` con vecchia/nuova scadenza e limite. Controlla di nuovo disponibilità e record corrente dopo la lettura del corpo: niente resurrezione o perdita di contatori concorrenti. Non estende i diritti di un semplice destinatario. Disabilitare `allowRetention` non modifica i file esistenti.

## Sincronizzazione di chiavi per nuovi browser 0.6

`POST /v1/transfers/{id}/envelopes`: autenticazione identità (cookie/Origin o Bearer) più `X-Download-Token` con capability del file. Body `{envelopes: [{device_id, box}, ...]}`, da uno a quattro elementi, 8 KiB massimi. Ogni destinatario deve essere un browser attualmente registrato della stessa identità chiamante; niente duplicati. `box` è RSA-OAEP del medesimo `TOKEN43.KEY43`, come negli upload.

Il chiamante deve essere mittente o destinatario nominativo del file e possedere la capability: il ruolo admin da solo non basta. L’endpoint aggiunge solo le buste mancanti, non sostituisce quelle già presenti; rimuove buste per browser non più registrati e conserva al massimo otto buste attive. Risposta `{added: N}`. Gli inserimenti sono persistiti e registrati con `device_keys_shared`. Nessun cambiamento a scadenza, contenuto, download o notifiche; retry senza nuovi elementi restituisce zero. File indisponibile: 404; identità/capability/target non consentito: 403. Non registrare `X-Download-Token`.

La dashboard prova le proprie chiavi locali, poi cifra buste mancanti per nuovi browser della stessa identità, al massimo quattro file per refresh. La pagina sorgente deve essere visibile e deve già riuscire a leggere il file. Il relay non decifra e non può recuperare chiavi perse ovunque. Il modello continua a fidarsi della directory di chiavi pubbliche servita dal relay.
