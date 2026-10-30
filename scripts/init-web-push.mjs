import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import webpush from 'web-push';
const path = process.argv[2];
if (!path) { console.error('Usage: node scripts/init-web-push.mjs PRIVATE_JSON_PATH'); process.exit(1); }
mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
writeFileSync(path, JSON.stringify(webpush.generateVAPIDKeys()), { flag: 'wx', mode: 0o600 });
console.log('Web Push keys created in the private file. Keep this file across upgrades.');
