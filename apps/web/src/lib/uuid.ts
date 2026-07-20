interface UuidCrypto {
  randomUUID?: () => string;
  getRandomValues(values: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>;
}

export function createUuid(cryptoApi: UuidCrypto | undefined = globalThis.crypto): string {
  if (!cryptoApi) {
    throw new Error(
      'This browser does not provide the Web Crypto API required to create an annotation.',
    );
  }

  if (typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }

  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
