# Primi passi: prova locale

Questa prova funziona su Mac/Linux con Node 22+ e npm. Node 24 è la versione usata per il collaudo; scegli una [release LTS supportata](https://nodejs.org/en/about/previous-releases). La cartella della repository deve essere scrivibile. Docker e un modello AI non servono.

Per scaricare il progetto:

```sh
git clone https://github.com/alessandroserpe/relaydrop.git
cd relaydrop
```

Se la repository è privata, serve un account GitHub autorizzato. In alternativa scarica ed estrai il sorgente dalla pagina della repository.

HTTP su `127.0.0.1` serve solo per la prova sullo stesso computer. Per l’iPhone o per reti diverse passa alla [guida HTTPS](DEPLOYMENT.md).

## 1. Dipendenze e tre credenziali

Dalla cartella della repository, una sola volta:

```sh
npm ci --ignore-scripts
node src/cli.mjs init --token-file .secrets/admin-token
node src/cli.mjs identity-add me --name 'Personale' --role recipient \
  --registry-file .secrets/identities.json --token-file .secrets/me-token
node src/cli.mjs identity-add agent --name 'Agente' --role uploader \
  --registry-file .secrets/identities.json --token-file .secrets/agent-token
```

I comandi creano file privati e non stampano le credenziali. Se esistono già, non rigenerarle per riavviare il servizio. `.secrets/` è esclusa da Git; non spostare i file in cartelle pubbliche.

### Conserva subito l’accesso amministrativo

`init` indica il percorso completo del file creato e come usarlo. Apri `.secrets/admin-token` con il tuo editor locale e salva il contenuto nel gestore di password come **RelayDrop — amministratore**, insieme all’indirizzo del servizio. Conserva separatamente `.secrets/me-token`, con il nome **RelayDrop — personale**; la credenziale agente va solo sulla macchina autorizzata.

Per copiare l’amministratore negli appunti su Mac, dalla cartella del progetto:

```sh
pbcopy < .secrets/admin-token
```

In seguito puoi recuperare la stessa credenziale dal gestore di password o da quel file: non serve generarla di nuovo. In una finestra privata apri `/dashboard`, incollala in **Credenziale di accesso** e premi **Accedi**. Vedrai il titolo **Amministrazione** e la scheda **Impostazioni**. La finestra privata mantiene separata la tua sessione personale.

Il file si trova sulla macchina dove hai eseguito `init`. Se hai scelto un altro percorso, usa quello indicato da `--token-file`, che deve corrispondere a `RELAYDROP_TOKEN_FILE` del server. Le installazioni precedenti possono chiamarlo `upload-token`: resta valido, non rinominarlo senza aggiornare anche la configurazione.

## 2. Avvio

Nello stesso terminale:

```sh
export RELAYDROP_TOKEN_FILE="$PWD/.secrets/admin-token"
export RELAYDROP_IDENTITIES_FILE="$PWD/.secrets/identities.json"
export RELAYDROP_DATA_DIR="$PWD/data"
export RELAYDROP_URL=http://127.0.0.1:8787
export RELAYDROP_ALLOW_HTTP_LOCALHOST=1
npm start
```

Il terminale rimane occupato dal server. Per fermarlo usa Ctrl+C. Le variabili vanno impostate di nuovo se apri un terminale diverso; il programma non carica automaticamente file `.env`.

## 3. Registra il browser personale

Apri `http://127.0.0.1:8787/dashboard`. Usa come «Credenziale di accesso» il contenuto di `.secrets/me-token`, ottenuto localmente con il tuo editor o gestore di password. In **Dispositivi e avvisi**, assegna un nome al browser e registralo.

Per i limiti globali, apri una sessione separata e accedi con il contenuto di `.secrets/admin-token`: apparirà **Impostazioni**. Non usare l’admin per tutti i dispositivi o per l’agente. [Ruoli e schermate](USER_GUIDE.md).

## 4. Invia un file

Nella dashboard usa **Scegli file**: la selezione avvia l’invio. Oppure, in un secondo terminale aperto nella repository:

```sh
printf 'Una prova di RelayDrop.\n' > /tmp/relaydrop-demo.txt
node src/cli.mjs send /tmp/relaydrop-demo.txt \
  --server http://127.0.0.1:8787 --allow-http-localhost \
  --token-file "$PWD/.secrets/agent-token" \
  --to me --require-recipient --ttl 86400 --downloads 20
```

La CLI stampa JSON con un link privato: non copiarlo in issue, screenshot o log pubblici. Il file appare nella casella personale; premi **Scarica**. Il riepilogo non è necessario.

Gli avvisi non sono ancora configurati. Per usarli: dominio HTTPS, coppia VAPID sul server e consenso sul dispositivo. La guida di [installazione](DEPLOYMENT.md) include tutti questi passaggi.

## Ripartire

Riavvia con le stesse credenziali, dati e origine. Non cancellare il database del browser: contiene le chiavi private. Cambiare host, porta o browser crea un archivio locale diverso. La prova locale non migra automaticamente le chiavi alla futura origine HTTPS: registra i browser sulla nuova istanza prima dei nuovi invii.
