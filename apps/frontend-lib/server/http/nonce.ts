const NONCE_BYTE_LENGTH = 16;

export const generateNonce = (): string =>
  crypto.getRandomValues(new Uint8Array(NONCE_BYTE_LENGTH)).toBase64();
