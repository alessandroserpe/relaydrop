import { createCipheriv, createPublicKey, publicEncrypt, constants, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, openSync, closeSync, fstatSync, writeFileSync, appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AAD } from './crypto.mjs';

export async function encryptPath(path, maxBytes) {
  const fd = openSync(path, 'r');
  let info;
  try { info = fstatSync(fd); if (!info.isFile() || info.size > maxBytes) throw new Error('File exceeds configured limit or is not regular'); }
  catch (error) { closeSync(fd); throw error; }
  const directory = mkdtempSync(join(tmpdir(), 'relaydrop-cipher-'));
  const output = join(directory, 'encrypted.bin');
  const cleanup = () => rmSync(directory, { recursive: true, force: true });
  const input = createReadStream(path, { fd, autoClose: true });
  try {
    const name = basename(path).replace(/[\\/\x00-\x1f\x7f]/g, '_');
    if (!name || Buffer.byteLength(name) > 1024) throw new Error('Invalid filename');
    const metadata = Buffer.from(JSON.stringify({ name, size: info.size }));
    const length = Buffer.alloc(4); length.writeUInt32BE(metadata.length);
    const key = randomBytes(32), iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(AAD);
    writeFileSync(output, Buffer.concat([Buffer.from('RD01'), iv]), { mode: 0o600 });
    let count = 0;
    async function* source() {
      yield length; yield metadata;
      for await (const chunk of input) { count += chunk.length; if (count > info.size) throw new Error('File changed during encryption'); yield chunk; }
      if (count !== info.size) throw new Error('File changed during encryption');
    }
    await pipeline(Readable.from(source()), cipher, createWriteStream(output, { flags: 'a' }));
    appendFileSync(output, cipher.getAuthTag());
    return { path: output, key: key.toString('base64url'), name, size: info.size,
      bytes: 4 + 12 + 4 + metadata.length + info.size + 16, cleanup };
  } catch (error) { input.destroy(); cleanup(); throw error; }
}
export function encryptDetails(key, value) {
  const data = Buffer.from(JSON.stringify(value));
  if (data.length > 11000) throw new Error('Summary metadata too large');
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64url'), iv);
  cipher.setAAD(Buffer.from('RelayDrop/details/v1'));
  return Buffer.concat([iv, cipher.update(data), cipher.final(), cipher.getAuthTag()]).toString('base64url');
}
export function wrapKeys(devices, secret, key) {
  return devices.map(device => ({ device_id: device.id, box: publicEncrypt({
    key: createPublicKey({ key: device.public_key, format: 'jwk' }), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256'
  }, Buffer.from(`${secret}.${key}`)).toString('base64url') }));
}
