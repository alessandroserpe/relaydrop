# Usare RelayDrop

## Accesso personale e amministrativo

La credenziale personale identifica la tua casella. Usala su telefono e computer, poi registra ogni browser in **Dispositivi e avvisi** per ricevere file. Un browser è distinto da un dispositivo fisico: Safari, Chrome e la web app sulla Home possono avere chiavi differenti.

La credenziale amministrativa è separata. Solo l’amministratore vede **Impostazioni**, dove configura dimensioni, spazio totale, durata, tentativi e conservazione del registro. L’agente usa una terza credenziale, con ruolo uploader. Non serve dare all’agente l’accesso amministrativo.

Per amministrare, apri la stessa pagina `/dashboard` in una finestra privata e usa la credenziale amministrativa nel campo **Credenziale di accesso**. Il titolo **Amministrazione** e il ruolo accanto al nome confermano l’accesso. Non occorre registrare un browser per modificare i limiti. La finestra privata consente di tenere aperta la casella personale nell’altra finestra.

Chi ha installato il servizio trova la credenziale nel proprio gestore di password oppure nel file privato indicato da `init`: [recupero locale](GETTING_STARTED.md#conserva-subito-laccesso-amministrativo) o [recupero sulla VPS](DEPLOYMENT.md#dove-trovare-e-conservare-laccesso-amministrativo). La dashboard non la mostra e non la rigenera.

| Schermata | Personale | Agente | Amministratore |
|---|---|---|---|
| File condivisi / Riepiloghi | File della propria casella | Propri invii | Metadati globali; contenuti solo se possiede le chiavi |
| Attività | Eventi visibili al proprio ruolo | Propri invii | Eventi globali |
| Dispositivi e avvisi | Propri browser e preferenze | Propri browser e preferenze | Propri browser e preferenze |
| Impostazioni | — | — | Limiti dell’intera istanza |

Le immagini storiche in `docs/` usano dati dimostrativi e un account amministrativo. Non rappresentano tutte le schermate della versione attuale; in particolare «Impostazioni» non compare nell’accesso personale.

## Foto e file

**Scegli file** apre il selettore; **Scatta foto** richiede la fotocamera ai browser mobili che la supportano. La scelta del file avvia subito un invio. Sul desktop puoi trascinare un file alla volta nella zona indicata. Il file è condiviso con tutti i browser già registrati della tua identità.

L’elenco mostra prima gli ultimi arrivi. «Nuovo» è un indicatore locale: si spegne quando apri dettagli/riepilogo o completi il download da quel browser. Non è una prova che un’altra persona abbia letto il file. Cerca e filtri sono nella sezione espandibile **Cerca e filtra**.

- **Scarica:** riceve, decifra e propone il salvataggio. Il browser può chiedere un’ulteriore conferma.
- **Riepilogo:** legge la sintesi, se il mittente l’ha allegata, senza scaricare il corpo del file.
- **Dettagli:** mostra mittente, scadenza, tentativi, attività e revoca quando consentita.
- **Salva di nuovo:** per cinque minuti riusa il file decifrato, senza un nuovo download dal relay.

## Avvisi

Sul server deve essere configurato Web Push. Sul dispositivo scegli **Dispositivi e avvisi → Attiva gli avvisi**, poi consenti la richiesta del sistema.

Su iPhone: apri l’istanza in Safari, **Condividi → Aggiungi alla schermata Home**, apri la nuova icona e attiva gli avvisi da lì. Servono iOS/iPadOS 16.4 o successivi. La web app può richiedere un proprio login e una propria registrazione. Gli avvisi possono arrivare anche ad app chiusa; sistema operativo, rete e impostazioni notifiche ne controllano la consegna. [Requisiti WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

**Avvisa gli altri miei dispositivi** è facoltativo e viene ricordato nel browser. Il browser mittente è escluso dagli avvisi, ma conserva l’accesso al file. La CLI non è associata a un browser fisico: `--notify` avvisa i browser abilitati della casella. Gli avvisi non contengono nomi, riepiloghi o chiavi.

## Accesso mantenuto

**Resta connesso su questo dispositivo** mantiene l’accesso per circa 90 giorni di inattività e lo rinnova durante l’uso. Puoi cambiarlo senza reinserire la credenziale. Senza l’opzione, la sessione dura otto ore. **Esci** chiude soltanto la sessione corrente; non elimina le chiavi né disattiva gli avvisi.

## Cancellazione e recupero

Prima di scegliere il file, usa **Conservazione del prossimo file**:

- **Temporaneo:** fino a 24 ore e 20 download, entro i limiti amministrativi. È la scelta iniziale e viene ripristinata dopo ogni invio riuscito.
- **Fino a una data e ora:** scegli nel fuso orario del dispositivo; il file resta disponibile senza limiti di download fino a quella data. La data massima è indicata e dipende dalla durata massima impostata dall’amministratore.
- **Senza scadenza:** nessuna cancellazione automatica per tempo o download. Il file occupa spazio finché il proprietario dell’invio o l’amministratore non lo revoca.

Le ultime due opzioni richiedono **Impostazioni → Consenti file fino a una data scelta o senza scadenza**. Sono disabilitate nelle nuove installazioni finché l’admin non le abilita. Disabilitarle in seguito non cancella i file conservati.

Per un file già presente, apri **Dettagli → Conservazione**, cambia data o scegli **Senza scadenza** e premi **Salva conservazione**. Questo rimuove anche il limite di download, mantenendo il conteggio delle attività. Può farlo chi ha caricato il file oppure l’amministratore; la sola ricezione non dà il diritto di prolungare un invio altrui. Un file già scaduto, esaurito o revocato non può essere recuperato così.

La conservazione sul relay non è un backup: conserva altrove i documenti importanti e proteggi le chiavi locali. Scadenza, revoca ed esaurimento dei tentativi rendono il file indisponibile. Il cleanup automatico rimuove i file scaduti ogni minuto. I download già avviati possono terminare.

Le copie salvate sul telefono o computer rimangono disponibili. Il registro attività sopravvive secondo la sua durata configurata, senza contenuti o nomi in chiaro. Non c’è un cestino per recuperare i trasferimenti eliminati: reinvia la copia originale.

## Problemi comuni

| Sintomo | Controllo |
|---|---|
| Non vedo Impostazioni | Accedi con la credenziale amministrativa; quella personale non modifica limiti globali. |
| Avviso arrivato, elenco vuoto | Verifica l’identità e i filtri; torna a File condivisi. Un file scaduto può essere già rimosso. |
| «File cifrato», download disabilitato | Apri RelayDrop su un dispositivo che può già leggere il file, lascialo visibile per circa un minuto e aggiorna il nuovo browser. Il pulsante disabilitato non indica un download in corso. |
| Login richiesto di nuovo | Controlla «Resta connesso», eventuale cancellazione cookie o uso di un browser/origine diversa. |
| Sul telefono non funziona localhost | Serve l’origine HTTPS del relay, non l’indirizzo loopback del computer. |
| HTTP 413 | Verifica il limite del proxy oltre a quello applicativo; il browser resta limitato a 100 MiB. |
| HTTP 429 | Limite globale di richieste: attendi e controlla polling/health check dell’istanza. |
| Invio non confermato | Aggiorna l’elenco prima di ripetere: potrebbe essere già stato completato. |


## Aggiungere un dispositivo e ritrovare i file precedenti

La credenziale personale è la stessa su tutti i tuoi dispositivi: identifica la casella. Le chiavi per decifrare i file sono invece conservate nei browser, separatamente dalla credenziale.

1. Accedi sul nuovo dispositivo e registra il browser.
2. Apri RelayDrop su un dispositivo che può già leggere i file e lascia la casella visibile. La sincronizzazione parte automaticamente, al massimo quattro file per aggiornamento.
3. Il nuovo browser aggiorna l’elenco automaticamente; puoi anche premere **Aggiorna i file**. Per pochi file normalmente basta circa un minuto; raccolte più grandi richiedono più aggiornamenti.

Non vengono scaricati o reinviati i documenti e non si consumano tentativi: passano soltanto le chiavi dei singoli file, cifrate per il nuovo browser della stessa identità. Non è una copia della chiave privata del vecchio browser. Non servono nuove credenziali. Se il vecchio dispositivo è offline o la web app è chiusa, la sincronizzazione attende che la riapri.

Non rimuovere il tuo ultimo browser capace di aprire i file prima di completare il passaggio. Senza alcun browser leggibile o link originale, il server non può ricostruire le chiavi. Scadenze e revoche restano valide anche durante la sincronizzazione.
