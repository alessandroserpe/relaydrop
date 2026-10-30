# Validazione 0.4 — 30 ottobre 2026

Ambiente effettivo: macOS, Node v23.10.0 già disponibile sul computer. Produzione: usare una LTS supportata. La CI Node 22/24 su Linux/macOS è predisposta, non eseguita da un servizio remoto.

## Eseguito

- `npm run check`: parsing di tutti i moduli in src/public/scripts.
- `npm test`: **25 test superati, 0 falliti** dopo le ultime modifiche funzionali.
- Cifratura file e decifratura con lo stesso modulo usato dal browser; Unicode, file vuoto, tag alterato, chiave sbagliata, file troncato, dimensione al confine legacy.
- CLI reale: init, send, status, revoke, output JSON e codici d’errore. Upload e decifratura reali di **32 MiB**, oltre il vecchio tetto di 25 MiB.
- Autenticazione, origini, quote, MIME, limiti, upload interrotti, prenotazioni durante upload simultanei e rilascio quota.
- Otto richieste per l’ultimo tentativo: una sola ammessa. Preview ripetute non consumano tentativi.
- Scadenza, revoca, cleanup, persistenza contatori, recupero parziali/orfani e lock contro writer concorrenti.
- Ruoli e visibilità: uploader nominativo, destinatario corretto, rifiuto utente estraneo, revoca vietata al recipient, identità richiesta oltre al link.
- Cookie HttpOnly/SameSite, protezione Origin per mutazioni con cookie, persistenza delle sessioni al riavvio, scadenza, logout indipendente per browser e revoca alla rotazione della credenziale.
- Registro persistente con attore nominativo e filtri; impostazioni salvate e conservate al riavvio. Riduzione del limite non invalida i file già presenti.
- Incapsulamento RSA-OAEP e dettagli AES-GCM: nomi, token, chiavi e riepiloghi non compaiono in chiaro nei record del relay. L’admin non riceve buste di altri utenti per il solo ruolo.
- Notifiche opt-in con trasporto simulato; errore provider non invalida l’upload. Una risposta tardiva del provider non può ripristinare un contatore di download precedente.
- Adattatore Ollama con risposta simulata: solo loopback, rifiuto modello cloud esplicito e origine remota, documento trattato come dati non fidati.
- **Estrazione PDF effettiva** con il `pdftotext` locale su un PDF sintetico generato per il test. Solo la fase LLM era simulata.

## Browser reale

Nel browser integrato, con utenti e documenti fittizi:

1. Accesso amministratore e registrazione browser: generazione chiave privata locale, invio sola chiave pubblica.
2. Invio di tre documenti dalla CLI con identità `Codex · Mac`, destinatario registrato e riepiloghi dimostrativi forniti dal mittente.
3. Dashboard: nomi decifrati, conteggi, riepiloghi, dettaglio, attribuzione attività e apertura del file dalla casella.
4. Ricezione nominativa e decifratura del documento; comparsa del controllo di salvataggio e del riepilogo. Il salvataggio effettivo del browser era già stato verificato nel primo MVP; in questa iterazione non sono stati lasciati nuovi file in Download.
5. Riavvio del relay: sessione ancora valida entro le otto ore; chiavi IndexedDB ancora disponibili e file decifrabili.
6. Modifica del limite da 100 a **256 MiB** dalla dashboard, con conferma di salvataggio nell’istanza di prova. Non equivale a un test di trasferimento da 256 MiB.
7. Vista Riepiloghi con tutte le sintesi accessibili, registro con download avviato e trasferimento completato, prova del nuovo endpoint preview.
8. Layout stretto: viewport DOM effettiva **389 px**, larghezza documento 389 px (nessun overflow globale; tabella scorre internamente). Controllata anche una viewport effettiva da 520 px. Non sono dispositivi fisici.

Screenshot con dati fittizi: [dashboard](dashboard-preview.png), [impostazioni](settings-preview.png), [mobile](dashboard-mobile.png).

I test di upload interrotto producono intenzionalmente `Request failed`, messaggio generico senza segreti. Non indica un fallimento della suite.

## Non eseguito / non attivato

- **Generazione Ollama reale:** il comando è installato, ma il servizio locale non risponde. Nessun modello scaricato, nessun documento inviato a servizi AI esterni.
- **Docker build e Caddy** su host di destinazione: l’installazione effettiva usa Nginx/Plesk e systemd utente.
- **Android fisico**, capacità RAM con file grandi e prove prolungate in sospensione. Il percorso piccolo-file su iPhone è stato collaudato come descritto sotto.
- File vicini al tetto tecnico di 2 GiB, carico prolungato, esaurimento disco, power loss e audit indipendente.
- Pubblicazione repo, CI remota, MFA/OIDC, OCR, key transparency, ripresa dei trasferimenti, backup delle chiavi o coda notifiche durevole.

## Collaudo per l’installazione reale

Configurare host/dominio HTTPS e credenziali individuali; registrare il browser dell’iPhone. Inviare un file fittizio da una rete diversa, spegnere il mittente, aprire dalla dashboard e salvare. Ripetere su Android; testare identità sbagliata, scadenza, revoca e interruzione. Misurare i limiti sui dispositivi reali prima di aumentarli. Poi attivare un modello locale scelto e ntfy con ACL/permessi, verificando separatamente sintesi e consegna degli avvisi.

## Versione 0.3: Web Push integrato

25 test automatici superati. I cinque nuovi casi coprono endpoint e chiavi non validi, payload generico, autorizzazione/dispositivi propri, mancata esposizione delle sottoscrizioni, persistenza, consenso opt-in, cleanup 404/410, rinnovo concorrente, contatori download durante l’invio e asset PWA/CSP. Controllo sintattico superato. `npm install --ignore-scripts` ha segnalato zero vulnerabilità note al momento della verifica; non sostituisce una revisione indipendente.

Verificato su VPS il trasferimento HTTPS di 32 MiB: upload CLI, rifiuto senza identità richiesta, download autenticato, decifratura tramite il modulo usato dal browser e SHA-256 identico. Il file tecnico è stato revocato. Questa prova non equivale al collaudo fisico iPhone.

Per la nuova esperienza iPhone: aggiungere RelayDrop alla Home, accedere, attivare gli avvisi e consentire il permesso Apple; inviare poi un file fittizio con `--notify` e confermare ricezione, apertura e salvataggio sul telefono in rete cellulare.

## Collaudo fisico iPhone riuscito

Il 30 ottobre 2026: dominio HTTPS sulla VPS autorizzata, iPhone con RelayDrop sulla Home, permesso Web Push attivato. Codex ha caricato un file fittizio da 188 byte con identità uploader nominativa, destinatario obbligatorio, busta per il browser registrato e `--notify`.

Il provider ha accettato un avviso (nessun errore o endpoint scaduto). Il registro conferma un download dell’identità destinataria e lo stream completato. L’utente ha confermato notifica ricevuta e file aperto/salvato; le schermate del telefono mostravano 4G. Questa conferma sul dispositivo è distinta dalla sola risposta del provider o dal log server.

L’accesso agli avvisi è stato reso immediatamente visibile sulla dashboard mobile dopo il riscontro dell’utente. ntfy, predisposto inizialmente, è stato disattivato a favore di Web Push. Repository rimasta locale e privata; nessun segreto o link capability pubblicato.

## Versione 0.4: invio personale e azioni separate

27 test automatici superati. Aggiunti invio Web Crypto interoperabile con il formato RD01, decifratura della busta su un secondo dispositivo, isolamento dell’upload personale rispetto ad altri utenti, obbligo dell’identità destinataria, revoca del proprio upload, limiti e rifiuto di ciphertext alterato o risposte oltre la dimensione dichiarata.

Browser reale con account fittizio: caricamento da selettore file, cifratura e invio riusciti; un solo clic su «Scarica» produce il download effettivo. Contenuto scaricato confrontato e identico al sorgente. Apertura del riepilogo di un altro file: contatore server invariato a zero. Dettagli e riepilogo visualizzati separatamente. Vista effettiva a 389 px: nessun overflow orizzontale globale, azioni tutte visibili; nessun errore JavaScript osservato.

Questo collaudo desktop/responsive non sostituisce la verifica fisica del nuovo flusso di salvataggio su iPhone: iOS può mostrare la propria conferma e offre il link di salvataggio alternativo. Il precedente percorso con notifica e ricezione iPhone è stato collaudato nella versione 0.3.

- Accesso prolungato: rinnovo dopo 89 giorni con orologio simulato, persistenza al riavvio, rifiuto dopo inattività, nessuna scrittura disco per ogni polling, preferenza separata tra browser, controllo Origin e logout.

## Versione 0.5

38 test automatici: esclusione dei soli avvisi del mittente, buste di chiavi per tutti i dispositivi, nessun errore quando manca un altro destinatario push, rifiuto di ID estranei, persistenza, preferenze locali e stati dei nuovi arrivi. Skill: preflight senza browser, invio reale tramite CLI, stato e output privi di capability/token.

Browser locale: selezione file → invio automatico → nuovo elemento in cima; ritorno alla casella e layout a 389 px senza scorrimento orizzontale. Il selettore fotocamera e il trascinamento nativo richiedono ancora conferma sui dispositivi fisici dell’utente.

## Prova utente ad app chiusa

Il 30 ottobre 2026 un utente ha confermato la ricezione della guida inviata con la skill, dopo avere chiuso la web app sull’iPhone. È una verifica su un dispositivo reale, non una garanzia di consegna per tutti i browser o sistemi operativi.


## Versione 0.6: conservazione e dispositivi aggiunti dopo l’invio

45 test automatici superati sul Mac. Nuovi casi: file senza scadenza dopo molti download, cleanup/riavvio e disabilitazione policy; quota comunque applicata; data esatta e mancata resurrezione; modifiche riservate a proprietario/admin; contatori preservati durante PATCH concorrenti; nuovi comandi CLI. Verificate anche buste cifrate per nuovi browser della stessa identità, decifratura reale del contenuto dopo riavvio, idempotenza, rifiuto di identità/capability/target estranei e protezione Origin. Nessuna chiave, nome o capability in chiaro nei record di prova. Corretto il parsing degli ID base64url che iniziano con un trattino, nella CLI e nel helper della skill.

Browser reale con dati fittizi: accesso senza chiave del file precedente, registrazione del nuovo browser, avviso di sincronizzazione, invio della busta dal dispositivo sorgente simulato e successivo download riuscito. Il file salvato corrisponde al testo originale ed è stato rimosso dopo il confronto. Provati cambio a senza scadenza, ritorno a una data locale, upload con conservazione e ripristino del default temporaneo. Larghezza DOM effettiva 389 px, documento 389 px: nessun overflow globale. Non equivale ancora alla conferma della sincronizzazione sull’iPhone fisico dell’utente.


Il 30 ottobre 2026 anche la VPS Node 24 ha superato tutti i 45 test. Dopo l’aggiornamento HTTPS, l’utente ha aperto la casella sull’iPhone e aggiornato il Mac: ha confermato che i file precedenti sono ora scaricabili. Il caso reale include due registrazioni Mac successive agli upload. Il server ha abilitato le opzioni di conservazione su richiesta, mantenendo la durata massima configurata di 24 ore per le date scelte; l’admin può aumentarla. I file senza scadenza sono esenti da quel limite temporale.


## 0.6.1 — limiti isolati e installazione riproducibile

La suite comprende 49 test. I quattro nuovi controlli verificano isolamento fra identità e classi di traffico, tetti di emergenza, rinnovo della finestra, memoria limitata e resistenza agli header di forwarding falsificati. La riproduzione RD-01 satura 120 richieste anonime e verifica che credenziale, sessione e capability valide restino utilizzabili. La pulizia delle fixture attende il rilascio del lock anche sui sistemi dove la chiusura del socket precede il completamento del gestore del download.

Il job `installation` di GitHub Actions usa un runner Linux temporaneo e:

1. Installa il codice con dipendenze dal lockfile, un utente dedicato e l’unità systemd fornita, adattando solo percorsi/account/origine alla fixture.
2. Valida Caddy e usa HTTPS con una CA locale isolata, senza disabilitare la verifica TLS né installare la CA nel sistema.
3. Genera admin, personale, agente e VAPID; verifica permessi privati e separazione dei ruoli.
4. Invia un file fittizio con la CLI e lo decifra con il modulo effettivo del browser; confronta il contenuto.
5. Riavvia il servizio e verifica persistenza di sessione e file.
6. Costruisce l’immagine Docker ed esegue `deploy/bootstrap-container.sh` in una directory senza `node_modules` sul computer host; verifica che una seconda esecuzione non sovrascriva la configurazione.
7. Ripete trasferimento HTTPS e controllo del riavvio con il container, filesystem di root in sola lettura e mount persistenti.

Lo script rifiuta di eseguire queste operazioni fuori da un runner Linux GitHub-hosted. I dati fittizi vengono rimossi; nessuna credenziale viene stampata. [Esiti CI](https://github.com/alessandroserpe/relaydrop/actions/workflows/test.yml).

Questa prova non include DNS pubblico, emissione ACME o consegna reale APNs/FCM. Questi passaggi dipendono dall’installazione e dai dispositivi. Le prove fisiche iPhone precedenti restano riportate separatamente; Android non è dichiarato verificato.
