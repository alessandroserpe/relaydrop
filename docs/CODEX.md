# Contratto per agenti

Configurare `RELAYDROP_URL` e `RELAYDROP_TOKEN_FILE` con la credenziale individuale dell’agente, ruolo `uploader`. Non utilizzare normalmente il token amministratore. Nessun MCP è necessario: CLI JSON, processo invocabile con argomenti separati e percorsi assoluti.

1. L’utente destinatario accede alla dashboard e registra il browser. ID destinatario stabile, ad esempio `me`; nessuna scoperta implicita di telefono o indirizzo IP.
2. L’agente seleziona il file autorizzato. Se richiesto, lo legge localmente e prepara un riepilogo; oppure usa `--summarize --model` con Ollama locale già configurato.
3. `send FILE --to USER --require-recipient` carica ciphertext e copie delle chiavi cifrate per i browser del destinatario e dell’uploader. Il server non ottiene le chiavi.
4. `--notify` invia un avviso solo se il destinatario ha attivato Web Push su un proprio dispositivo, oppure l’operatore ha configurato ntfy. Senza il flag non viene inviato nulla.
5. Leggere il JSON: `id`, `url`, `recipient_devices`, `notification`, limiti e scadenza. Se `recipient_devices` è zero, consegnare il link privato nel canale autorizzato o chiedere la registrazione e un nuovo invio. L’agente non può registrare il browser remoto dell’utente al suo posto.
6. Non ripetere automaticamente upload dopo timeout; può essere già stato salvato. Un avviso fallito non implica un upload fallito.

`list`, `events`, `status ID`, `revoke ID` seguono il ruolo e la visibilità dell’agente. Non copiare token o link in commit, issue o log pubblici. Non inviare il link ad altri destinatari senza autorizzazione.

`download_started` significa ammissione al trasferimento. `download_transferred` significa completamento dello stream lato server; non significa che una persona abbia letto o salvato il file. `download_interrupted` consuma comunque un tentativo. `actor` identifica una credenziale, non dimostra chi fisicamente la stesse usando; se assente si tratta di un link anonimo.

La scheda Riepiloghi raccoglie localmente le sintesi già allegate ai file disponibili; non esegue AI sul server e non ha accesso ai documenti privi di chiavi. Per un report trasversale più approfondito, un agente locale autorizzato deve leggere i documenti sorgente selezionati. Non esiste ancora un servizio autonomo che ricostruisca da solo una libreria storica di documenti scaduti.
