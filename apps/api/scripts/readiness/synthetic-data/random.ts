import { createHash } from 'node:crypto';

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const ULID_TIME_LENGTH = 10;

const ULID_RANDOM_LENGTH = 16;

const ULID_RANDOM_BYTES = 10;

const MAX_ULID_TIME = 2 ** 48;

const UUID_BYTES = 16;

const BITS_PER_BASE32_CHARACTER = 5n;

const BASE32_MASK = 31n;

const BYTE_BITS = 8n;

const INTEGER_BYTES = 6;

const digestOf = (key: string): Uint8Array =>
  createHash('sha256').update(key, 'utf8').digest();

// 同じ時刻と鍵から同じIDを作るため、ulidパッケージの乱数ではなく鍵のハッシュを乱数部に使う
export function deterministicUlid(at: Date, key: string): string {
  const time = at.getTime();
  if (!Number.isSafeInteger(time) || time < 0 || time >= MAX_ULID_TIME) {
    throw new RangeError(`IDの時刻は48ビットに収めてください: ${String(time)}`);
  }
  let timePart = '';
  let remainingTime = time;
  for (let index = 0; index < ULID_TIME_LENGTH; index += 1) {
    timePart = `${CROCKFORD_BASE32[remainingTime % 32] ?? ''}${timePart}`;
    remainingTime = Math.floor(remainingTime / 32);
  }
  let randomValue = digestOf(key)
    .slice(0, ULID_RANDOM_BYTES)
    .reduce((value, byte) => (value << BYTE_BITS) | BigInt(byte), 0n);
  let randomPart = '';
  for (let index = 0; index < ULID_RANDOM_LENGTH; index += 1) {
    randomPart = `${CROCKFORD_BASE32[Number(randomValue & BASE32_MASK)] ?? ''}${randomPart}`;
    randomValue >>= BITS_PER_BASE32_CHARACTER;
  }
  return `${timePart}${randomPart}`;
}

// 監査ログなどが利用者を指す仮名化IDは、登録の時と同じUUIDの形式でないと拒否されるため、バージョン4の形式に整える
export function deterministicUuid(key: string): string {
  const bytes = digestOf(key).slice(0, UUID_BYTES);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function deterministicInteger(
  key: string,
  exclusiveMax: number,
): number {
  if (!Number.isSafeInteger(exclusiveMax) || exclusiveMax < 1) {
    throw new RangeError(
      `上限は1以上の整数で指定してください: ${String(exclusiveMax)}`,
    );
  }
  const value = digestOf(key)
    .slice(0, INTEGER_BYTES)
    .reduce((total, byte) => total * 256 + byte, 0);
  return value % exclusiveMax;
}
