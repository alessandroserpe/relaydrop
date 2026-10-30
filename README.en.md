# RelayDrop

**An encrypted inbox for your devices and AI agents.**

[Italiano](README.md) · [English setup](docs/SETUP.en.md) · [Agent integration](docs/AGENT_INTEGRATION.md) · [Security model](SECURITY.md)

Send a document from your Mac, a result from a VPS, or a photo from your phone. Retrieve it from your shared inbox on another network. Codex and other authorized agents can deliver files through the CLI; a Codex skill is included.

**0.6.0 · self-hosted MVP · MIT license.** RelayDrop is a working name. The UI is currently Italian. This is intended for personal use and small trusted groups, not public anonymous uploads or a backup system. No independent security audit has been completed.

## Features

- Browser uploads and downloads, with optional iPhone Home Screen Web Push.
- Quick file selection, mobile camera input and desktop drag-and-drop; selection starts an upload immediately.
- A shared inbox with encrypted key synchronization for newly registered browsers, while an existing readable browser is open. No per-upload device picker.
- Latest files first, local “New” badges, readable expiry and direct download. Summaries and details are separate actions.
- Client-side encryption of contents, filenames and optional summaries. The relay stores ciphertext and operational metadata.
- Optional generic notifications, excluding the sending browser for browser uploads.
- JSON CLI/API and an agent skill with private configuration and no automatic retries.
- Per-file retention: temporary, a chosen deadline, or no expiry when enabled by the admin. Owners/admins can change it in Details; retained files have no download-count limit.
- Optional remembered sessions that renew during use and expire after about 90 days of inactivity.

The sender can disconnect after uploading. You run your own instance with your own domain, storage and credentials; no access to the developer’s instance is needed.

## Start here

Follow the [English setup guide](docs/SETUP.en.md) for a local trial and HTTPS deployment. Detailed operational documentation is also available in Italian: [deployment](docs/DEPLOYMENT.md), [user guide](docs/USER_GUIDE.md), [API](docs/API.md), [OpenAPI](docs/openapi.json).

Three credentials have different purposes:

| Role | Purpose |
|---|---|
| Personal / recipient | The same credential on your devices; uploads only to your own inbox. |
| Agent / uploader | A dedicated credential for CLI/API uploads. |
| Administrator | Global limits and operational metadata. Only this role sees **Impostazioni** (Settings). |

Personal login has not lost a settings page: browser preferences live under **Dispositivi e avvisi**. Administrator access does not provide other users’ private decryption keys.

## Defaults and boundaries

| Setting | Current behavior |
|---|---|
| Browser upload | Lower of 100 MiB and the configured file limit; encryption uses memory |
| CLI upload | Streaming encryption into a temporary encrypted file; technical ceiling about 2 GiB |
| Initial storage | 1 GiB and 1,000 transfers, configurable |
| Default browser transfer | Up to 24 hours / 20 download attempts, subject to server policy |
| Plain CLI defaults | 1 hour / 3 attempts |
| Registered browsers | 4 per identity |
| Activity log | 30 days by default, capped at 2,000 events |

Expired files become unavailable immediately; cleanup runs every minute. Revoked or exhausted transfers are also removed. Interrupted downloads consume an attempt. Already-saved copies on your devices remain available.

Register each browser. For older available files, open an existing browser that can already read them: it automatically encrypts and shares the file keys with new browsers of the same account. For a few files, keep the inbox visible for about a minute. The relay cannot recover keys if all readable browsers and original links are lost. Deleting browser data can destroy the local private keys. Safari and an iPhone Home Screen app may use separate storage.

The relay knows operational metadata such as identity, encrypted size and timestamps. Clients trust the relay’s public-key directory and delivered JavaScript: an actively compromised relay can replace them. Read the [security model](SECURITY.md). This is not a claim of protection against a malicious server.

No resumable uploads, folder synchronization, key recovery, public signup, MFA, antivirus scanning or durable push queue are implemented. Push-provider acceptance is not proof of delivery; completed server streaming is not proof of reading or saving. Summaries are optional sender-side operations, not an AI service reading the inbox.

## Validation

```sh
npm ci --ignore-scripts
npm run check
npm test
```

45 automated tests passed on the development Mac and a Linux VPS with Node 24. Real iPhone tests confirmed cellular-network transfer, notifications with the app closed, opening/saving files, phone-photo transfer to Mac and delivery through the skill. The Node 22/24 Linux/macOS CI matrix reports its results in [GitHub Actions](https://github.com/alessandroserpe/relaydrop/actions/workflows/test.yml). Android, the new camera button, native drag-and-drop and large files on phones still need physical-device validation. See [validation notes](docs/VALIDATION.md).

[MIT license](LICENSE) · [Contributing](CONTRIBUTING.md) · [Architecture and alternatives](docs/ARCHITECTURE.md)
