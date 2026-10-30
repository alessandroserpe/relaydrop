// Shared by the actual browser and interoperability tests. No third-party scripts.
export async function decryptFile(buffer, encodedKey, maxBytes = 100 * 1024 * 1024 + 4096) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 36 || bytes.length > maxBytes ||
      new TextDecoder().decode(bytes.slice(0, 4)) !== 'RD01' ||
      !/^[A-Za-z0-9_-]{43}$/.test(encodedKey)) throw new Error('Invalid encrypted file');
  const rawKey = Uint8Array.from(atob(encodedKey.replace(/-/g, '+').replace(/_/g, '/') + '='), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(4, 16),
    additionalData: new TextEncoder().encode('RelayDrop/v1'), tagLength: 128 }, key, bytes.slice(16));
  if (plain.byteLength < 4) throw new Error('Invalid metadata');
  const size = new DataView(plain).getUint32(0);
  if (size < 1 || size > 2048 || size + 4 > plain.byteLength) throw new Error('Invalid metadata');
  const metadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain.slice(4, 4 + size)));
  const data = plain.slice(4 + size);
  if (typeof metadata.name !== 'string' || !metadata.name || metadata.name.length > 1024 ||
      !Number.isSafeInteger(metadata.size) || metadata.size !== data.byteLength) throw new Error('Invalid metadata');
  return { name: metadata.name.replace(/[\\/\x00-\x1f\x7f]/g, '_'), data };
}
