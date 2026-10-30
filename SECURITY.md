# Sicurezza — versione 0.6

MVP sperimentale, non auditato indipendentemente. Un solo processo su filesystem locale fidato. Le nuove funzioni non trasformano automaticamente il progetto in un servizio pubblico multiutente pronto per produzione.

## Dati e chiavi

- File AES-256-GCM (RD01). I dettagli — nome e riepilogo — sono un secondo messaggio AES-GCM con IV casuale distinta e AAD dedicata. Il server conserva soltanto ciphertext per questi contenuti.
- Ogni browser genera RSA-OAEP 2048/SHA-256. La chiave privata non esportabile viene salvata in IndexedDB; al server arriva solo la chiave pubblica. La CLI incapsula token del download e chiave AES per i browser già registrati del mittente e del destinatario (massimo quattro ciascuno).
- La protezione del contenuto non nasconde identità, ID, dimensioni, tempi e contatori. Il registro contiene questi metadati; per default resta 30 giorni, massimo 2.000 eventi. Non contiene nomi file, riepiloghi, token, IP o link.
- **Fiducia nel relay attivo:** il server distribuisce JavaScript e la directory delle chiavi pubbliche. Un server malevolo può sostituire codice o chiavi e compromettere futuri invii. Non esistono pinning delle chiavi, verifica indipendente dei fingerprint o key transparency. Non dichiarare protezione da un relay attivamente compromesso.
- Un’estensione o XSS sul browser può usare le chiavi, anche se non esportabili. IndexedDB non è un hardware enclave. Nessuno script esterno/analytics/CDN è incluso; CSP restringe le origini.
- Cancellare i dati del browser elimina le chiavi. Logout termina la sessione ma non elimina le chiavi locali. Rimuovere un dispositivo blocca nuove buste per quella chiave; non ritira plaintext o chiavi già ottenuti. Non è implementato backup/esportazione delle chiavi: conservare il link originale o chiedere un nuovo invio.

## Identità e autorizzazione

Registro privato su file, letto all’avvio; token casuali da 32 byte con hash SHA-256 nei record. Un token bootstrap amministra l’istanza. Ruoli: admin (gestione globale), uploader (propri file), recipient (file destinati a lui). I token identificano credenziali, non una persona fisica; condivisione/furto di token compromette l’attribuzione. Nessun MFA o OIDC in questa versione.

La dashboard scambia il token per una sessione di otto ore oppure, su scelta del dispositivo, una sessione rinnovabile di circa 90 giorni di inattività, cookie HttpOnly/SameSite=Strict e Secure su HTTPS. Le mutazioni autenticate con cookie richiedono Origin uguale all’origine configurata; niente CORS. Le sessioni sopravvivono al riavvio entro la scadenza originale: il registro privato conserva solo hash dei cookie casuali. Logout, scadenza e rotazione della credenziale invalidano la sessione. Il token non viene memorizzato in localStorage. Le credenziali da file devono avere permessi 600/400.

La modalità `--require-recipient` impone identità del destinatario oltre alla capability del link. In modalità link semplice la capability basta; la cronologia indica “Link anonimo” in assenza di una sessione valida. Non si inferisce il nome da IP o User-Agent. Gli amministratori possono vedere i metadati globali e revocare, ma non ricevono buste di chiavi di altri utenti solo perché amministratori.

## Scadenza, revoca e audit

Contatori persistiti prima dello stream. Interruzioni e decifratura fallita consumano un tentativo; preview non lo consuma. Un file già consegnato non è revocabile. Revoca/scadenza non interrompono gli stream già aperti. `download_transferred` è il completamento lato server, non una ricevuta di salvataggio/lettura. Il registro è operativo, modificabile dall’amministratore del filesystem: non è una prova legale o un audit immutabile. In caso di crash durante lo stream può restare solo l’evento di avvio, senza esito conclusivo.

Il limite plaintext esatto è applicato dal client ufficiale. Il server, che non decifra, ammette ciphertext fino a `maxFileBytes + 4096`; un client API può inviare qualsiasi blob opaco entro quel limite. Le quote non garantiscono spazio fisico residuo. Mantenere margine per metadati, upload e fino a otto blob cancellati ma ancora aperti dagli stream: dimensionarlo in base al limite configurato, non fissarlo a 512 MiB per qualsiasi installazione.

## AI e notifiche

Ollama può ricevere solo su loopback, senza redirect; nomi di modello cloud espliciti sono rifiutati. L’operatore deve verificare che il motore non inoltri i dati altrove. Estrattore PDF locale opzionale con tempo/output limitati; nessun OCR. Il documento è dati non fidati e il motore non riceve strumenti. Un prompt non garantisce resistenza a ogni manipolazione o correttezza delle sintesi: sono sempre da verificare.

ntfy è disattivato per default e richiede `--notify` più destinazione in un registro privato controllato dall’operatore. Per ntfy la destinazione è scelta soltanto dall’operatore; niente redirect. Solo messaggio generico e URL della casella, mai chiavi o contenuti. Il provider resta in grado di osservare tempi e destinazione delle notifiche. Proteggere il topic con ACL/autenticazione. La consegna iOS self-hosted può dipendere da un upstream APNS: leggere la guida dedicata.

## Operazioni

Usare Node LTS supportato, TLS valido, backend su loopback/rete privata, utente non privilegiato, dati 700. Non esporre 8787. Non registrare Authorization, corpi o URL completi. Escludere i trasferimenti effimeri dai backup; unlink non è secure erase e backup vecchi possono ripristinare contatori obsoleti. I file temporanei della CLI sono cifrati e normalmente rimossi; SIGKILL può lasciarli nella directory temporanea privata.

Lock esclusivo `.lock`: dopo crash, verificare che nessun processo stia usando la directory prima di rimuovere il solo lock. Non automatizzare la rimozione. Orologio sincronizzato e filesystem con fsync/rename affidabili sono assunzioni. Il rate limiter resta globale, 120 richieste/minuto di default, incluse dashboard e health check: non protegge da DDoS e può essere esaurito da terzi. Aggiungere protezione di rete per un deployment pubblico.

Per ruotare/revocare credenziali, modificare il registro protetto e riavviare: le sessioni dell’identità modificata decadono; le altre conservano la propria modalità di durata. La rotazione dei token non revoca automaticamente i link non nominativi esistenti; revocare i trasferimenti separatamente. Non pubblicare registry, token, subscription topic o link.

## Segnalazioni

Non pubblicare credenziali, file personali o dettagli di una vulnerabilità nelle issue. Se nella repository GitHub è disponibile **Report a vulnerability**, usa quel canale privato. Se non è disponibile e non conosci un contatto privato del maintainer, apri una issue chiedendo soltanto come contattarlo in privato, senza dettagli tecnici della vulnerabilità. [Procedura GitHub](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately).

Per il maintainer: attivare le segnalazioni private al momento della pubblicazione. Questo documento da solo non abilita la funzione su GitHub.

## Web Push

Le sottoscrizioni sono input non fidati e sono accettate solo per dispositivi dell’utente autenticato. Gli endpoint devono essere HTTPS sui servizi push Apple/FCM/Mozilla autorizzati; sono vietati indirizzi arbitrari, credenziali nell’URL, porte alternative, query e frammenti. Le chiavi P-256 vengono validate prima della persistenza. `web-push` usa HTTPS senza seguire redirect.

Endpoint, chiavi di sottoscrizione e chiave privata VAPID sono segreti operativi: non registrarli nei log e non pubblicare `control.json` o il file VAPID. Le notifiche non contengono ID/nome file, riepiloghi, capability o chiavi di decifratura. Il service worker non usa cache e non esegue istruzioni ricevute dal payload.

Un avviso può arrivare dopo il logout, e una notifica già in viaggio non può essere ritirata disattivando la sottoscrizione. La disattivazione impedisce i nuovi invii. Provider e sistemi operativi controllano la consegna finale. Non considerare `accepted` una ricevuta di lettura.

## Trasferimenti personali dal browser

Il recipient può creare upload soltanto per se stesso e con identità destinataria obbligatoria. La directory dei dispositivi resta limitata al proprio account; la revoca resta limitata agli upload posseduti (o agli amministratori). La cifratura Web Crypto nel browser precede l’upload. Il contenuto non viene inviato a Codex o a servizi AI da questa funzione.

Il download diretto autentica e verifica AES-GCM prima di creare un Blob locale da salvare; la lettura di un riepilogo non scarica il corpo. Il Blob temporaneo può restare nel browser per cinque minuti per consentire un nuovo tentativo di salvataggio senza consumare altri download. Viene revocato anche all’uscita dalla pagina. I permessi di scrittura sul dispositivo restano quelli del browser e del sistema operativo.

L’opzione «Resta connesso» estende la durata del cookie e della sessione, senza conservare la credenziale originale nel browser. L’attività autenticata della casella rinnova la scadenza al massimo una volta all’ora (finestra effettiva di inattività fra 89 giorni e 23 ore e 90 giorni); il polling avviene solo con app visibile. Non esiste una scadenza assoluta per un dispositivo usato regolarmente. Questo aumenta la finestra di utilizzo di un cookie rubato: logout e rotazione della credenziale restano i meccanismi di revoca. Cancellare cookie o dati del browser richiede un nuovo accesso. Nessuna sessione già scaduta viene riattivata.

Gli ID dei browser mittenti sono convalidati come appartenenti all’identità che carica il file. Sono metadati dichiarati dal client, non attestazioni hardware: permettono solo di omettere notifiche, non concedono accesso aggiuntivo. Preferenze avvisi e ID dei file già visti sono conservati localmente per account (massimo 500 ID), senza nomi o chiavi. I badge «Nuovo» non sono prove di lettura.


## Conservazione esplicita e sincronizzazione dei browser (0.6)

`allowRetention` è disabilitata di default. Se abilitata, uploader e admin possono conservare un upload fino a una data (entro `maxTTL`) o senza scadenza. Le modifiche sono limitate al proprietario dell’upload e all’admin, richiedono autenticazione/Origin e vengono registrate; un destinatario non può estendere un invio altrui. `expires_at: null` e `max_downloads: null` rappresentano l’assenza dei rispettivi limiti. Quote di spazio, numero di trasferimenti, capacità e rate limit restano applicati. Un file già indisponibile non viene riattivato. Disabilitare la funzione non rimuove retroattivamente i file conservati. Il relay non offre durabilità garantita o backup automatici; conservare copie indipendenti dei documenti importanti.

Un browser che riesce già a decifrare un file può sincronizzare buste RSA-OAEP verso altri browser registrati della **stessa identità**. L’endpoint richiede sia l’identità autorizzata (mittente o destinatario nominativo) sia la capability di download del file; l’admin non basta per file altrui. Si aggiungono soltanto buste mancanti, senza sovrascrivere quelle esistenti. Non cambia la scadenza, non si azzera il contatore e non si consuma un download. La capability è già usata dal protocollo di download: non registrarne l’header `X-Download-Token`. Chiavi e contenuti non arrivano in chiaro allo storage. Il server resta fidato per la directory delle chiavi pubbliche: non esiste verifica indipendente dei nuovi dispositivi.

La sincronizzazione automatica richiede un browser leggibile attivo; non recupera chiavi perse da tutti i browser. Il client prova tutte le proprie buste disponibili prima di dichiarare un errore di decifratura. Revoca/scadenza vengono controllate anche dopo aver ricevuto il corpo di una modifica, per evitare ripristini durante richieste concorrenti. Non fare downgrade a 0.5 o precedenti dopo aver creato record con limiti nulli: il vecchio lettore li rifiuta.
