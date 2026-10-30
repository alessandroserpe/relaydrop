# Deployment self-hosted

Guida generica a un’installazione self-hosted. È stata verificata anche una VPS con Nginx/Plesk e Node 24; adattare il proxy già presente, senza installarne un secondo. Servono un host Linux amministrabile, un dominio con DNS verso l’host, Node 22+ LTS supportato (Node 24 verificato), un reverse proxy HTTPS e porte pubbliche 80/443. Il percorso seguente usa Caddy; un proxy già presente può essere mantenuto. Niente port forwarding sul telefono o sul Mac mittente. L’upload può provenire da qualsiasi rete con accesso HTTPS all’host.

## Metodo consigliato: processo locale + Caddy

1. Copiare la repository verificata in `/opt/relaydrop`, leggibile ma non modificabile dall’utente di servizio. Installare una versione LTS di Node dal canale ufficiale e verificare il suo percorso; l’unità d’esempio usa `/usr/bin/node`.
   Su un nuovo host dedicato, dalla copia Git verificata (la destinazione deve essere nuova/vuota):

   ```sh
   sudo install -d -m 755 /opt/relaydrop
   git archive HEAD | sudo tar -x -C /opt/relaydrop
   cd /opt/relaydrop
   sudo npm ci --omit=dev --ignore-scripts
   ```

   Il codice resta di proprietà amministrativa. Verificare `command -v node` e adattare `/usr/bin/node` nei comandi e nell’unità se necessario. Questi comandi presuppongono Node/npm già installati; non sostituiscono le istruzioni ufficiali per la propria distribuzione.
2. Su un host Linux con systemd, crea un utente dedicato se non esiste. Poi prepara la directory privata e genera la credenziale amministrativa una sola volta:

   ```sh
   sudo useradd --system --user-group --home-dir /var/lib/relaydrop --shell /usr/sbin/nologin relaydrop
   sudo install -d -m 700 -o relaydrop -g relaydrop /etc/relaydrop
   sudo -u relaydrop /usr/bin/node /opt/relaydrop/src/cli.mjs init --token-file /etc/relaydrop/admin-token
   ```

   Se l’utente di servizio esiste già, salta `useradd`. Il token bootstrap è **amministrativo**: serve per la scheda Impostazioni. Conservane una copia in un gestore di password; per i dispositivi e gli agenti usa le identità separate del prossimo passaggio.

3. Crea una casella personale, un uploader per l’agente e le chiavi per gli avvisi:

   ```sh
   sudo -u relaydrop /usr/bin/node /opt/relaydrop/src/cli.mjs identity-add me --name Personale --role recipient \
     --registry-file /etc/relaydrop/identities.json --token-file /etc/relaydrop/me-token
   sudo -u relaydrop /usr/bin/node /opt/relaydrop/src/cli.mjs identity-add agent --name Agente --role uploader \
     --registry-file /etc/relaydrop/identities.json --token-file /etc/relaydrop/agent-token
   sudo -u relaydrop /usr/bin/node /opt/relaydrop/scripts/init-web-push.mjs /etc/relaydrop/web-push.json
   ```

   Sono comandi iniziali: non rigenerare token o chiavi VAPID durante gli aggiornamenti. Trasferisci il contenuto di `me-token` sui tuoi dispositivi tramite un gestore di password; copia `agent-token` soltanto sul mittente/agent autorizzato, con permessi 600. Il registro e `web-push.json` restano sul server. Per aggiungere altri utenti, ripeti `identity-add` con ID e percorsi nuovi, poi riavvia il servizio.

   Eseguire `sudo install -m 644 deploy/relaydrop.service /etc/systemd/system/relaydrop.service`. Sostituire il dominio in `RELAYDROP_URL`, verificare il percorso Node. L’unità include `RELAYDROP_WEB_PUSH_FILE`; se non vuoi gli avvisi, rimuovi quella riga. `StateDirectory` crea `/var/lib/relaydrop` con permessi 700.
4. Se non è già presente un proxy, [installare Caddy con le istruzioni ufficiali della distribuzione](https://caddyserver.com/docs/install). Su un host nuovo dedicato copiare `deploy/Caddyfile` in `/etc/caddy/Caddyfile`; se esiste già una configurazione, integrare solo il blocco RelayDrop senza sovrascriverla. Adattare `deploy/Caddyfile` al proprio dominio e alla configurazione Caddy già presente. Verificare con `caddy validate --config /etc/caddy/Caddyfile` prima del reload. Il file usa HTTPS automatico e limita il corpo a 2 GiB. La quota effettiva applicativa è più bassa. [Reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [limite del corpo](https://caddyserver.com/docs/caddyfile/directives/request_body).
5. Avviare:

   ```sh
   sudo systemctl daemon-reload
   sudo systemctl enable --now relaydrop
   sudo systemctl enable --now caddy
   sudo systemctl reload caddy
   ```

6. Il firewall deve esporre 80/443, **non 8787**. Verificare da una rete esterna `https://files.DOMINIO/healthz`. Provare un file fittizio da CLI, aprirlo su un telefono in rete mobile e confrontare il contenuto. Non usare file sensibili per il collaudo.

Caddy termina TLS, il backend ascolta solo su loopback. Non servono `X-Forwarded-*` per l’autorizzazione; l’app ignora questi header. Non attivare caching del relay o logging di credenziali. Eventuali CDN diventano ulteriori intermediari fidati per il codice del ricevitore.

## Dopo HTTPS: telefono e computer

### Dove trovare e conservare l’accesso amministrativo

Il comando `init` mostra il percorso completo, senza stampare il segreto. Con questa guida il file è **`/etc/relaydrop/admin-token` sulla VPS**, non sul telefono. Conservane il contenuto in un gestore di password come **RelayDrop — amministratore**, insieme al dominio; salva la credenziale personale come voce distinta.

Se devi recuperarlo in seguito, collegati alla VPS con il tuo accesso amministrativo e apri quel file con i permessi necessari. Puoi leggerlo nel tuo terminale privato con:

```sh
sudo cat /etc/relaydrop/admin-token
```

Questo comando mostra il segreto nel terminale: copialo nel gestore di password, senza includerlo in screenshot, chat o log condivisi. Apri `/dashboard` in una finestra privata, incolla il contenuto in **Credenziale di accesso** e premi **Accedi**. Vedrai **Amministrazione → Impostazioni**.

Il percorso effettivo è quello impostato in `RELAYDROP_TOKEN_FILE`. Nelle installazioni precedenti può essere `/etc/relaydrop/upload-token`: usa quel file, senza rigenerarlo o rinominarlo. Le nuove istruzioni e l’unità d’esempio usano `admin-token`; per un aggiornamento conserva il percorso già configurato. Il server non mostra la credenziale dalla dashboard. Se perdi sia file sia copia privata, occorre una rotazione amministrativa sul server: `init` non è una procedura di recupero e non sovrascrive file esistenti.

### Accesso personale

Apri `https://files.example.com/dashboard` dal telefono e dal computer usando il tuo dominio reale. Accedi con il contenuto di `me-token` e registra ogni browser prima di inviare file. Sul telefono prova anche dalla rete cellulare.

Per le notifiche iPhone, aggiungi la web app alla Home da Safari, aprila dalla nuova icona e in **Dispositivi e avvisi** premi **Attiva gli avvisi**, poi **Consenti**. La prima installazione può richiedere un nuovo accesso e una registrazione nella web app. Android e desktop usano il permesso notifiche del browser; vanno verificati sul dispositivo effettivo. [Guida utente](USER_GUIDE.md).

Per i limiti, accedi separatamente con il token amministrativo: vedrai **Impostazioni**. Per l’agente, configura la [skill o CLI](AGENT_INTEGRATION.md) con l’origine HTTPS e `agent-token`. `--notify` richiede almeno una sottoscrizione attiva.

## Container opzionale

Docker non è necessario. Questo percorso alternativo richiede Git e Docker sul computer host; **Node/npm sul computer host non servono per il bootstrap o per avviare il servizio**. Il reverse proxy HTTPS deve essere già installato sullo stesso host. Il Dockerfile usa un utente non privilegiato.

Dalla cartella della repository, per una nuova installazione:

```sh
docker build -t relaydrop:local .
sh deploy/bootstrap-container.sh relaydrop:local
```

Il secondo comando usa Node e le dipendenze **dentro l’immagine**. Crea `.secrets/` e `data/` con permessi 700; genera `admin-token`, `me-token`, `agent-token`, `identities.json` e `web-push.json` con permessi 600. Non stampa segreti e rifiuta una configurazione già esistente. Non rieseguirlo durante aggiornamenti o riavvii. Se un bootstrap si interrompe, controlla quali file sono stati creati prima di riprenderlo: non cancellare una configurazione già in uso.

Conserva `admin-token` nel gestore di password; usa `me-token` sui dispositivi e `agent-token` sul mittente autorizzato. Le identità e VAPID sono incluse anche nel comando di avvio:

```sh
docker run --rm --name relaydrop --stop-timeout 20 \
  --user "$(id -u):$(id -g)" \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --memory 256m --pids-limit 128 \
  -p 127.0.0.1:8787:8787 \
  -e RELAYDROP_URL=https://files.example.com \
  -e RELAYDROP_TOKEN_FILE=/run/secrets/admin-token \
  -e RELAYDROP_IDENTITIES_FILE=/run/secrets/identities.json \
  -e RELAYDROP_WEB_PUSH_FILE=/run/secrets/web-push.json \
  -v "$PWD/.secrets:/run/secrets:ro" \
  -v "$PWD/data:/data" \
  relaydrop:local
```

Sostituisci il dominio e configura il proxy come indicato sopra. Apri `/dashboard` con `me-token`, registra il browser e attiva gli avvisi. La coppia VAPID da sola non abilita le notifiche sul telefono: servono registrazione e consenso.

Per fermare: `docker stop --time 20 relaydrop` da un altro terminale. Per ripartire esegui di nuovo **solo il comando di avvio**, usando le stesse directory. I dati e le credenziali restano nei bind mount anche se il container viene rimosso. Non aggiungere `--notify` agli invii finché almeno un dispositivo non ha attivato gli avvisi.

Usare UID/GID del proprietario dei bind mount evita di rendere i segreti leggibili ad altri. L’immagine ascolta su tutte le interfacce dentro il container, ma la pubblicazione è solo su loopback dell’host. Non omettere `127.0.0.1`. Non abilitare restart automatico finché non è stata definita una procedura per il lock dopo crash. Il limite di memoria è un esempio per l’uso personale, non un dimensionamento per qualsiasi carico. Fissare un digest verificato dell’immagine base prima di un rilascio riproducibile.

## Configurazione

| Variabile | Default / uso |
|---|---|
| `RELAYDROP_URL` | obbligatoria; origine HTTPS pubblica |
| `RELAYDROP_TOKEN_FILE` | obbligatoria; file privato |
| `RELAYDROP_WEB_PUSH_FILE` | file JSON privato con coppia VAPID; omesso = avvisi integrati disattivati |
| `RELAYDROP_IDENTITIES_FILE` | file JSON privato con le identità; omissione = solo admin bootstrap |
| `RELAYDROP_MAX_FILE_BYTES` | iniziale `104857600` (100 MiB), prima delle impostazioni persistite |
| `RELAYDROP_DATA_DIR` | `./data` |
| `HOST` | `127.0.0.1` (Dockerfile: `0.0.0.0`) |
| `PORT` | `8787` |
| `RELAYDROP_MAX_STORAGE_BYTES` | `1073741824` |
| `RELAYDROP_MAX_TRANSFERS` | `1000` |
| `RELAYDROP_REQUESTS_PER_MINUTE` | `120` per identità, file con link valido o peer anonimo; asset/health separati |
| `RELAYDROP_EMERGENCY_REQUESTS_PER_MINUTE` | `6000` richieste ammesse per classe; budget separati fra autenticati, link validi, anonimi e pagine/health |
| `RELAYDROP_ALLOW_HTTP_LOCALHOST` | disabilitata; `1` solo per sviluppo HTTP locale |

Il limite dei file, la quota, la durata e il numero di tentativi sono modificabili nella dashboard. I valori persistiti in control.json prevalgono sulle variabili di avvio. Concorrenza e tetto tecnico di circa 2 GiB restano vincoli di questa versione. Misurare la memoria sui telefoni prima di alzare i limiti. Il client richiede separatamente `--allow-http-localhost` per HTTP; non supporta HTTP remoto o bypass TLS.

## Manutenzione e recupero

- File e metadati scaduti rimossi ogni minuto e all’avvio. Non pianificare cancellazioni esterne durante l’esecuzione. Il disco può trattenere inode aperti da download ancora attivi: mantenere un margine proporzionato a fino a otto file della dimensione massima configurata, oltre alla quota.
- Stop normale con SIGTERM: attesa delle richieste, chiusura forzata dopo 10 secondi, rimozione lock. Dopo SIGKILL/crash può restare `.lock` e il servizio rifiuta il riavvio. Verificare che non ci siano writer prima di rimuovere **solo** `/var/lib/relaydrop/.lock`; poi riavviare. Non automatizzare un `rm .lock` nell’unità systemd.
- Contenuti `.part`, `.json.tmp` e blob orfani vengono rimossi al riavvio. Metadati invalidi fermano l’avvio: ispezionare con il servizio fermo, senza esporne il contenuto nei log.
- Non salvare backup dei trasferimenti effimeri. Proteggere separatamente configurazione e credenziali. Uno storage ripristinato può reintrodurre contatori obsoleti.
- Ruotare il token con un nuovo file e riavvio. I link esistenti hanno capability separate e non vengono revocati dalla rotazione.
- Mantenere l’orologio sincronizzato. Monitorare spazio disponibile, log generici di errore e health check; i controlli di stato condividono il budget delle pagine pubbliche, separato dalle API autenticate. Dietro il proxy, gli anonimi condividono il suo peer TCP; gli header inoltrati dal client non modificano i limiti.

Prima di un’esposizione ampia: audit indipendente, protezione DDoS, token/quote per principal, test fisici iOS/Android e misure di carico. Questa versione assume un piccolo gruppo di uploader fidati.

## Upgrade da 0.1

Conservare il token bootstrap e i dati esistenti; fermare il servizio prima di cambiare codice. I record precedenti sono attribuiti all’admin e non hanno buste browser o riepiloghi: usare il link originale o un nuovo invio. `control.json` verrà creato alla prima operazione di controllo/attività. Non effettuare downgrade in-place dopo aver usato le funzioni 0.2.

La dashboard è `/dashboard`. Registrare i browser prima dei nuovi invii nominativi. Il registro identità è letto all’avvio: riavviare dopo aggiunte, revoche o modifiche ntfy. Il codice del relay non contiene né avvia Ollama; il motore AI sta sul mittente. [Guida AI/avvisi](LOCAL_AI_AND_NOTIFICATIONS.md).

Il percorso container aggiornato monta registro identità e VAPID in sola lettura. Per configurazioni precedenti solo-admin, creare separatamente le identità mancanti e aggiungere i relativi mount/variabili, senza rigenerare la credenziale amministrativa. Eventuali file ntfy privati referenziati dal registro richiedono mount dedicati.

## Avvisi integrati e upgrade 0.3

Generare una sola volta la coppia VAPID con `node scripts/init-web-push.mjs /percorso/privato/web-push.json` e impostare `RELAYDROP_WEB_PUSH_FILE`. Mantenere il file, con permessi 600, tra riavvii e aggiornamenti: cambiarlo richiede di riattivare gli avvisi sui browser. Il file non contiene chiavi di decifratura dei documenti.

Il proxy deve inoltrare anche `/v1/push/` e preservare `Service-Worker-Allowed: /` sullo script `/v1/push/sw.js`. Nessuna cache di documenti, chiavi o API nel service worker. Il manifest e le icone sono sotto lo stesso prefisso. In uscita servono HTTPS verso i servizi push Apple, Google e Mozilla; le sottoscrizioni utente sono limitate a questi host. Non servono porte pubbliche aggiuntive.

Fermare il relay prima di sostituire il codice; conservare dati, registro identità e credenziali. Installare le dipendenze dal lockfile prima di riavviare. Dalla versione 0.4.1 le sessioni restano valide al riavvio, secondo la durata scelta sul dispositivo (otto ore o, dalla 0.4.2, circa 90 giorni rinnovabili). Il primo aggiornamento da versioni precedenti richiede ancora un accesso, perché quelle sessioni erano solo in memoria. Le chiavi dei browser restano locali; Safari e la web app sulla Home possono avere archivi distinti. Il pulsante «Attiva gli avvisi» registra la chiave del browser se manca.


## Aggiornamento 0.6: conservazione e nuovi browser

Fermare il servizio, sostituire il codice e riavviare conservando configurazione e dati. I record precedenti mantengono scadenza e contatori. Per abilitare le nuove scelte, accedere come amministratore e attivare **Consenti file fino a una data scelta o senza scadenza**. La durata massima limita le date selezionabili (fino al tetto tecnico di 30 giorni); i file senza scadenza ne sono esplicitamente esenti. I limiti di spazio e numero restano validi.

I file conservati non sono backup: definire separatamente una strategia di copia/recupero, comprese le chiavi, se servono garanzie di conservazione. I backup di stato possono ripristinare sessioni o contatori precedenti. Non effettuare downgrade a 0.5 dopo aver creato file con limiti nulli.

Per un nuovo browser, aprire la casella su un browser già in grado di leggere i file: con la pagina visibile sincronizza automaticamente le buste cifrate, quattro file per aggiornamento. Aggiornare entrambe le pagine alla nuova versione. Nessuna nuova porta, credenziale o dipendenza.
