const UUID_BYTE_LENGTH = 16;

const fillFallbackBytes = (bytes: Uint8Array) => {
  let seed = Date.now() ^ Math.floor(Math.random() * 0x1_0000_0000);

  for (let index = 0; index < bytes.length; index += 1) {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    bytes[index] = (seed >>> ((index % 4) * 8)) & 0xff;
  }

  return bytes;
};

const getRandomBytes = () => {
  const bytes = new Uint8Array(UUID_BYTE_LENGTH);
  const webCrypto = globalThis.crypto;

  if (typeof webCrypto?.getRandomValues === 'function') {
    return webCrypto.getRandomValues(bytes);
  }

  return fillFallbackBytes(bytes);
};

const formatUuidV4 = (bytes: Uint8Array) => {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const createUuid = () => {
  const webCrypto = globalThis.crypto;

  if (typeof webCrypto?.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }

  return formatUuidV4(getRandomBytes());
};
