# Agente locale e avvisi

## Confine dei contenuti

Il file viene letto da un agente locale autorizzato. Il server conserva file, nomi e riepiloghi cifrati. Conserva in chiaro i metadati operativi necessari: identità, ID, dimensione cifrata, scadenza, contatori, eventi e chiavi pubbliche. Non viene attribuita al server la capacità di leggere o riassumere i documenti.

Il componente AI è un'operazione esplicita del mittente, **non un demone che sorveglia tutte le cartelle**. Il comando non cerca automaticamente file personali e non invia documenti a provider cloud. Codex può orchestrarne l’esecuzione oppure preparare direttamente un riepilogo da allegare.

## Modello locale

Installare e avviare Ollama secondo la sua documentazione, scegliere un modello locale già scaricato. Non sono installati o scaricati modelli automaticamente. Configurare eventualmente `RELAYDROP_OLLAMA_URL=http://127.0.0.1:11434`; sono ammessi solo indirizzi di loopback HTTP, senza redirect o credenziali. Nomi di modello contenenti `cloud` sono rifiutati. L’operatore deve comunque assicurarsi che il motore locale non sia un proxy verso servizi esterni.

```sh
node src/cli.mjs summarize /percorso/documento.md \
  --model NOME_MODELLO_LOCALE --output /percorso/privato/riepilogo.json
node src/cli.mjs send /percorso/documento.md --to me \
  --require-recipient --summary-file /percorso/privato/riepilogo.json
```

Oppure `send … --summarize --model …` genera e cifra il riepilogo nell’unica operazione di invio. Il riepilogo locale salvato separatamente è plaintext con permessi 600: proteggerlo come il documento. `--summary-file` accetta testo o il JSON del comando `summarize`; massimo 4.000 caratteri. I contenuti del riepilogo e il nome sono cifrati con AES-GCM e una IV distinta dal file.

Formati testo: TXT, MD, CSV, JSON, LOG, UTF-8, fino a 1 MiB. PDF testuali fino a 10 MiB: richiedono Poppler `pdftotext` sul mittente, eseguito senza shell con timeout e limite di output. Il testo estratto deve rientrare in 24.000 caratteri. Nessun OCR per scansioni, niente DOCX o archivi. I casi non supportati falliscono esplicitamente; non viene riassunta solo una porzione senza avvisare.

Il motore riceve il documento come dati non fidati e non dispone di strumenti. Il prompt chiede temi, decisioni e scadenze esplicite; l’output è sempre marcato come da verificare. Questa separazione riduce gli effetti delle istruzioni malevole nei documenti, non garantisce correttezza del riepilogo. La dashboard mostra i riepiloghi accessibili nella scheda **Riepiloghi**, senza inviarli altrove.

API ufficiale usata: [Ollama generate](https://docs.ollama.com/api/generate), `stream:false`. Il collegamento è testato con un motore simulato. Il motore Ollama reale non è ancora stato collaudato end-to-end.

## Avvisi integrati: Web Push

RelayDrop supporta Web Push direttamente. Non serve ntfy né un account Apple Developer. Su iPhone occorrono iOS 16.4 o successivo, l’app web aggiunta alla Home e il consenso dato premendo «Attiva gli avvisi». [Requisiti WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

Configurazione server:

```sh
npm ci --ignore-scripts
node scripts/init-web-push.mjs /percorso/privato/web-push.json
export RELAYDROP_WEB_PUSH_FILE=/percorso/privato/web-push.json
```

Il dominio `RELAYDROP_URL` deve essere HTTPS. Il file VAPID è privato, va conservato tra gli upgrade e non va pubblicato. Le chiavi VAPID autorizzano il mittente degli avvisi; non decifrano i file.

Sul telefono: aprire RelayDrop in Safari, Condividi → Aggiungi alla schermata Home, aprire la nuova icona, accedere e premere «Attiva gli avvisi» in «Dispositivi e avvisi». Il pulsante richiede il permesso direttamente dal gesto dell’utente e registra questo browser, se necessario. Safari e la web app sulla Home possono avere dati separati: registrare la web app prima di inviare file da aprire al suo interno.

Ogni sottoscrizione è associata a un dispositivo posseduto dall’identità autenticata, massimo quattro per utente. Endpoint e segreto push restano nel `control.json` privato e non sono restituiti dalle API di elenco. Rimuovere il browser elimina anche la sua sottoscrizione. Logout non disattiva gli avvisi: usare il pulsante apposito prima di cedere un dispositivo.

`--notify` usa Web Push se il destinatario ha almeno una sottoscrizione attiva. Il relay invia esclusivamente «Un nuovo file è disponibile nella tua casella privata.»; il clic apre la dashboard. La consegna passa dal servizio del browser (Apple su iPhone), senza un nostro account presso un fornitore di notifiche. I provider possono osservare tempi e destinatario.

Gli endpoint sono verificati prima della persistenza: solo HTTPS sui servizi Apple, Google FCM e Mozilla, senza porte alternative, query o redirect. Questo evita che l’API diventi un proxy verso indirizzi interni. Browser con altri provider non sono supportati da questa versione. Le risposte 404/410 eliminano solo la sottoscrizione scaduta, senza cancellare un rinnovo effettuato mentre era in corso l’invio.

TTL avviso: 5 minuti; più avvisi possono essere raggruppati dal provider. Nessuna coda durevole o retry automatico. `notification_deliveries` espone conteggi accepted/failed/expired, mai gli endpoint. `accepted` significa che almeno un provider ha accettato l’avviso, non che sia arrivato sul telefono. Un fallimento non annulla il file caricato.

Il service worker non intercetta le richieste e non mantiene una cache offline di pagine, chiavi o file. Mostra sempre un avviso visibile e apre soltanto la dashboard della stessa origine.

## Adattatore ntfy opzionale

L’adattatore ntfy della versione precedente resta disponibile per installazioni che lo preferiscono. Viene usato solo quando non ci sono sottoscrizioni Web Push del destinatario e l’operatore ha configurato `notify` nel registro.

L’operatore aggiunge al record del destinatario, nel registro privato delle identità, un oggetto:

```json
{
  "notify": {
    "url": "https://notify.example.com/TOPIC_PRIVATO",
    "token_file": "/percorso/privato/ntfy-token"
  }
}
```

È un frammento illustrativo da aggiungere ai campi esistenti, non un record completo. L'URL deve essere HTTPS, senza query, credenziali o redirect, con un singolo segmento topic. Il file del token ntfy è letto solo al momento dell'invio e deve avere permessi 600/400. Non pubblicare il topic o il token. Preferire un topic protetto da autenticazione e autorizzazioni di pubblicazione/sottoscrizione, non soltanto un nome difficile da indovinare.

Il registro è caricato all’avvio: riavviare il relay dopo la modifica. Configurare sul telefono l’accesso al topic e autorizzare le notifiche. Per ntfy self-hosted su iOS, la consegna istantanea richiede un upstream collegato ad APNS/Firebase; è una dipendenza da documentare e accettare nell'installazione. [Configurazione ntfy](https://docs.ntfy.sh/config/#ios-instant-notifications), [app mobili](https://docs.ntfy.sh/subscribe/phone/).

Solo dopo la configurazione:

```sh
node src/cli.mjs send /percorso/file.pdf --to me --require-recipient --notify
```

Messaggio: “Un nuovo file è disponibile nella tua casella privata.” Il clic apre `/dashboard`; la sessione potrebbe richiedere nuovamente l’accesso. Nessun ID del file, titolo, riepilogo, chiave o link con frammento nel messaggio. Il dispositivo deve essere stato registrato prima dell’invio per aprire il file dalla casella.

Il relay registra `accepted` o `failed`. `accepted` significa risposta positiva dal provider, non arrivo sull’iPhone. Il trasferimento rimane disponibile anche se l’avviso fallisce. Non ci sono retry automatici, deduplicazione o coda durevole; non ritentare l’upload per un solo avviso fallito. Il provider non viene contattato se manca `--notify`.

[Protocollo ntfy di pubblicazione](https://docs.ntfy.sh/publish/). I test automatici usano un trasporto simulato; la conferma di ricezione su un telefono richiede una prova reale.
