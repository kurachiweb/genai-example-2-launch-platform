import type { HashedRateLimitKey } from '../../../lib/core/rate-limit/rate-limit-key.ts';
import type { ThrottleStatus } from '../../domain/auth/login-throttle-state.ts';

export interface PasswordHasher {
  // 保存形式は'pbkdf2-sha512$<反復回数>$<ソルト>$<導出値>'
  hash(password: string): Promise<string>;
  verify(password: string, stored: string): Promise<boolean>;
  // 該当する利用者がいないときも同じ計算量を使い、応答時間から登録の有無を推測させない
  verifyAgainstDummy(password: string): Promise<false>;
}

export type PwnedCheckResult =
  | { readonly kind: 'pwned' }
  | { readonly kind: 'not-pwned' }
  | {
      readonly kind: 'unavailable';
      readonly reason: 'timeout' | 'network' | 'status' | 'invalid-response';
    };

export interface PwnedPasswordChecker {
  // 照合できないときも例外を投げず、unavailableを返す
  check(password: string): Promise<PwnedCheckResult>;
}

export interface SecretGenerator {
  // 32バイトの乱数をパディング無しのbase64urlにした43文字
  token(): string;
  randomString(length: number, alphabet: string): string;
  uuid(): string;
}

export interface SecretBox {
  seal(plaintext: string, context: string): Promise<string>;
  // 改ざんや文脈の不一致を検出したら例外を投げる
  open(sealed: string, context: string): Promise<string>;
}

export type TotpVerification =
  { readonly ok: true; readonly step: number } | { readonly ok: false };

export interface TotpAuthenticator {
  generateSecret(): string;
  buildUri(secret: string, issuer: string, accountLabel: string): string;
  verify(secret: string, code: string, now: Date): TotpVerification;
}

export type LoginThrottleScope = 'user' | 'admin';

export interface LoginThrottleKeys {
  readonly email: HashedRateLimitKey;
  readonly ip: HashedRateLimitKey | undefined;
}

export interface LoginThrottle {
  // メールアドレスとIPアドレスのどちらかがロック中なら、残り時間の長い方のロックを返す
  status(
    scope: LoginThrottleScope,
    keys: LoginThrottleKeys,
    now: Date,
  ): Promise<ThrottleStatus>;
  recordFailure(
    scope: LoginThrottleScope,
    keys: LoginThrottleKeys,
    now: Date,
  ): Promise<ThrottleStatus>;
  reset(scope: LoginThrottleScope, keys: LoginThrottleKeys): Promise<void>;
}

export type AuthIncident =
  | {
      readonly kind: 'pwned-password-check-unavailable';
      readonly reason: string;
    }
  | { readonly kind: 'disposable-email-check-unavailable' }
  | { readonly kind: 'login-throttle-ip-missing' }
  | {
      readonly kind: 'lifecycle-events-redispatched';
      readonly count: number;
      readonly stuckEventIds: readonly string[];
    }
  | { readonly kind: 'purge-overdue'; readonly count: number }
  | { readonly kind: 'lifecycle-publish-failed'; readonly eventId: string };

export interface AuthIncidentReporter {
  // 運用者が検知できるようログとエラートラッキングへ送る。個人情報を含めない
  report(incident: AuthIncident): void;
}
