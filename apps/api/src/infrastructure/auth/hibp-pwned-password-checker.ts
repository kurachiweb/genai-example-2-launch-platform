import type { HttpFetch } from '../../../lib/workers/bot-protection/turnstile-verifier.ts';
import type {
  PwnedCheckResult,
  PwnedPasswordChecker,
} from '../../application/auth/ports.ts';

export interface HibpPwnedPasswordCheckerOptions {
  readonly fetch: HttpFetch;
  readonly userAgent: string;
  readonly timeoutMs?: number;
}

export const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/';

const DEFAULT_TIMEOUT_MS = 3000;

const PREFIX_LENGTH = 5;

const RANGE_LINE_PATTERN = /^([0-9A-F]{35}):([0-9]+)$/iu;

type Unavailable = Extract<PwnedCheckResult, { kind: 'unavailable' }>;

const unavailable = (reason: Unavailable['reason']): Unavailable => ({
  kind: 'unavailable',
  reason,
});

const textEncoder = new TextEncoder();

async function sha1Hex(password: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-1',
    textEncoder.encode(password),
  );
  return new Uint8Array(digest).toHex().toUpperCase();
}

// パディングの行(出現回数0)を除いた、出現した接尾辞の集合を返す。形式に反する行が1つでもあれば解釈しない
function parseRange(body: string): ReadonlySet<string> | undefined {
  const lines = body.split(/\r?\n/u).filter((line) => line !== '');
  if (lines.length === 0) {
    return undefined;
  }
  const suffixes = new Set<string>();
  for (const line of lines) {
    const match = RANGE_LINE_PATTERN.exec(line);
    if (match === null) {
      return undefined;
    }
    const [, suffix = '', count = ''] = match;
    if (Number(count) > 0) {
      suffixes.add(suffix.toUpperCase());
    }
  }
  return suffixes;
}

export class HibpPwnedPasswordChecker implements PwnedPasswordChecker {
  readonly #fetch: HttpFetch;
  readonly #userAgent: string;
  readonly #timeoutMs: number;

  constructor(options: HibpPwnedPasswordCheckerOptions) {
    this.#fetch = options.fetch;
    this.#userAgent = options.userAgent;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async check(password: string): Promise<PwnedCheckResult> {
    const hash = await sha1Hex(password);
    const prefix = hash.slice(0, PREFIX_LENGTH);
    // workerdのfetchは別のオブジェクトのメソッドとして呼ぶと不正な呼び出しになるため、変数に取り出して呼ぶ
    const fetcher = this.#fetch;
    const signal = AbortSignal.timeout(this.#timeoutMs);
    let body: string;
    try {
      const response = await fetcher(`${HIBP_RANGE_URL}${prefix}`, {
        method: 'GET',
        headers: { 'Add-Padding': 'true', 'User-Agent': this.#userAgent },
        signal,
      });
      if (!response.ok) {
        // 使わない本文を読まずに接続を解放する。解放の失敗は照合の結果に関係しない
        await response.body?.cancel().catch(() => undefined);
        return unavailable('status');
      }
      body = await response.text();
    } catch {
      return unavailable(signal.aborted ? 'timeout' : 'network');
    }
    const suffixes = parseRange(body);
    if (suffixes === undefined) {
      return unavailable('invalid-response');
    }
    return suffixes.has(hash.slice(PREFIX_LENGTH))
      ? { kind: 'pwned' }
      : { kind: 'not-pwned' };
  }
}
