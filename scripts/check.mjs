import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
for (const dir of ['src','public','scripts','skills/relaydrop-send/scripts']) for (const file of readdirSync(dir)) if (/\.(mjs|js)$/.test(file)) execFileSync(process.execPath,['--check',`${dir}/${file}`],{stdio:'inherit'});
console.log('All source modules parsed successfully');
