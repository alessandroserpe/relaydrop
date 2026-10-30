# Contribuire

Usare Node LTS supportato e installare le dipendenze dal lockfile. Prima di proporre modifiche:

```sh
npm ci --ignore-scripts
npm run check
npm test
```

I test devono coprire gli invarianti interessati (quote concorrenti, contatori persistenti, nessuna chiave sul relay, cleanup). Evitare cambi del formato RD01 senza versione nuova, test di interoperabilità e revisione di sicurezza. Non abbassare i default TLS/autenticazione per facilitare un deployment.

Testare il ricevitore su browser desktop e dispositivi iOS/Android reali prima di dichiarare compatibilità. Non equiparare una viewport mobile a un test su iPhone.

Tenere token, trasferimenti, file privati e output JSON reali fuori da commit e segnalazioni. Le segnalazioni di sicurezza seguono SECURITY.md. Nessuna telemetria o dipendenza remota nel ricevitore.

La CI è configurata per Node 22 e 24 su Linux/macOS. Prima di dichiarare una piattaforma supportata, documentare esito e ambiente del collaudo. Per i report usa dati sintetici e descrivi versione, passaggi e risultato atteso; non allegare file di produzione.
