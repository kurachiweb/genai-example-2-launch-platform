import { createHmac } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

export interface TotpClock {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

export interface TotpCodeSource {
  readonly nextCode: () => Promise<string>;
}

// 認証アプリの既定(RFC 6238のSHA-1・6桁・30秒)と同じ値で、サーバーの設定と一致させる
const PERIOD_MS = 30_000;

const DIGITS = 6;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const BITS_PER_BASE32_CHAR = 5;

const BITS_PER_BYTE = 8;

const IGNORED_BASE32_PATTERN = /[\s=]/gu;

const SYSTEM_CLOCK: TotpClock = Object.freeze({ now: Date.now, sleep });

// 画面の手入力用の文字列は区切りの空白や小文字で表記され得るため、空白とパディングを除き大文字小文字を区別せずに読む
export function decodeBase32(text: string): Uint8Array {
  const normalized = text.replace(IGNORED_BASE32_PATTERN, '').toUpperCase();
  const bytes: number[] = [];
  let buffer = 0;
  let bufferedBits = 0;
  for (const char of normalized) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value === -1) {
      throw new RangeError('Base32の文字ではない文字を含みます');
    }
    buffer = ((buffer << BITS_PER_BASE32_CHAR) | value) & 0xff_ff;
    bufferedBits += BITS_PER_BASE32_CHAR;
    if (bufferedBits >= BITS_PER_BYTE) {
      bufferedBits -= BITS_PER_BYTE;
      bytes.push((buffer >> bufferedBits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

export function totpStepAt(timeMs: number): number {
  return Math.floor(timeMs / PERIOD_MS);
}

// RFC 4226の動的な切り詰め: HMACの末尾の4ビットが示す位置から31ビットを取り出し、桁数で割った余りを0埋めする
export function totpCodeAt(secret: Uint8Array, step: number): string {
  const counter = Buffer.alloc(BITS_PER_BYTE);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', secret).update(counter).digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7f_ff_ff_ff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

// サーバーは前後1つまでの時間窓の認証コードを受け付け、同じ利用者が使った時間窓とそれより前の時間窓は拒否する。
// 使い終えた時間窓の次を、受け付けられる範囲に入るまで待ってから使い、何度続けて求めても拒否されない認証コードを返す
export function createTotpCodeSource(
  secretText: string,
  clock: TotpClock = SYSTEM_CLOCK,
): TotpCodeSource {
  const secret = decodeBase32(secretText);
  let lastStep: number | undefined;
  return {
    nextCode: async () => {
      const currentStep = totpStepAt(clock.now());
      const step =
        lastStep === undefined
          ? currentStep
          : Math.max(currentStep, lastStep + 1);
      if (step > currentStep + 1) {
        await clock.sleep((step - 1) * PERIOD_MS - clock.now());
      }
      lastStep = step;
      return totpCodeAt(secret, step);
    },
  };
}
