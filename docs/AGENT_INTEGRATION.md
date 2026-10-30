# Agenti: skill e CLI

La skill `skills/relaydrop-send` è portabile e non contiene credenziali. Copia la cartella nella posizione delle skill personali supportata dal tuo client Codex (ad esempio `~/.agents/skills/relaydrop-send`; alcuni client usano `~/.codex/skills`). Mantieni una sola copia attiva. La configurazione del servizio è separata in `~/.codex/relaydrop/config.json`, oppure nel percorso indicato da `RELAYDROP_AGENT_CONFIG`. File di configurazione e token devono avere permessi 600, directory privata 700.

Installa prima Node 22+, le dipendenze della repository e crea un’identità con ruolo uploader sul relay. Trasferisci il relativo file token sul computer dell’agente tramite un canale privato. Registra almeno un browser dell’utente destinatario prima dell’invio.

Una skill fornisce il flusso e i criteri di attivazione; la CLI esegue cifratura e invio. Un server MCP sarebbe utile per agenti privi di accesso alla CLI locale, ma non è necessario per un agente con accesso alla CLI. Le [istruzioni ufficiali sulle skill Codex](https://developers.openai.com/codex/skills) descrivono selezione implicita, invocazione esplicita e scoperta locale. Il percorso di installazione può dipendere dal client; le modifiche normalmente vengono rilevate automaticamente, altrimenti riavviare Codex.

## Configurazione privata

Esempio, da adattare senza includere il token nel JSON:

```json
{
  "server": "https://files.example.org",
  "cli_path": "/percorso/relaydrop/src/cli.mjs",
  "token_file": "/percorso/privato/uploader-token",
  "recipient": "me",
  "notify": true,
  "ttl_seconds": 86400,
  "max_downloads": 20
}
```

Node 22+ e la CLI devono essere installati. Il helper legge `~/.codex/relaydrop/config.json` oppure `RELAYDROP_AGENT_CONFIG`. Non stampare token, cookie, buste o link con frammento. La credenziale appartiene a un uploader dedicato, non all’amministratore. La configurazione resta locale e non va aggiunta alla repository.

Comandi del helper `scripts/relaydrop.mjs` nella skill:

- `doctor`: verifica origine, credenziale, limiti e browser destinatari; non invia file.
- `send /percorso/assoluto/file`: invia una volta, richiede identità destinataria e rispetta i limiti correnti. `--quiet` omette l’avviso.
- `status ID`: verifica un trasferimento senza scaricarne il contenuto.
- `recent`: ultimi trasferimenti visibili alla credenziale verso il destinatario configurato, senza metadati cifrati o link segreti.

L’output contiene dashboard, ID, scadenza e stato notifica. Il link segreto generato dalla CLI viene scartato: occorre un browser già registrato prima dell’invio. Nessuna analisi AI automatica del contenuto, nessun destinatario esterno e nessun retry implicito. I token non vengono salvati nella skill e non appaiono negli argomenti del processo. Gli avvisi CLI raggiungono i browser abilitati della casella; la CLI non viene identificata con uno specifico browser del Mac.

Per altri agenti, distribuisci skill o istruzioni equivalenti, CLI e una credenziale uploader dedicata tramite canale privato. La scoperta automatica non è universale: ogni macchina deve essere configurata.

## Verificare la configurazione

Dalla cartella della skill installata:

```sh
node scripts/relaydrop.mjs doctor
node scripts/relaydrop.mjs send /percorso/assoluto/documento.pdf
```

`doctor` deve restituire `ready: true` e almeno un browser destinatario. `notify: true` richiede avvisi già attivati dal destinatario; usa `false` prima di configurarli, oppure `send … --quiet`. Dopo l’installazione puoi chiedere «Inviami sul telefono il file appena creato con RelayDrop» o invocare esplicitamente `$relaydrop-send`.

La configurazione contiene il percorso assoluto della CLI: aggiornalo se sposti la repository. Non copiare una configurazione di un altro utente senza sostituire origine, token e destinatario.


## Conservazione esplicita (CLI 0.6)

La skill mantiene l’invio temporaneo configurato. Per conservare esplicitamente un file, la CLI supporta `send FILE --keep` oppure `send FILE --expires YYYY-MM-DDTHH:mm:ssZ`, con le normali opzioni server/credenziale/destinatario. Non combinarli con `--ttl` o `--downloads`. Serve `allowRetention` abilitata dall’amministratore. La data deve essere futura ed entro `maxTTL`; `--keep` non ha scadenza. Entrambe le modalità tolgono il limite di download senza togliere la quota di spazio.

`retention ID --keep` oppure `retention ID --expires YYYY-MM-DDTHH:mm:ssZ` modifica un proprio upload ancora disponibile; l’admin può modificare anche gli altri. Non cambiare automaticamente la conservazione senza una richiesta dell’utente. `expires_at` e `max_downloads` possono ora essere `null` negli output. Gli agenti continuano a non stampare capability o chiavi nei messaggi.
