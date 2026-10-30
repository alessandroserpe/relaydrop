import { createCipheriv, randomBytes, createHash } from 'node:crypto';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_ENVELOPE_BYTES = MAX_FILE_BYTES + 4096;
export const AAD = new TextEncoder().encode('RelayDrop/v1');
export const token = () => randomBytes(32).toString('base64url');
export const hash = value => createHash('sha256').update(value).digest('hex');

export function encryptFile(bytes, filename) {
  if (bytes.length > MAX_FILE_BYTES) throw new Error('File exceeds 25 MiB MVP limit');
  const name = filename.replace(/[\\/\x00-\x1f\x7f]/g, '_');
  if (!name || Buffer.byteLength(name) > 1024) throw new Error('Invalid filename');
  const metadata = Buffer.from(JSON.stringify({ name, size: bytes.length }));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(metadata.length);
  const key = randomBytes(32), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(Buffer.concat([length, metadata, bytes])), cipher.final()]);
  return { key: key.toString('base64url'), body: Buffer.concat([Buffer.from('RD01'), iv, ciphertext, cipher.getAuthTag()]) };
}
