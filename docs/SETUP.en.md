# Set up your own RelayDrop

This guide uses Mac/Linux for a local trial and Linux with systemd for a persistent server. Download the source archive or clone the repository, then open a terminal in its root. No hosted account, AI model or Docker installation is required.

```sh
git clone https://github.com/alessandroserpe/relaydrop.git
cd relaydrop
```

While the repository is private, your GitHub account needs access to clone or download it.

## 1. Local trial

Install Node 22+ and npm. Node 24 is the tested server version; use a [supported LTS release](https://nodejs.org/en/about/previous-releases).

```sh
npm ci --ignore-scripts
node src/cli.mjs init --token-file .secrets/admin-token
node src/cli.mjs identity-add me --name Personal --role recipient \
  --registry-file .secrets/identities.json --token-file .secrets/me-token
node src/cli.mjs identity-add agent --name Agent --role uploader \
  --registry-file .secrets/identities.json --token-file .secrets/agent-token

export RELAYDROP_TOKEN_FILE="$PWD/.secrets/admin-token"
export RELAYDROP_IDENTITIES_FILE="$PWD/.secrets/identities.json"
export RELAYDROP_DATA_DIR="$PWD/data"
export RELAYDROP_URL=http://127.0.0.1:8787
export RELAYDROP_ALLOW_HTTP_LOCALHOST=1
npm start
```

The credential-generation commands are one-time operations. Keep the same files for restarts. RelayDrop does not automatically load a `.env` file. Stop with Ctrl+C.

Open `http://127.0.0.1:8787/dashboard` on this computer. Read `.secrets/me-token` locally with your editor or password manager and use its contents as **Credenziale di accesso**. Register the browser under **Dispositivi e avvisi**. Do not paste credentials into issues, public logs or screenshots.

In another terminal at the repository root:

```sh
printf 'RelayDrop test file.\n' > /tmp/relaydrop-demo.txt
node src/cli.mjs send /tmp/relaydrop-demo.txt \
  --server http://127.0.0.1:8787 --allow-http-localhost \
  --token-file "$PWD/.secrets/agent-token" \
  --to me --require-recipient --ttl 86400 --downloads 20
```

The CLI prints a **secret download URL** in its JSON output. Keep it private. The registered browser should list the file; press **Scarica**. You can also use **Scegli file** to send directly from the browser.

Only the administrator login, using `admin-token`, shows **Impostazioni** for global limits. Personal browser preferences are under **Dispositivi e avvisi**. Give agents their uploader credential, not the administrator token.

**Localhost is not a phone-accessible server.** Continue below for phones and different networks. Register browsers again on the HTTPS origin before uploading: localhost browser keys do not automatically move to a new origin.

## 2. Prepare a Linux server

You need a domain pointing to the server, inbound ports 80/443, Node/npm, and an HTTPS reverse proxy. This example uses [Caddy](https://caddyserver.com/docs/install). If nginx or another proxy already serves the host, integrate RelayDrop into it instead of starting a competing listener.

Put reviewed **source files only** in `/opt/relaydrop`. Keep `.secrets/`, `data/`, logs and local environment files out of that directory. Install locked dependencies there with `npm ci --omit=dev --ignore-scripts`, using the source directory's owner. Verify the Node executable location; the commands and service example below assume `/usr/bin/node`.

Create the service account if it does not already exist:

```sh
sudo useradd --system --user-group --home-dir /var/lib/relaydrop \
  --shell /usr/sbin/nologin relaydrop
sudo install -d -m 700 -o relaydrop -g relaydrop /etc/relaydrop
sudo -u relaydrop /usr/bin/node /opt/relaydrop/src/cli.mjs init \
  --token-file /etc/relaydrop/admin-token
sudo -u relaydrop /usr/bin/node /opt/relaydrop/src/cli.mjs identity-add me \
  --name Personal --role recipient --registry-file /etc/relaydrop/identities.json \
  --token-file /etc/relaydrop/me-token
sudo -u relaydrop /usr/bin/node /opt/relaydrop/src/cli.mjs identity-add agent \
  --name Agent --role uploader --registry-file /etc/relaydrop/identities.json \
  --token-file /etc/relaydrop/agent-token
sudo -u relaydrop /usr/bin/node /opt/relaydrop/scripts/init-web-push.mjs \
  /etc/relaydrop/web-push.json
```

`admin-token` is the administrator credential. Use `me-token` on your personal devices and `agent-token` on the authorized sending machine. Transfer these through a private administrative channel, keeping file permissions 600 and private directories 700. Never regenerate them or the VAPID pair during ordinary upgrades.

### Keep and recover the administrator credential

`init` prints the full credential-file path and storage instructions to stderr, while stdout remains JSON with `role: "admin"`. It never prints the secret. Save the file contents in a password manager as **RelayDrop — administrator**, together with the service URL. Store the personal credential separately.

For the local trial, the file is `.secrets/admin-token` in the project directory; on Mac, `pbcopy < .secrets/admin-token` copies it to the clipboard. For this VPS installation, it is `/etc/relaydrop/admin-token` **on the server**. To retrieve it later, sign in to that server as its operator and read it with the required permissions, for example `sudo cat /etc/relaydrop/admin-token` in a private terminal. This displays the secret: keep it out of screenshots and shared logs.

Open `/dashboard` in a private browser window, paste the contents into **Credenziale di accesso**, then press **Accedi**. The heading becomes **Amministrazione**, and **Impostazioni** is available. Your ordinary personal browser session can remain open separately.

The actual path is the server's `RELAYDROP_TOKEN_FILE`. Older installations may use `upload-token`: keep that path during upgrades, or explicitly update the configuration if you rename it. New example services use `admin-token`. Do not rerun `init` to retrieve an existing credential; it refuses to overwrite it. If both the file and your private copy are lost, credential rotation requires administrative server access; there is no dashboard recovery flow.

Copy `deploy/relaydrop.service` to `/etc/systemd/system/relaydrop.service`. Set `RELAYDROP_URL` to your actual HTTPS origin and check every path. The unit includes the identity registry and VAPID file. Remove `RELAYDROP_WEB_PUSH_FILE` only if you intentionally want notifications disabled. `StateDirectory` creates persistent data storage with mode 700.

## 3. HTTPS

Adapt `deploy/Caddyfile` to your domain and existing Caddy configuration:

```caddyfile
files.example.com {
    request_body {
        max_size 2GiB
    }
    reverse_proxy 127.0.0.1:8787
}
```

Replace `files.example.com` with your domain. The proxy forwards the entire application, including `/v1/` and the root-scoped service worker. Do not enable response caching or log authorization headers, request bodies, cookies or secret links. The proxy body limit is an outer ceiling; the app has lower configurable limits. [Caddy request-body configuration](https://caddyserver.com/docs/caddyfile/directives/request_body).

```sh
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl daemon-reload
sudo systemctl enable --now relaydrop
sudo systemctl reload caddy
```

Expose only HTTPS/HTTP through the firewall, not port 8787. Check `https://YOUR-DOMAIN/healthz` from another network: it should return `{"ok":true}`. Open `/dashboard` and register your personal browsers. If startup fails, inspect `systemctl status relaydrop` and `journalctl -u relaydrop`, without publishing sensitive configuration.

## 4. iPhone, Android and desktop

For ordinary file reception, open the HTTPS dashboard in the browser and sign in with the personal credential. Register each browser. For existing files, open the inbox on a browser that already reads them so it can synchronize encrypted file keys. Use the same personal identity for the shared inbox on your phone and computer.

For iPhone notifications, use iOS/iPadOS 16.4+:

1. Open the HTTPS site in Safari, then Share → Add to Home Screen.
2. Open the new Home Screen icon. Sign in and register that browser if needed.
3. Open **Dispositivi e avvisi**, press **Attiva gli avvisi**, and allow the system prompt.
4. Send a synthetic file from another device with notifications selected; test on cellular data as well.

Web Push can arrive with the app closed. Permission, connectivity, Focus settings and the OS still control delivery. No Apple Developer account is required. [WebKit's requirements](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

On Android/desktop, use a browser supporting the required Web Crypto, IndexedDB, service-worker and push APIs. Register it and enable notifications there. Android physical-device compatibility is not yet verified by this project. Safari and the Home Screen app may keep separate local keys; registering one does not always register the other.

## 5. Agents

Install the repository and Node on the sending machine. Copy `skills/relaydrop-send` into the user skill directory supported by the Codex client (for example `~/.agents/skills`; some clients use `~/.codex/skills`). Keep one active copy.

Create `~/.codex/relaydrop/config.json` with mode 600 in a directory with mode 700, substituting your own values:

```json
{
  "server": "https://files.example.com",
  "cli_path": "/absolute/path/to/relaydrop/src/cli.mjs",
  "token_file": "/absolute/private/path/agent-token",
  "recipient": "me",
  "notify": true,
  "ttl_seconds": 86400,
  "max_downloads": 20
}
```

Use `notify: false` until a recipient browser has push enabled. From the installed skill directory:

```sh
node scripts/relaydrop.mjs doctor
node scripts/relaydrop.mjs send /absolute/path/to/document.pdf
```

`doctor` must return `ready: true` and at least one registered recipient. The helper suppresses the CLI's secret URL in its output. You can then ask Codex to send a specific file using RelayDrop, or invoke `$relaydrop-send`. Other agents can use the same CLI with separate uploader credentials; no MCP server is bundled or required. [Detailed integration](AGENT_INTEGRATION.md).

## 6. Operations

- The administrator can adjust global limits under **Impostazioni**. Settings already saved in `control.json` override initial environment defaults.
- Preserve origin, identity registry, VAPID pair and data across upgrades. Stop the service before replacing code, install locked dependencies, then restart and check health. Remembered sessions survive restarts.
- The data directory has an exclusive `.lock`. After a crash, check for a live writer before manually removing a stale lock. Never automatically delete it at startup.
- Expiry blocks new downloads immediately. Cleanup removes expired files every minute. Saved device copies are unaffected.
- Do not retain backups of ephemeral transfer blobs. Protect operational configuration separately; restoring old state can restore stale counters or sessions.
- Deleting local browser data can destroy decryption keys. There is no key backup/recovery flow yet.
- Notifications contain no filenames, contents or decryption keys. Providers can observe delivery metadata. Acceptance is not proof of delivery or reading.
- The server serves trusted client code and public keys. This model does not protect against a malicious relay replacing them. Review [SECURITY.md](../SECURITY.md) before exposing an instance.

Detailed environment defaults, container instructions and recovery notes are in [DEPLOYMENT.md](DEPLOYMENT.md). The container path is optional and has not yet been validated on every target host.


## 7. Per-file retention and new devices (0.6)

Under administrator **Impostazioni**, enable **Consenti file fino a una data scelta o senza scadenza**. It is off by default. Before file selection, **Conservazione del prossimo file** offers temporary (up to 24h/20 attempts), a chosen local date/time within the maximum duration, or no expiry. The last two modes have unlimited download attempts and still count towards storage quotas. The default temporary choice returns after a successful upload.

The upload owner or admin can change retention under **Dettagli → Conservazione → Salva conservazione**. A recipient cannot extend someone else's upload. Expired/revoked/exhausted files cannot be revived. Disabling the setting does not delete existing retained files. No expiry is not a backup guarantee. Do not downgrade to 0.5 after creating records with null expiry/download limits.

When adding a new browser, open RelayDrop on one that already reads the files. While visible, it shares encrypted file keys with new browsers of the same account, up to four files per refresh. For a few files, keep it open for about a minute and refresh the new device. No document re-upload or download attempt is required. This needs an existing readable browser; if every key and original link is lost, the relay cannot recover the content.


## Docker alternative

On a fresh host with Docker and an HTTPS reverse proxy, run from the source repository:

```sh
docker build -t relaydrop:local .
sh deploy/bootstrap-container.sh relaydrop:local
```

Bootstrap runs **inside the image**, so Node/npm and `node_modules` on the host are not required. It creates private `.secrets/` and `data/` directories, administrator/personal/agent credentials, the identity registry and VAPID keys. It refuses an existing configuration and must not be rerun during upgrades. Save the credentials privately.

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

Replace the domain and configure the HTTPS proxy. Log in with `me-token`, register each browser and grant notification permission. Stop with `docker stop --time 20 relaydrop`; restart using the same run command and directories. Keep existing credentials and VAPID keys. Crash recovery still requires checking the storage lock before restarting. The example memory limit is for a small personal installation, not a capacity guarantee.

## Automated installation verification

The `installation` GitHub Actions job uses a disposable Linux host. It checks a fresh systemd installation and a Docker installation, including bootstrap without host dependencies, verified HTTPS with an isolated local CA, role separation, encrypted upload/download, notification configuration, rate-limit isolation and session/file persistence across restarts. It does not obtain a public ACME certificate or send real phone notifications. The fixture refuses to run outside a GitHub-hosted Linux runner. Normal unit tests remain available locally through `npm test`.
